#!/bin/bash
set -euo pipefail

ENV_FILE=".env"
DRY_RUN=false
RESTART_SERVICES=false
NON_INTERACTIVE=false
BACKUP_FILE=""

usage() {
  cat <<'EOF'
Usage: scripts/rotate-secrets.sh [options]

Rotate PostgreSQL credentials used by Open Brain.

Options:
  --dry-run          Show planned actions without changing files or database
  --service-restart  Restart db/capture-api/mcp-server/mcp-server-http after rotation
  --non-interactive  Do not ask for confirmation prompts
  -h, --help         Show this help message
EOF
}

log() {
  echo "[rotate-secrets] $*"
}

die() {
  echo "[rotate-secrets] ERROR: $*" >&2
  exit 1
}

generate_secret() {
  openssl rand -hex 32
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run)
        DRY_RUN=true
        ;;
      --service-restart)
        RESTART_SERVICES=true
        ;;
      --non-interactive)
        NON_INTERACTIVE=true
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "Unknown option: $1"
        ;;
    esac
    shift
  done
}

require_prereqs() {
  [ -f "$ENV_FILE" ] || die "$ENV_FILE not found"
  command -v docker >/dev/null 2>&1 || die "docker is required"
  docker compose ps db >/dev/null 2>&1 || die "database service is not available via docker compose"
}

confirm_or_exit() {
  if $NON_INTERACTIVE || $DRY_RUN; then
    return 0
  fi

  read -r -p "Rotate postgres/brain_writer/brain_reader passwords now? [y/N] " answer
  case "$answer" in
    y|Y|yes|YES)
      ;;
    *)
      die "Cancelled by user"
      ;;
  esac
}

update_env_file() {
  local postgres_password="$1"
  local writer_password="$2"
  local reader_password="$3"

  BACKUP_FILE="${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)"

  if $DRY_RUN; then
    log "DRY RUN: would backup $ENV_FILE to $BACKUP_FILE"
    log "DRY RUN: would update POSTGRES_PASSWORD, BRAIN_WRITER_PASSWORD, BRAIN_READER_PASSWORD in $ENV_FILE"
    return 0
  fi

  cp "$ENV_FILE" "$BACKUP_FILE"
  log "Backed up $ENV_FILE to $BACKUP_FILE"

  python3 - "$ENV_FILE" "$postgres_password" "$writer_password" "$reader_password" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
updates = {
    "POSTGRES_PASSWORD": sys.argv[2],
    "BRAIN_WRITER_PASSWORD": sys.argv[3],
    "BRAIN_READER_PASSWORD": sys.argv[4],
}
lines = path.read_text().splitlines()

for key, value in updates.items():
    prefix = key + "="
    for idx, line in enumerate(lines):
        if line.startswith(prefix):
            lines[idx] = prefix + value
            break
    else:
        if lines and lines[-1] != "":
            lines.append("")
        lines.append(prefix + value)

path.write_text("\n".join(lines) + "\n")
PY

  log "Updated $ENV_FILE"
}

apply_role_rotation() {
  local postgres_password="$1"
  local writer_password="$2"
  local reader_password="$3"

  local commands=(
    "ALTER ROLE postgres WITH PASSWORD '${postgres_password}';"
    "ALTER ROLE brain_writer WITH PASSWORD '${writer_password}';"
    "ALTER ROLE brain_reader WITH PASSWORD '${reader_password}';"
  )

  for sql in "${commands[@]}"; do
    if $DRY_RUN; then
      log "DRY RUN: would execute SQL: ${sql}"
    else
      docker compose exec -T db psql -U postgres -d openbrain -c "$sql" >/dev/null
      log "Applied: ${sql%% *} ${sql#ALTER ROLE }"
    fi
  done
}

restart_dependents() {
  if ! $RESTART_SERVICES; then
    log "Skipping service restart (pass --service-restart to restart dependent services)"
    return 0
  fi

  local services=(db capture-api mcp-server mcp-server-http)

  if $DRY_RUN; then
    log "DRY RUN: would restart services: ${services[*]}"
    return 0
  fi

  log "Restarting services: ${services[*]}"
  docker compose restart "${services[@]}" >/dev/null
}

main() {
  parse_args "$@"
  require_prereqs

  local postgres_password
  local writer_password
  local reader_password

  postgres_password=$(generate_secret)
  writer_password=$(generate_secret)
  reader_password=$(generate_secret)

  confirm_or_exit

  update_env_file "$postgres_password" "$writer_password" "$reader_password"

  if ! apply_role_rotation "$postgres_password" "$writer_password" "$reader_password"; then
    if [ -n "$BACKUP_FILE" ] && [ -f "$BACKUP_FILE" ]; then
      cp "$BACKUP_FILE" "$ENV_FILE"
      log "Restored $ENV_FILE from backup after failure"
    fi
    die "Role rotation failed"
  fi

  restart_dependents

  if $DRY_RUN; then
    log "Dry run complete"
  else
    log "Secret rotation complete"
    log "Run ./validate.sh and ./test.sh to verify connectivity"
  fi
}

main "$@"
