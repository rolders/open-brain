#!/bin/bash
# Open Brain validation script

set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'
ERRORS=0
WARNINGS=0

ENV_FILE=.env
GENERATED_SQL=.generated/init.sql

pass() {
    echo -e "  ${GREEN}✓${NC} $1"
}

warn() {
    echo -e "  ${YELLOW}⚠${NC}  $1"
    WARNINGS=$((WARNINGS + 1))
}

fail() {
    echo -e "  ${RED}✗${NC} $1"
    ERRORS=$((ERRORS + 1))
}

load_env() {
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
}

check_required_file() {
    local path="$1"
    if [ -f "$path" ]; then
        pass "$path present"
    else
        fail "$path missing"
    fi
}

check_not_placeholder() {
    local key="$1"
    local value="${!key:-}"

    if [ -z "$value" ]; then
        fail "$key is missing"
    elif [[ "$value" =~ ^generate_ ]] || [[ "$value" =~ ^your_.*_here$ ]]; then
        fail "$key still uses the example placeholder"
    else
        pass "$key configured"
    fi
}

check_optional_placeholder() {
    local key="$1"
    local value="${!key:-}"

    if [ -z "$value" ] || [[ "$value" =~ ^your_.*_here$ ]]; then
        warn "$key not configured"
    else
        pass "$key configured"
    fi
}

echo "Open Brain Pre-Flight Validation"
echo "================================"
echo

echo "Checking required files..."
check_required_file "$ENV_FILE"
check_required_file init.sql
check_required_file docker-compose.yml
check_required_file Caddyfile
check_required_file capture-api/index.js
check_required_file capture-api/chunking.js
check_required_file capture-api/ingestion-worker.js
check_required_file mcp-server/index.js
check_required_file mcp-server/http-server.js
check_required_file test.sh
check_required_file "$GENERATED_SQL"
echo

if [ ! -f "$ENV_FILE" ]; then
    echo "Cannot continue without .env"
    exit 1
fi

load_env

echo "Checking .env configuration..."
check_not_placeholder OPENBRAIN_API_KEY
check_not_placeholder POSTGRES_PASSWORD
check_not_placeholder BRAIN_WRITER_PASSWORD
check_not_placeholder BRAIN_READER_PASSWORD
check_not_placeholder MCP_API_KEY
check_not_placeholder OPENAI_API_KEY
check_optional_placeholder ZAI_API_KEY
check_optional_placeholder TELEGRAM_BOT_TOKEN

if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && ! [[ "${TELEGRAM_BOT_TOKEN}" =~ ^your_.*_here$ ]]; then
    if [ -n "${TELEGRAM_ALLOWED_CHAT_IDS:-}" ]; then
        pass "TELEGRAM_ALLOWED_CHAT_IDS configured"
    else
        fail "TELEGRAM_ALLOWED_CHAT_IDS must be set when TELEGRAM_BOT_TOKEN is configured"
    fi
else
    warn "TELEGRAM_ALLOWED_CHAT_IDS skipped because Telegram bot is not configured"
fi

echo

echo "Checking rendered database bootstrap SQL..."
if grep -q '__BRAIN_WRITER_PASSWORD__' "$GENERATED_SQL" || grep -q '__BRAIN_READER_PASSWORD__' "$GENERATED_SQL"; then
    fail "$GENERATED_SQL still contains template placeholders"
else
    pass "$GENERATED_SQL rendered"
fi

if grep -q "CREATE USER brain_writer" "$GENERATED_SQL" && grep -q "CREATE USER brain_reader" "$GENERATED_SQL"; then
    pass "database roles present in rendered SQL"
else
    fail "database roles missing from rendered SQL"
fi

echo

echo "Checking compose security defaults..."
if grep -q 'POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}' docker-compose.yml; then
    pass "db uses POSTGRES_PASSWORD env var"
else
    fail "db is not wired to POSTGRES_PASSWORD"
fi

if grep -q 'DB_PASSWORD: ${BRAIN_WRITER_PASSWORD}' docker-compose.yml; then
    pass "capture-api uses BRAIN_WRITER_PASSWORD"
else
    fail "capture-api is not wired to BRAIN_WRITER_PASSWORD"
fi

if grep -q 'container_name: openbrain-ingestion-worker' docker-compose.yml && grep -q 'command: \["node", "ingestion-worker.js"\]' docker-compose.yml; then
    pass "ingestion-worker service configured"
else
    fail "ingestion-worker service is missing or misconfigured"
fi

if grep -q 'DB_PASSWORD: ${BRAIN_READER_PASSWORD}' docker-compose.yml; then
    pass "reader services use BRAIN_READER_PASSWORD"
else
    fail "reader services are not wired to BRAIN_READER_PASSWORD"
fi

if grep -q 'MCP_API_KEY: ${MCP_API_KEY}' docker-compose.yml; then
    pass "mcp-server-http receives MCP_API_KEY"
else
    fail "mcp-server-http is not wired to MCP_API_KEY"
fi

if grep -q 'TELEGRAM_ALLOWED_CHAT_IDS: ${TELEGRAM_ALLOWED_CHAT_IDS}' docker-compose.yml; then
    pass "telegram-bot receives TELEGRAM_ALLOWED_CHAT_IDS"
else
    fail "telegram-bot is not wired to TELEGRAM_ALLOWED_CHAT_IDS"
fi

if grep -q '127.0.0.1:3000:3000' docker-compose.yml; then
    pass "HTTP MCP is bound to localhost only"
else
    fail "HTTP MCP is not bound to localhost only"
fi

if grep -Eq 'ankane/pgvector:latest|caddy:latest' docker-compose.yml; then
    fail "floating core image tags are not allowed (pin exact versions)"
else
    pass "core images are pinned to exact versions"
fi

echo

echo "Validating JavaScript syntax..."
if node --check capture-api/index.js >/dev/null 2>&1; then
    pass "capture-api/index.js valid"
else
    fail "capture-api/index.js has syntax errors"
fi

if node --check capture-api/ingestion-worker.js >/dev/null 2>&1; then
    pass "capture-api/ingestion-worker.js valid"
else
    fail "capture-api/ingestion-worker.js has syntax errors"
fi

if node --check capture-api/chunking.js >/dev/null 2>&1; then
    pass "capture-api/chunking.js valid"
else
    fail "capture-api/chunking.js has syntax errors"
fi

if node --check mcp-server/index.js >/dev/null 2>&1; then
    pass "mcp-server/index.js valid"
else
    fail "mcp-server/index.js has syntax errors"
fi

if node --check mcp-server/http-server.js >/dev/null 2>&1; then
    pass "mcp-server/http-server.js valid"
else
    fail "mcp-server/http-server.js has syntax errors"
fi

echo

echo "Validating docker-compose.yml syntax..."
if python3 -c "import yaml; yaml.safe_load(open('docker-compose.yml'))" >/dev/null 2>&1; then
    pass "docker-compose.yml valid"
else
    fail "docker-compose.yml has syntax errors"
fi

echo

echo "Checking Docker availability..."
if command -v docker >/dev/null 2>&1; then
    pass "Docker found: $(docker --version | head -1)"
else
    fail "Docker not found"
fi

if docker compose version >/dev/null 2>&1; then
    pass "docker compose plugin found"
elif command -v docker-compose >/dev/null 2>&1; then
    pass "docker-compose found"
else
    fail "docker compose / docker-compose not found"
fi

echo

echo "================================"
if [ "$ERRORS" -eq 0 ]; then
    echo -e "${GREEN}Validation passed with ${WARNINGS} warning(s).${NC}"
    echo
    echo "Recommended next steps:"
    echo "  docker compose up -d db capture-api ingestion-worker mcp-server caddy"
    echo "  docker compose up -d mcp-server-http    # optional HTTP MCP"
    echo "  ./test.sh"
    exit 0
fi

echo -e "${RED}Validation failed with ${ERRORS} error(s) and ${WARNINGS} warning(s).${NC}"
exit 1
