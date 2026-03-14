#!/bin/bash
# Open Brain Test Script
# Run this after: docker compose up -d db capture-api mcp-server caddy

set -euo pipefail

API_BASE_URL="http://localhost:8888"
MCP_HTTP_URL="http://localhost:3000/mcp"
MCP_HTTP_HEALTH_URL="http://localhost:3000/health"

echo "🧠 Open Brain Test Suite"
echo "========================"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Load credentials
source .env

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
  if curl -fsS "$MCP_HTTP_HEALTH_URL" > /dev/null 2>&1; then
    return 0
  fi

  echo -e "${YELLOW}ℹ${NC}  mcp-server-http is not reachable on port 3000, starting it for MCP HTTP tests..."
  docker compose up -d mcp-server-http > /dev/null

  if ! wait_for_url "$MCP_HTTP_HEALTH_URL" 20 2; then
    echo -e "${RED}FAIL${NC} Unable to reach mcp-server-http on port 3000 after startup"
    exit 1
  fi
}

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

echo -n "Test 6: File upload stores extracted content and metadata... "
UPLOAD_FIXTURE=$(mktemp /tmp/openbrain-upload-XXXXXX.txt)
cat > "$UPLOAD_FIXTURE" <<'EOF'
Meeting notes: Priya decided the release topic is container security. Marcus will prepare the deployment checklist and follow up tomorrow.
EOF

UPLOAD_RESULT=$(curl -fsS -X POST "$API_BASE_URL/upload" \
  -H "X-OpenBrain-Key: $OPENBRAIN_API_KEY" \
  -F "file=@$UPLOAD_FIXTURE")
rm -f "$UPLOAD_FIXTURE"

if echo "$UPLOAD_RESULT" | grep -q '"success":true' && \
   echo "$UPLOAD_RESULT" | grep -q '"original_filename"'; then
  echo -e "${GREEN}PASS${NC}"
else
  echo -e "${RED}FAIL${NC}"
  echo "Response: $UPLOAD_RESULT"
  exit 1
fi

echo -n "Test 7: HTTP MCP server exposes metadata tools... "
ensure_mcp_http_running
TOOLS_RESULT=$(curl -fsS -X POST "$MCP_HTTP_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
if echo "$TOOLS_RESULT" | grep -q 'semantic_search_filtered' && \
   echo "$TOOLS_RESULT" | grep -q 'get_metadata_stats'; then
  echo -e "${GREEN}PASS${NC}"
else
  echo -e "${RED}FAIL${NC}"
  echo "Response: $TOOLS_RESULT"
  exit 1
fi

echo -n "Test 8: Filtered semantic search works through MCP HTTP... "
FILTERED_SEARCH_RESULT=$(curl -fsS -X POST "$MCP_HTTP_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
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

echo -n "Test 9: Metadata statistics tool returns aggregate data... "
METADATA_STATS_RESULT=$(curl -fsS -X POST "$MCP_HTTP_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
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

echo ""
echo "✅ Test suite complete"
echo ""
echo "📊 Database stats:"
docker exec openbrain-db psql -U postgres -d openbrain -c "SELECT COUNT(*) AS total_thoughts FROM thoughts;" 2>/dev/null || \
  echo "  (Run manually: docker exec openbrain-db psql -U postgres -d openbrain -c 'SELECT COUNT(*) AS total_thoughts FROM thoughts;')"

echo ""
echo "🔧 Manual MCP stdio test:"
echo "   docker exec -i openbrain-mcp-server node /app/index.js"
echo ""
echo "   Then send:"
echo '   {"jsonrpc":"2.0","id":1,"method":"tools/list"}'
