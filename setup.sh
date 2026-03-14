#!/bin/bash
set -euo pipefail

ENV_FILE=.env
ENV_EXAMPLE=.env.example
SQL_TEMPLATE=init.sql
GENERATED_DIR=.generated
GENERATED_SQL=${GENERATED_DIR}/init.sql

print_header() {
    echo "Open Brain Setup"
    echo "================"
    echo
}

generate_secret() {
    openssl rand -hex 32
}

upsert_env_var() {
    local key="$1"
    local value="$2"

    python3 - "$ENV_FILE" "$key" "$value" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
prefix = key + "="
lines = path.read_text().splitlines()

for index, line in enumerate(lines):
    if line.startswith(prefix):
        lines[index] = prefix + value
        break
else:
    if lines and lines[-1] != "":
        lines.append("")
    lines.append(prefix + value)

path.write_text("\n".join(lines) + "\n")
PY
}

ensure_secret_var() {
    local key="$1"
    local placeholder="$2"
    local current_value="${!key:-}"

    if [ -z "$current_value" ] || [ "$current_value" = "$placeholder" ]; then
        current_value=$(generate_secret)
        upsert_env_var "$key" "$current_value"
        export "$key=$current_value"
        echo "Generated $key"
    else
        echo "Keeping existing $key"
    fi
}

ensure_value_var() {
    local key="$1"
    local default_value="$2"
    local current_value="${!key:-}"

    if [ -z "$current_value" ]; then
        upsert_env_var "$key" "$default_value"
        export "$key=$default_value"
        echo "Set default $key"
    else
        echo "Keeping existing $key"
    fi
}

render_init_sql() {
    mkdir -p "$GENERATED_DIR"

    python3 - "$SQL_TEMPLATE" "$GENERATED_SQL" <<'PY'
from pathlib import Path
import os
import sys

template_path = Path(sys.argv[1])
output_path = Path(sys.argv[2])

def sql_escape(value: str) -> str:
    return value.replace("'", "''")

content = template_path.read_text()
content = content.replace("__BRAIN_WRITER_PASSWORD__", sql_escape(os.environ["BRAIN_WRITER_PASSWORD"]))
content = content.replace("__BRAIN_READER_PASSWORD__", sql_escape(os.environ["BRAIN_READER_PASSWORD"]))
output_path.write_text(content)
PY

    echo "Rendered $GENERATED_SQL"
}

print_next_steps() {
    echo
    echo "Next steps:"
    echo "1. Edit .env and set OPENAI_API_KEY."
    echo "2. Optionally set ZAI_API_KEY, TELEGRAM_BOT_TOKEN, and TELEGRAM_ALLOWED_CHAT_IDS."
    echo "3. Start the stack with: docker compose up -d db capture-api mcp-server caddy"
    echo
    echo "Important: if you already have a populated pgdata volume, changing POSTGRES_PASSWORD or"
    echo "BRAIN_* passwords in .env will not update the existing database automatically. Either"
    echo "rotate the roles inside PostgreSQL or recreate the volume before expecting new passwords"
    echo "to work. See README.md for the recreate/rotation caveat."
}

print_header

if [ ! -f "$ENV_FILE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    echo "Created $ENV_FILE from $ENV_EXAMPLE"
else
    echo "Using existing $ENV_FILE"
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

ensure_secret_var OPENBRAIN_API_KEY generate_a_secure_random_string_here
ensure_secret_var POSTGRES_PASSWORD generate_a_secure_postgres_password_here
ensure_secret_var BRAIN_WRITER_PASSWORD generate_a_secure_writer_password_here
ensure_secret_var BRAIN_READER_PASSWORD generate_a_secure_reader_password_here
ensure_secret_var MCP_API_KEY generate_a_secure_mcp_api_key_here

ensure_value_var OPENAI_API_KEY your_openai_api_key_here
ensure_value_var ZAI_API_KEY your_zai_api_key_here
ensure_value_var TELEGRAM_BOT_TOKEN your_telegram_bot_token_here
ensure_value_var TELEGRAM_ALLOWED_CHAT_IDS ""
ensure_value_var DB_HOST db
ensure_value_var DB_PORT 5432
ensure_value_var DB_NAME openbrain

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

render_init_sql
print_next_steps
