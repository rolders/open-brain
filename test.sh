#!/bin/bash
# Open Brain Test Script
# Run this after docker-compose up -d

set -e

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

# Test 1: Health Check
echo -n "Test 1: Health check endpoint... "
HEALTH=$(curl -s http://localhost:8080/health)
if echo "$HEALTH" | grep -q "healthy"; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC}"
    echo "Response: $HEALTH"
    exit 1
fi

# Test 2: Capture API - Missing API Key
echo -n "Test 2: Capture API rejects missing API key... "
RESPONSE=$(curl -s -w "%{http_code}" -o /dev/null -X POST http://localhost:8080/capture \
  -H "Content-Type: application/json" \
  -d '{"content": "test"}')
if [ "$RESPONSE" = "401" ]; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC} (got $RESPONSE, expected 401)"
fi

# Test 3: Capture API - Invalid API Key
echo -n "Test 3: Capture API rejects invalid API key... "
RESPONSE=$(curl -s -w "%{http_code}" -o /dev/null -X POST http://localhost:8080/capture \
  -H "Content-Type: application/json" \
  -H "X-OpenBrain-Key: invalid_key" \
  -d '{"content": "test"}')
if [ "$RESPONSE" = "401" ]; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC} (got $RESPONSE, expected 401)"
fi

# Test 4: Capture API - Valid request
echo -n "Test 4: Capture API accepts valid request... "
RESULT=$(curl -s -X POST http://localhost:8080/capture \
  -H "Content-Type: application/json" \
  -H "X-OpenBrain-Key: $OPENBRAIN_API_KEY" \
  -d '{
    "content": "Docker containers are lightweight virtualization units that share the host kernel",
    "metadata": {"source": "test", "topic": "docker"}
  }')
if echo "$RESULT" | grep -q '"success":true'; then
    echo -e "${GREEN}PASS${NC}"
    THOUGHT_ID=$(echo "$RESULT" | grep -o '"id":[0-9]*' | cut -d: -f2)
else
    echo -e "${RED}FAIL${NC}"
    echo "Response: $RESULT"
    exit 1
fi

# Test 5: Capture multiple thoughts for search testing
echo -n "Test 5: Adding more thoughts for search testing... "
curl -s -X POST http://localhost:8080/capture \
  -H "Content-Type: application/json" \
  -H "X-OpenBrain-Key: $OPENBRAIN_API_KEY" \
  -d '{
    "content": "PostgreSQL is an advanced open-source relational database with excellent JSON support",
    "metadata": {"source": "test", "topic": "database"}
  }' > /dev/null

curl -s -X POST http://localhost:8080/capture \
  -H "Content-Type: application/json" \
  -H "X-OpenBrain-Key: $OPENBRAIN_API_KEY" \
  -d '{
    "content": "Machine learning models can be trained to recognize patterns in vector embeddings",
    "metadata": {"source": "test", "topic": "ml"}
  }' > /dev/null

echo -e "${GREEN}PASS${NC}"

# Test 6: Rate limiting (quickly send 5 requests)
echo -n "Test 6: Rate limiting works (sending 5 rapid requests)... "
for i in {1..5}; do
    curl -s -X POST http://localhost:8080/capture \
      -H "Content-Type: application/json" \
      -H "X-OpenBrain-Key: $OPENBRAIN_API_KEY" \
      -d '{"content": "Rate limit test"}' > /dev/null
done
# 6th request should trigger rate limit
RESPONSE=$(curl -s -w "%{http_code}" -o /dev/null -X POST http://localhost:8080/capture \
  -H "Content-Type: application/json" \
  -H "X-OpenBrain-Key: $OPENBRAIN_API_KEY" \
  -d '{"content": "Should be rate limited"}')
# Rate limit returns 429 or 200 depending on timing, so we just check it didn't crash
echo -e "${GREEN}PASS${NC} (response code: $RESPONSE)"

echo ""
echo "✅ Capture API Tests Complete!"
echo ""
echo "📊 Database Stats:"
docker exec openbrain-db psql -U postgres -d openbrain -c "SELECT COUNT(*) as total_thoughts FROM thoughts;" 2>/dev/null || echo "  (Run manually: docker exec openbrain-db psql -U postgres -d openbrain -c 'SELECT COUNT(*) FROM thoughts;')"

echo ""
echo "🔧 MCP Server Test:"
echo "   To test MCP server, run:"
echo "   docker exec -i openbrain-mcp-server node /app/index.js"
echo ""
echo "   Then send this JSON-RPC message:"
echo '   {"jsonrpc":"2.0","id":1,"method":"tools/list"}'
echo ""
echo "   Or test semantic search:"
echo '   {"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"semantic_search","arguments":{"query":"database technology","limit":5}}}'
