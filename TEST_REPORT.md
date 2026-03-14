# Open Brain Test Report

This file previously contained stale claims that no longer matched the codebase.

## Current status

Do **not** use this document as the source of truth for security posture, ports, embedding model configuration, indexing strategy, or test coverage.

Use these instead:
- `README.md` for setup and runtime behavior
- `MCP_CONNECTION_GUIDE.md` for MCP connection details
- `TELEGRAM_SETUP.md` for Telegram configuration
- `FILE_INGESTION.md` for upload/OCR behavior
- `validate.sh` and `test.sh` for the actual verification flow

## Canonical verification commands

```bash
./setup.sh
./validate.sh
docker compose up -d db capture-api mcp-server caddy
./test.sh
```

## Notes

The project has recently been hardened to:
- stop tracking live DB credentials in committed config
- require `MCP_API_KEY` for HTTP MCP requests
- bind the HTTP MCP service to localhost by default
- enforce Telegram chat allowlisting in private-bot mode

If you need a fresh test report, regenerate it from the current code and command output rather than relying on historical text.
