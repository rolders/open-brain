#!/bin/bash
# Open Brain Validation Script
# Validates the setup before starting Docker

set -euo pipefail

echo "🔍 Open Brain Pre-Flight Validation"
echo "===================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

ERRORS=0

# Check 1: Required files exist
echo "Checking required files..."
FILES=(".env" "init.sql" "docker-compose.yml" "Caddyfile" "capture-api/index.js" "mcp-server/index.js" "mcp-server/http-server.js" "test.sh")
for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        echo -e "  ${GREEN}✓${NC} $file"
    else
        echo -e "  ${RED}✗${NC} $file missing"
        ERRORS=$((ERRORS + 1))
    fi
done
echo ""

# Check 2: .env file has proper values
echo "Checking .env configuration..."
if grep -q "generate_a_secure_random_string_here" .env; then
    echo -e "  ${YELLOW}⚠${NC}  OPENBRAIN_API_KEY not set (run ./setup.sh)"
    ERRORS=$((ERRORS + 1))
else
    echo -e "  ${GREEN}✓${NC}  OPENBRAIN_API_KEY configured"
fi

if grep -q "generate_a_secure_db_password_here" .env; then
    echo -e "  ${YELLOW}⚠${NC}  DB_PASSWORD not set (run ./setup.sh)"
    ERRORS=$((ERRORS + 1))
else
    echo -e "  ${GREEN}✓${NC}  DB_PASSWORD configured"
fi

if grep -q "your_openai_api_key_here" .env; then
    echo -e "  ${RED}✗${NC}  OPENAI_API_KEY not set (edit .env file)"
    ERRORS=$((ERRORS + 1))
else
    echo -e "  ${GREEN}✓${NC}  OPENAI_API_KEY configured"
fi
echo ""

# Check 3: init.sql password sync
echo "Checking init.sql password sync..."
DB_PASSWORD_VALUE=$(grep '^DB_PASSWORD=' .env | cut -d= -f2- || true)
WRITER_PASSWORD=$(grep "CREATE USER brain_writer" init.sql | sed -n "s/.*PASSWORD '\([^']*\)'.*/\1/p")
READER_PASSWORD=$(grep "CREATE USER brain_reader" init.sql | sed -n "s/.*PASSWORD '\([^']*\)'.*/\1/p")

if [ -z "$DB_PASSWORD_VALUE" ] || [ -z "$WRITER_PASSWORD" ] || [ -z "$READER_PASSWORD" ]; then
    echo -e "  ${RED}✗${NC}  Unable to verify DB_PASSWORD against init.sql"
    ERRORS=$((ERRORS + 1))
elif [ "$DB_PASSWORD_VALUE" != "$WRITER_PASSWORD" ] || [ "$DB_PASSWORD_VALUE" != "$READER_PASSWORD" ]; then
    echo -e "  ${RED}✗${NC}  init.sql role passwords do not match .env DB_PASSWORD"
    ERRORS=$((ERRORS + 1))
else
    echo -e "  ${GREEN}✓${NC}  init.sql passwords match .env DB_PASSWORD"
fi
echo ""

# Check 4: JavaScript syntax
echo "Validating JavaScript syntax..."
if node --check capture-api/index.js 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC}  capture-api/index.js valid"
else
    echo -e "  ${RED}✗${NC}  capture-api/index.js has syntax errors"
    ERRORS=$((ERRORS + 1))
fi

if node --check mcp-server/index.js 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC}  mcp-server/index.js valid"
else
    echo -e "  ${RED}✗${NC}  mcp-server/index.js has syntax errors"
    ERRORS=$((ERRORS + 1))
fi

if node --check mcp-server/http-server.js 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC}  mcp-server/http-server.js valid"
else
    echo -e "  ${RED}✗${NC}  mcp-server/http-server.js has syntax errors"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# Check 5: YAML syntax
echo "Validating docker-compose.yml..."
if python3 -c "import yaml; yaml.safe_load(open('docker-compose.yml'))" 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC}  docker-compose.yml valid"
else
    echo -e "  ${RED}✗${NC}  docker-compose.yml has syntax errors"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# Check 6: Docker availability
echo "Checking Docker availability..."
if command -v docker &> /dev/null; then
    echo -e "  ${GREEN}✓${NC}  Docker found: $(docker --version | head -1)"
else
    echo -e "  ${RED}✗${NC}  Docker not found (install Docker Desktop or Docker Engine)"
    ERRORS=$((ERRORS + 1))
fi

if docker compose version &> /dev/null; then
    echo -e "  ${GREEN}✓${NC}  docker compose (plugin) found"
elif command -v docker-compose &> /dev/null; then
    echo -e "  ${GREEN}✓${NC}  docker-compose found"
else
    echo -e "  ${RED}✗${NC}  docker compose / docker-compose not found"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# Check 7: test script port expectations
echo "Checking test script targets current ports..."
if grep -q 'localhost:8888' test.sh && grep -q 'localhost:3000' test.sh; then
    echo -e "  ${GREEN}✓${NC}  test.sh targets Capture API on 8888 and MCP HTTP on 3000"
else
    echo -e "  ${RED}✗${NC}  test.sh does not target expected ports"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# Summary
echo "===================================="
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✅ All validations passed!${NC}"
    echo ""
    echo "Ready to start:"
    echo "  docker compose up -d db capture-api mcp-server caddy"
    echo ""
    echo "Then run tests:"
    echo "  ./test.sh"
    exit 0
else
    echo -e "${RED}❌ Found $ERRORS error(s)${NC}"
    echo ""
    echo "Please fix the errors above before starting."
    exit 1
fi
