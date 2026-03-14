#!/bin/bash
# Open Brain Validation Script
# Validates the setup before starting Docker

set -e

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
FILES=(".env" "init.sql" "docker-compose.yml" "Caddyfile" "capture-api/index.js" "mcp-server/index.js")
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

# Check 3: init.sql passwords match .env
echo "Checking init.sql password sync..."
if grep -q "REPLACE_WITH_DB_PASSWORD_FROM_ENV" init.sql; then
    echo -e "  ${RED}✗${NC}  init.sql still has placeholder (run ./setup.sh)"
    ERRORS=$((ERRORS + 1))
else
    echo -e "  ${GREEN}✓${NC}  init.sql passwords configured"
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

if command -v docker-compose &> /dev/null; then
    echo -e "  ${GREEN}✓${NC}  docker-compose found"
elif docker compose version &> /dev/null; then
    echo -e "  ${GREEN}✓${NC}  docker compose (plugin) found"
else
    echo -e "  ${RED}✗${NC}  docker-compose not found"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# Summary
echo "===================================="
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✅ All validations passed!${NC}"
    echo ""
    echo "Ready to start:"
    echo "  docker compose up -d"
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
