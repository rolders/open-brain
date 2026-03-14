# Open Brain - Self-Hosted Memory System for AI Agents

A local Docker-based memory system for AI agents. Open Brain stores thoughts, documents, and extracted metadata in PostgreSQL, generates embeddings with OpenAI, and exposes memory tools through MCP.

## Architecture

```
┌─────────────┐      ┌──────────┐      ┌──────────────┐
│   Client    │─────▶│  Caddy   │─────▶│ Capture API  │
│  (AI Agent) │      │ (8888)   │      │   (Node.js)  │
└─────────────┘      └──────────┘      └──────┬───────┘
                                            │
                                            ▼
                                    ┌──────────────┐
                                    │  PostgreSQL  │
                                    │  + pgvector  │
                                    └──────┬───────┘
                                           │
┌─────────────┐      ┌──────────┐         │
│   Claude    │◀─────│ MCP Svr  │◀────────┘
│   Cursor    │      │ (stdio)  │
└─────────────┘      └──────────┘
```

Optional services:
- `mcp-server-http`: HTTP MCP endpoint on port `3000`
- `telegram-bot`: Telegram bot for capture and search

## Features

- **Persistent memory** in PostgreSQL with `pgvector`
- **Vector embeddings** using OpenAI `text-embedding-3-large` (3072 dimensions)
- **Semantic search** using cosine similarity
- **Structured metadata extraction** using `gpt-4o` for people, topics, and action items
- **File ingestion** for text, Markdown, PDF, DOCX, and image files
- **OCR support** for images using z.ai GLM-OCR API
- **MCP integration** for stdio and HTTP-based MCP clients
- **Telegram bot** for capture and search from Telegram
- **Role-based DB access** with separate reader and writer roles

Related docs:
- File ingestion: [FILE_INGESTION.md](FILE_INGESTION.md)
- Telegram setup: [TELEGRAM_SETUP.md](TELEGRAM_SETUP.md)
- MCP client setup: [MCP_CONNECTION_GUIDE.md](MCP_CONNECTION_GUIDE.md)

## Prerequisites

Required:
- Docker 24.0+
- Docker Compose 2.20+
- OpenAI API key

Optional:
- z.ai API key for OCR on images
- Telegram bot token for Telegram integration

## Ports

- `8888` → Caddy reverse proxy for the Capture API
- `3000` → HTTP MCP server (`mcp-server-http`, optional)

## Quick Start

### 1. Generate secure credentials

```bash
OPENBRAIN_API_KEY=$(openssl rand -hex 32)
echo "OPENBRAIN_API_KEY=$OPENBRAIN_API_KEY"

DB_PASSWORD=$(openssl rand -hex 32)
echo "DB_PASSWORD=$DB_PASSWORD"
```

### 2. Create and configure `.env`

```bash
cp .env.example .env
```

Edit `.env` and fill in at least:

```bash
# Security
OPENBRAIN_API_KEY=your_generated_secure_api_key_here
DB_PASSWORD=your_generated_secure_db_password_here

# AI Services
OPENAI_API_KEY=your_openai_api_key_here
ZAI_API_KEY=your_zai_api_key_here   # optional, required for OCR

# Telegram Bot
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here  # optional

# Internal Database
DB_HOST=db
DB_PORT=5432
DB_NAME=openbrain
```

### 3. Update `init.sql`

The DB roles in `init.sql` must use the same password as `DB_PASSWORD` in `.env`.

Edit `init.sql` and replace the password used for both roles:

```sql
CREATE USER brain_writer WITH PASSWORD 'your_actual_db_password_here';
CREATE USER brain_reader WITH PASSWORD 'your_actual_db_password_here';
```

Note:
- `DB_PASSWORD` is used by the application roles `brain_writer` and `brain_reader`
- the Postgres superuser password is configured separately in `docker-compose.yml`

### 4. Start the core stack

```bash
docker compose up -d db capture-api mcp-server caddy
```

Check service status:

```bash
docker compose ps
```

View logs:

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f capture-api
```

### 5. Test the Capture API

Add a thought:

```bash
curl -X POST http://localhost:8888/capture \
  -H "Content-Type: application/json" \
  -H "X-OpenBrain-Key: your_openbrain_api_key_here" \
  -d '{
    "content": "The first thing I learned about Docker is that containers are lightweight virtualization units.",
    "metadata": {
      "source": "tutorial",
      "importance": "high"
    }
  }'
```

Expected response:

```json
{
  "success": true,
  "data": {
    "id": 1,
    "content": "The first thing I learned about Docker...",
    "metadata": {
      "source": "tutorial",
      "importance": "high"
    },
    "created_at": "2024-01-15T10:30:00.000Z"
  }
}
```

Check the proxy health endpoint:

```bash
curl http://localhost:8888/health
```

Expected response:

```text
OK
```

Note: `/health` on port `8888` is served by Caddy. The Capture API also exposes its own JSON health endpoint internally at `http://capture-api:3000/health` inside the Docker network.

## What gets stored

Each thought may include:
- `content`
- `metadata` provided by the caller
- extracted metadata (`people`, `topics`, `action_items`)
- OpenAI embedding vector
- optional file metadata such as filename, type, and size
- `created_at` timestamp

## API Endpoints

### POST `/capture`

Store a text thought and generate:
- extracted metadata with `gpt-4o`
- embedding with `text-embedding-3-large`

Headers:
- `Content-Type: application/json`
- `X-OpenBrain-Key: your_api_key_here`

Body:

```json
{
  "content": "The thought content to store (required)",
  "metadata": {
    "any": "custom fields",
    "tags": ["important", "reference"]
  }
}
```

Response:

```json
{
  "success": true,
  "data": {
    "id": 1,
    "content": "...",
    "metadata": {},
    "created_at": "2024-01-15T10:30:00.000Z"
  }
}
```

### POST `/upload`

Upload a file for text extraction, metadata extraction, embedding generation, and storage.

Headers:
- `X-OpenBrain-Key: your_api_key_here`
- `Content-Type: multipart/form-data`

Supported file types:
- `.txt`
- `.md`
- `.pdf`
- `.docx`
- `.jpg`, `.jpeg`, `.png`, `.gif`, `.bmp`, `.webp`

Current upload limit:
- 10 MB per file

Example:

```bash
curl -X POST http://localhost:8888/upload \
  -H "X-OpenBrain-Key: your_openbrain_api_key_here" \
  -F "file=@./notes.pdf"
```

Example response:

```json
{
  "success": true,
  "data": {
    "id": 2,
    "content": "Preview of extracted content...",
    "full_content_length": 4321,
    "metadata": {
      "source": "file_upload",
      "filename": "notes.pdf",
      "file_type": ".pdf",
      "file_size": 123456,
      "mimetype": "application/pdf"
    },
    "original_filename": "notes.pdf",
    "file_type": ".pdf",
    "file_size": 123456,
    "created_at": "2024-01-15T10:31:00.000Z"
  }
}
```

### GET `/health`

Health check endpoint through Caddy.

Response:

```text
OK
```

## MCP Server Integration

There are two MCP modes in this repo:

### 1. Stdio MCP server

Service: `mcp-server`

Tools:
1. `semantic_search`
2. `list_recent`
3. `get_stats`

#### Claude Desktop

Add to your Claude Desktop config:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "openbrain": {
      "command": "docker",
      "args": [
        "exec",
        "-i",
        "openbrain-mcp-server",
        "node",
        "/app/index.js"
      ]
    }
  }
}
```

#### Cursor

Command:

```text
docker exec -i openbrain-mcp-server node /app/index.js
```

### 2. HTTP MCP server

Service: `mcp-server-http`

Start it with:

```bash
docker compose up -d mcp-server-http
```

Exposes MCP on:

```text
http://localhost:3000/mcp
```

HTTP MCP tools currently include:
1. `semantic_search`
2. `list_recent`
3. `get_stats`
4. `semantic_search_filtered`
5. `get_metadata_stats`

Quick-start config:

```json
{
  "mcpServers": {
    "openbrain": {
      "url": "http://localhost:3000/mcp",
      "transport": "http"
    }
  }
}
```

For OpenClaw and other MCP clients, see [MCP_CONNECTION_GUIDE.md](MCP_CONNECTION_GUIDE.md).

## Telegram Bot Integration

Capture and search thoughts directly from Telegram.

### Quick setup

1. Create a bot with `@BotFather`
2. Add `TELEGRAM_BOT_TOKEN` to `.env`
3. Start the bot and HTTP MCP service:

```bash
docker compose up -d telegram-bot mcp-server-http
```

### Available commands

| Command | Description | Example |
|---|---|---|
| `/start` | Initialize bot | `/start` |
| `/capture <text>` | Store a thought | `/capture Docker containers are lightweight` |
| `/search <query>` | Semantic search | `/search database technology` |
| `/recent [limit]` | Show recent thoughts | `/recent 10` |
| `/stats` | Show statistics | `/stats` |

Full setup details: [TELEGRAM_SETUP.md](TELEGRAM_SETUP.md)

## Security Notes

### Database roles

- `brain_writer`: `INSERT` and `SELECT` on `thoughts`
- `brain_reader`: `SELECT` on `thoughts`
- `postgres`: admin access for initialization

### API authentication

All `/capture` and `/upload` requests must include:

```text
X-OpenBrain-Key: your_api_key_here
```

Invalid or missing keys return `401 Unauthorized`.

### Deployment note

This repo is best treated as a local or self-hosted deployment baseline. Before exposing services beyond a trusted environment, review:
- secret handling
- TLS/HTTPS configuration
- network exposure of the HTTP MCP server
- database credential management

## Performance Notes

- `text-embedding-3-large` provides higher-quality semantic search but uses 3072 dimensions
- HNSW indexing is not supported for vectors over 2000 dimensions in this setup
- semantic search therefore uses sequential scan with cosine distance
- for larger datasets, consider `text-embedding-3-small` (1536 dimensions) plus indexing

## Troubleshooting

### Database connection issues

```bash
docker compose logs db
docker compose exec db pg_isready -U postgres
```

### MCP server not responding

```bash
docker compose ps mcp-server
docker exec -i openbrain-mcp-server node /app/index.js
```

Then send a JSON-RPC message such as:

```json
{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
```

### Permission errors

Check that:
1. `.env` `DB_PASSWORD` matches the password used in `init.sql`
2. the database was initialized from the expected `init.sql`
3. if needed, recreate the database volume:

```bash
docker compose down -v
docker compose up -d db capture-api mcp-server caddy
```

## Development

### Rebuild services

```bash
docker compose build capture-api mcp-server mcp-server-http telegram-bot
docker compose up -d
```

### Access the database directly

```bash
docker compose exec db psql -U postgres -d openbrain
```

Useful queries:

```sql
-- View all thoughts
SELECT id, left(content, 50) AS content, created_at FROM thoughts;

-- Count thoughts
SELECT COUNT(*) FROM thoughts;
```

## Production Considerations

1. Use a proper secret-management approach
2. Enable HTTPS for externally exposed endpoints
3. Set resource limits in `docker-compose.yml`
4. Configure PostgreSQL backups
5. Monitor logs centrally
6. Review which services need public exposure
7. Keep container base images updated

## License

MIT

## Contributing

This is a personal project, but suggestions and improvements are welcome.
