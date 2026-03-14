# File Ingestion Guide

Open Brain supports file ingestion for automatic text extraction and storage.

## Supported file types

### Text
- `.txt`
- `.md`

### Documents
- `.pdf`
- `.docx`

### Images (OCR)
- `.jpg` / `.jpeg`
- `.png`
- `.gif`
- `.bmp`
- `.webp`

## OCR setup

Image OCR uses the z.ai GLM-OCR API.

Add to `.env`:

```bash
ZAI_API_KEY=your_actual_zai_api_key_here
```

Then restart the relevant services:

```bash
docker compose restart capture-api telegram-bot
```

## Upload API

Use the authenticated `/upload` endpoint:

```bash
curl -X POST http://localhost:8888/upload \
  -H "X-OpenBrain-Key: $OPENBRAIN_API_KEY" \
  -F "file=@/path/to/document.pdf"
```

## Telegram uploads

The Telegram bot can upload supported files in private-bot mode.

Required config:

```bash
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALLOWED_CHAT_IDS=123456789
MCP_API_KEY=...
```

Behavior:
- uploads above `10 MB` are rejected before download
- extracted text above the capture API limit is rejected before embedding
- user-facing errors are sanitized

## HTTP MCP search example

HTTP MCP runs on localhost by default and requires `X-MCP-Key`:

```bash
curl -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" \
  -H "X-MCP-Key: $MCP_API_KEY" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "semantic_search",
      "arguments": {"query": "text from screenshot"}
    }
  }'
```

## Database note

Tracked SQL no longer contains live role passwords. Run:

```bash
./setup.sh
```

before starting the stack so `.generated/init.sql` is rendered with the current secrets.

## Troubleshooting

### OCR not working
- verify `ZAI_API_KEY` is set
- inspect `docker compose logs capture-api`

### Upload fails
- confirm file type is supported
- confirm file size is under `10 MB`
- inspect `docker compose logs capture-api`

### Telegram file uploads fail
- inspect `docker compose logs telegram-bot`
- verify `TELEGRAM_ALLOWED_CHAT_IDS` includes your chat ID
- verify `mcp-server-http` is up and `MCP_API_KEY` is configured
