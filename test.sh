#!/bin/bash
# Open Brain Test Script
# Run this after: docker compose up -d db capture-api ingestion-worker mcp-server caddy

set -euo pipefail

API_BASE_URL="http://localhost:8888"
MCP_HTTP_URL="http://localhost:3000/mcp"
MCP_HTTP_HEALTH_URL="http://localhost:3000/health"

printf 'Open Brain Test Suite\n'
printf '=====================\n\n'

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

source .env

: "${OPENBRAIN_API_KEY:?Missing OPENBRAIN_API_KEY in .env}"
MCP_API_KEY="${MCP_API_KEY:-test-mcp-key}"
export MCP_API_KEY

wait_for_url() {
  local url="$1"
  local attempts="${2:-20}"
  local delay="${3:-2}"

  for _ in $(seq 1 "$attempts"); do
    if curl -fsS "$url" > /dev/null 2>&1; then
      return 0
    fi
    sleep "$delay"
  done

  return 1
}

ensure_mcp_http_running() {
  echo -e "${YELLOW}INFO${NC} Recreating mcp-server-http for authenticated MCP checks..."

  if ! docker compose up -d --build --force-recreate mcp-server-http > /dev/null; then
    echo -e "${RED}FAIL${NC} Unable to start mcp-server-http. Ensure docker-compose.yml passes MCP_API_KEY to the service."
    exit 1
  fi

  if ! wait_for_url "$MCP_HTTP_HEALTH_URL" 20 2; then
    echo -e "${RED}FAIL${NC} Unable to reach mcp-server-http on port 3000 after startup"
    exit 1
  fi
}

ensure_ingestion_worker_running() {
  echo -e "${YELLOW}INFO${NC} Ensuring ingestion-worker is running for async upload checks..."

  if ! docker compose up -d --build --force-recreate ingestion-worker > /dev/null; then
    echo -e "${RED}FAIL${NC} Unable to start ingestion-worker service"
    exit 1
  fi
}

wait_for_capture_api() {
  echo -e "${YELLOW}INFO${NC} Waiting for Capture API behind Caddy to become ready..."

  for _ in $(seq 1 30); do
    local status
    status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_BASE_URL/capture" \
      -H "Content-Type: application/json" \
      -d '{"content": "readiness probe"}' || true)

    if [ "$status" = "401" ]; then
      return 0
    fi

    sleep 2
  done

  echo -e "${RED}FAIL${NC} Capture API did not become ready on $API_BASE_URL"
  exit 1
}

mcp_post() {
  local payload="$1"

  curl -fsS -X POST "$MCP_HTTP_URL" \
    -H "Content-Type: application/json" \
    -H "X-MCP-Key: $MCP_API_KEY" \
    -d "$payload"
}

extract_mcp_text_count() {
  node -e '
    let input = "";
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const response = JSON.parse(input);
      const text = response.result.content[0].text;
      const parsed = JSON.parse(text);
      process.stdout.write(String(parsed.count));
    });
  '
}

wait_for_capture_api
ensure_ingestion_worker_running

echo -n "Test 1: Caddy health endpoint on port 8888... "
HEALTH=$(curl -fsS "$API_BASE_URL/health")
if [ "$HEALTH" = "OK" ]; then
  echo -e "${GREEN}PASS${NC}"
else
  echo -e "${RED}FAIL${NC}"
  echo "Response: $HEALTH"
  exit 1
fi

echo -n "Test 2: Capture API rejects missing API key... "
RESPONSE=$(curl -s -w "%{http_code}" -o /dev/null -X POST "$API_BASE_URL/capture" \
  -H "Content-Type: application/json" \
  -d '{"content": "test"}')
if [ "$RESPONSE" = "401" ]; then
  echo -e "${GREEN}PASS${NC}"
else
  echo -e "${RED}FAIL${NC} (got $RESPONSE, expected 401)"
  exit 1
fi

echo -n "Test 3: Capture API rejects invalid API key... "
RESPONSE=$(curl -s -w "%{http_code}" -o /dev/null -X POST "$API_BASE_URL/capture" \
  -H "Content-Type: application/json" \
  -H "X-OpenBrain-Key: invalid_key" \
  -d '{"content": "test"}')
if [ "$RESPONSE" = "401" ]; then
  echo -e "${GREEN}PASS${NC}"
else
  echo -e "${RED}FAIL${NC} (got $RESPONSE, expected 401)"
  exit 1
fi

echo -n "Test 4: Capture API stores metadata-enriched thought... "
CAPTURE_RESULT=$(curl -fsS -X POST "$API_BASE_URL/capture" \
  -H "Content-Type: application/json" \
  -H "X-OpenBrain-Key: $OPENBRAIN_API_KEY" \
  -d '{
    "content": "John from Acme Corp decided to deploy the Docker container by Friday, and Sarah will handle the PostgreSQL migration after the infrastructure review.",
    "metadata": {"source": "test", "topic": "deployment"}
  }')

if echo "$CAPTURE_RESULT" | grep -q '"success":true'; then
  echo -e "${GREEN}PASS${NC}"
else
  echo -e "${RED}FAIL${NC}"
  echo "Response: $CAPTURE_RESULT"
  exit 1
fi

THOUGHT_ID=$(echo "$CAPTURE_RESULT" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
if [ -z "$THOUGHT_ID" ]; then
  echo -e "${RED}FAIL${NC} Unable to parse thought ID from capture response"
  exit 1
fi

echo -n "Test 4b: Duplicate capture is idempotent via content hash... "
DEDUP_CAPTURE_RESULT=$(curl -fsS -X POST "$API_BASE_URL/capture" \
  -H "Content-Type: application/json" \
  -H "X-OpenBrain-Key: $OPENBRAIN_API_KEY" \
  -d '{
    "content": "John from Acme Corp decided to deploy the Docker container by Friday, and Sarah will handle the PostgreSQL migration after the infrastructure review.",
    "metadata": {"source": "test", "topic": "deployment"}
  }')
DEDUP_ID=$(echo "$DEDUP_CAPTURE_RESULT" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
if [ "$THOUGHT_ID" = "$DEDUP_ID" ] && echo "$DEDUP_CAPTURE_RESULT" | grep -q '"deduplicated":true'; then
  echo -e "${GREEN}PASS${NC}"
else
  echo -e "${RED}FAIL${NC}"
  echo "Original id: $THOUGHT_ID"
  echo "Duplicate response: $DEDUP_CAPTURE_RESULT"
  exit 1
fi

echo -n "Test 5: Extracted metadata is persisted in PostgreSQL... "
METADATA_ROW=$(docker exec openbrain-db psql -U postgres -d openbrain -t -A \
  -c "SELECT metadata::text FROM thoughts WHERE id = $THOUGHT_ID;")
if echo "$METADATA_ROW" | grep -q '"extracted"' && \
   echo "$METADATA_ROW" | grep -qi 'john' && \
   echo "$METADATA_ROW" | grep -qi 'docker'; then
  echo -e "${GREEN}PASS${NC}"
else
  echo -e "${RED}FAIL${NC}"
  echo "Metadata row: $METADATA_ROW"
  exit 1
fi

echo -n "Test 6: File upload enqueues job and worker completes it... "
UPLOAD_FIXTURE=$(mktemp /tmp/openbrain-upload-XXXXXX.txt)
printf '%s\n' 'Meeting notes: Priya decided the release topic is container security. Marcus will prepare the deployment checklist and follow up tomorrow.' > "$UPLOAD_FIXTURE"

UPLOAD_RESULT=$(curl -fsS -X POST "$API_BASE_URL/upload" \
  -H "X-OpenBrain-Key: $OPENBRAIN_API_KEY" \
  -F "file=@$UPLOAD_FIXTURE")
rm -f "$UPLOAD_FIXTURE"

UPLOAD_JOB_ID=$(echo "$UPLOAD_RESULT" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["job_id"])' 2>/dev/null || true)
if [ -z "$UPLOAD_JOB_ID" ]; then
  echo -e "${RED}FAIL${NC}"
  echo "Response: $UPLOAD_RESULT"
  exit 1
fi

JOB_STATUS=""
for _ in $(seq 1 40); do
  JOB_RESULT=$(curl -fsS -X GET "$API_BASE_URL/ingestion/jobs/$UPLOAD_JOB_ID" \
    -H "X-OpenBrain-Key: $OPENBRAIN_API_KEY")
  JOB_STATUS=$(echo "$JOB_RESULT" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)

  if [ "$JOB_STATUS" = "completed" ]; then
    break
  fi

  if [ "$JOB_STATUS" = "failed" ]; then
    echo -e "${RED}FAIL${NC}"
    echo "Job failure: $JOB_RESULT"
    exit 1
  fi

  sleep 2
done

if [ "$JOB_STATUS" = "completed" ] && echo "$JOB_RESULT" | grep -q '"thought_id"'; then
  echo -e "${GREEN}PASS${NC}"
else
  echo -e "${RED}FAIL${NC}"
  echo "Final job status response: $JOB_RESULT"
  exit 1
fi

ensure_mcp_http_running

echo -n "Test 7: secret rotation script supports dry-run mode... "
if scripts/rotate-secrets.sh --dry-run --non-interactive >/dev/null 2>&1; then
  echo -e "${GREEN}PASS${NC}"
else
  echo -e "${RED}FAIL${NC}"
  exit 1
fi

echo -n "Test 8: HTTP MCP health endpoint stays public... "
MCP_HEALTH=$(curl -fsS "$MCP_HTTP_HEALTH_URL")
if echo "$MCP_HEALTH" | grep -q '"status":"healthy"'; then
  echo -e "${GREEN}PASS${NC}"
else
  echo -e "${RED}FAIL${NC}"
  echo "Response: $MCP_HEALTH"
  exit 1
fi

echo -n "Test 9: HTTP MCP rejects missing MCP key... "
MISSING_KEY_BODY=$(mktemp)
MISSING_KEY_STATUS=$(curl -sS -o "$MISSING_KEY_BODY" -w "%{http_code}" -X POST "$MCP_HTTP_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
MISSING_KEY_RESPONSE=$(<"$MISSING_KEY_BODY")
rm -f "$MISSING_KEY_BODY"
if [ "$MISSING_KEY_STATUS" = "401" ] && echo "$MISSING_KEY_RESPONSE" | grep -q '"message":"Unauthorized"'; then
  echo -e "${GREEN}PASS${NC}"
else
  echo -e "${RED}FAIL${NC}"
  echo "Status: $MISSING_KEY_STATUS"
  echo "Response: $MISSING_KEY_RESPONSE"
  exit 1
fi

echo -n "Test 10: HTTP MCP rejects invalid MCP key... "
INVALID_KEY_BODY=$(mktemp)
INVALID_KEY_STATUS=$(curl -sS -o "$INVALID_KEY_BODY" -w "%{http_code}" -X POST "$MCP_HTTP_URL" \
  -H "Content-Type: application/json" \
  -H "X-MCP-Key: invalid_key" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
INVALID_KEY_RESPONSE=$(<"$INVALID_KEY_BODY")
rm -f "$INVALID_KEY_BODY"
if [ "$INVALID_KEY_STATUS" = "401" ] && echo "$INVALID_KEY_RESPONSE" | grep -q '"message":"Unauthorized"'; then
  echo -e "${GREEN}PASS${NC}"
else
  echo -e "${RED}FAIL${NC}"
  echo "Status: $INVALID_KEY_STATUS"
  echo "Response: $INVALID_KEY_RESPONSE"
  exit 1
fi

echo -n "Test 11: HTTP MCP server exposes metadata tools with valid auth... "
TOOLS_RESULT=$(mcp_post '{"jsonrpc":"2.0","id":3,"method":"tools/list"}')
if echo "$TOOLS_RESULT" | grep -q 'semantic_search_filtered' && \
   echo "$TOOLS_RESULT" | grep -q 'get_metadata_stats'; then
  echo -e "${GREEN}PASS${NC}"
else
  echo -e "${RED}FAIL${NC}"
  echo "Response: $TOOLS_RESULT"
  exit 1
fi

echo -n "Test 12: HTTP MCP sanitizes invalid parameter errors... "
INVALID_PARAMS_BODY=$(mktemp)
INVALID_PARAMS_STATUS=$(curl -sS -o "$INVALID_PARAMS_BODY" -w "%{http_code}" -X POST "$MCP_HTTP_URL" \
  -H "Content-Type: application/json" \
  -H "X-MCP-Key: $MCP_API_KEY" \
  -d '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "tools/call",
    "params": {
      "name": "semantic_search",
      "arguments": {
        "limit": 5
      }
    }
  }')
INVALID_PARAMS_RESPONSE=$(<"$INVALID_PARAMS_BODY")
rm -f "$INVALID_PARAMS_BODY"
if [ "$INVALID_PARAMS_STATUS" = "400" ] && \
   echo "$INVALID_PARAMS_RESPONSE" | grep -q '"code":-32602' && \
   ! echo "$INVALID_PARAMS_RESPONSE" | grep -q 'Missing required parameter'; then
  echo -e "${GREEN}PASS${NC}"
else
  echo -e "${RED}FAIL${NC}"
  echo "Status: $INVALID_PARAMS_STATUS"
  echo "Response: $INVALID_PARAMS_RESPONSE"
  exit 1
fi

echo -n "Test 13: HTTP MCP clamps list_recent limit to a safe minimum... "
LIST_RECENT_RESULT=$(mcp_post '{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "tools/call",
  "params": {
    "name": "list_recent",
    "arguments": {
      "limit": 0
    }
  }
}')
LIST_RECENT_COUNT=$(printf '%s' "$LIST_RECENT_RESULT" | extract_mcp_text_count)
if [ "$LIST_RECENT_COUNT" -ge 1 ] && [ "$LIST_RECENT_COUNT" -le 25 ]; then
  echo -e "${GREEN}PASS${NC}"
else
  echo -e "${RED}FAIL${NC}"
  echo "Response: $LIST_RECENT_RESULT"
  exit 1
fi

echo -n "Test 14: Filtered semantic search works through MCP HTTP... "
FILTERED_SEARCH_RESULT=$(mcp_post '{
  "jsonrpc": "2.0",
  "id": 6,
  "method": "tools/call",
  "params": {
    "name": "semantic_search_filtered",
    "arguments": {
      "query": "deployment checklist",
      "limit": 5,
      "filters": {
        "people": ["Marcus"],
        "topics": ["container security"]
      }
    }
  }
}')

if echo "$FILTERED_SEARCH_RESULT" | grep -q 'Marcus' && \
   echo "$FILTERED_SEARCH_RESULT" | grep -q 'container security'; then
  echo -e "${GREEN}PASS${NC}"
else
  echo -e "${RED}FAIL${NC}"
  echo "Response: $FILTERED_SEARCH_RESULT"
  exit 1
fi

echo -n "Test 15: Metadata statistics tool returns aggregate data... "
METADATA_STATS_RESULT=$(mcp_post '{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": {
    "name": "get_metadata_stats",
    "arguments": {}
  }
}')

if echo "$METADATA_STATS_RESULT" | grep -q 'unique_people' && \
   echo "$METADATA_STATS_RESULT" | grep -q 'Marcus'; then
  echo -e "${GREEN}PASS${NC}"
else
  echo -e "${RED}FAIL${NC}"
  echo "Response: $METADATA_STATS_RESULT"
  exit 1
fi

printf '\nTest suite complete\n\n'
printf 'Database stats:\n'
docker exec openbrain-db psql -U postgres -d openbrain -c "SELECT COUNT(*) AS total_thoughts FROM thoughts;" 2>/dev/null || \
  echo "  (Run manually: docker exec openbrain-db psql -U postgres -d openbrain -c 'SELECT COUNT(*) AS total_thoughts FROM thoughts;')"

printf '\nManual MCP stdio test:\n'
printf '   docker exec -i openbrain-mcp-server node /app/index.js\n\n'
printf '   Then send:\n'
printf '   {"jsonrpc":"2.0","id":1,"method":"tools/list"}\n'

printf '\nManual MCP HTTP test:\n'
printf '   curl -X POST %s -H "Content-Type: application/json" -H "X-MCP-Key: %s" -d '\''{"jsonrpc":"2.0","id":1,"method":"tools/list"}'\''\n' "$MCP_HTTP_URL" '$MCP_API_KEY'


