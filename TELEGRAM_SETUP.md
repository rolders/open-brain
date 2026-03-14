# Telegram Bot Setup

Open Brain includes an optional Telegram bot for private capture and search.

## Security model

The bot is now designed for **private-bot mode** by default.

Required environment variables:

```bash
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALLOWED_CHAT_IDS=123456789,987654321
OPENBRAIN_API_KEY=...
MCP_API_KEY=...
```

Notes:
- `TELEGRAM_ALLOWED_CHAT_IDS` is a comma-separated allowlist of authorized Telegram chat IDs.
- Unauthorized chats are rejected.
- The bot still stores structured Telegram metadata so per-user isolation can be added later without changing the ingestion shape.
- The bot uses the authenticated HTTP MCP endpoint for `/search`, `/recent`, and `/stats`, so `MCP_API_KEY` must be configured.

## Setup

Run the bootstrap flow first:

```bash
./setup.sh
./validate.sh
```

Then set at least:

```bash
OPENAI_API_KEY=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALLOWED_CHAT_IDS=123456789
```

Start the required services:

```bash
docker compose up -d capture-api mcp-server-http telegram-bot
```

Check logs:

```bash
docker compose logs -f telegram-bot
docker compose logs -f mcp-server-http
```

## Commands

- `/start`
- `/help`
- `/capture <text>`
- `/search <query>`
- `/recent [limit]`
- `/stats`

## Limits and behavior

- `/recent` defaults to `5` and is clamped to a maximum of `20`
- document/photo uploads above `10 MB` are rejected before download
- user-facing errors are sanitized

## Finding your chat ID

One simple approach is to temporarily log bot requests, message the bot from your private chat, and read the numeric `chat.id` from the Telegram bot logs or by using a Telegram helper bot/service you trust.

## Troubleshooting

### Bot exits immediately

Check for missing allowlist or token values:

```bash
docker compose logs telegram-bot
```

### Search/recent/stats fail

Confirm the HTTP MCP service is running and the bot has `MCP_API_KEY` configured:

```bash
docker compose ps mcp-server-http
docker compose logs mcp-server-http
```

### Unauthorized chat rejected

Add the numeric chat ID to `TELEGRAM_ALLOWED_CHAT_IDS`, then restart the bot:

```bash
docker compose restart telegram-bot
```
