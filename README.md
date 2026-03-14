# Open Brain - Self-Hosted Memory System for AI Agents

A production-hardened, local Docker environment for a persistent memory system using the Model Context Protocol (MCP) to bridge a private PostgreSQL database with AI agents like Claude and Cursor.

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

## Features

- **Vector Embeddings**: OpenAI text-embedding-3-large (3072 dimensions) stored in PostgreSQL with pgvector
- **Semantic Search**: Cosine similarity search for finding semantically related thoughts
- **File Ingestion**: Upload documents and images for automatic text extraction (see [FILE_INGESTION.md](FILE_INGESTION.md))
- **OCR Support**: Extract text from images using z.ai GLM-OCR API
- **Security**: Principle of least privilege with separate database roles (brain_writer, brain_reader)
- **MCP Protocol**: Standard Model Context Protocol for seamless AI agent integration
- **Telegram Bot**: Capture text and upload files via Telegram (see [TELEGRAM_SETUP.md](TELEGRAM_SETUP.md))
- **Production Ready**: Health checks, graceful shutdowns, connection pooling

## Prerequisites

- Docker 24.0+
- Docker Compose 2.20+
- OpenAI API key

## Quick Start

### 1. Generate Secure Credentials

Generate secure random strings for your environment:

```bash
# Generate a secure API key
OPENBRAIN_API_KEY=$(openssl rand -hex 32)
echo "OPENBRAIN_API_KEY=$OPENBRAIN_API_KEY"

# Generate a secure database password
DB_PASSWORD=$(openssl rand -hex 32)
echo "DB_PASSWORD=$DB_PASSWORD"
```

### 2. Configure Environment

Edit `.env` and replace the placeholders:

```bash
# Security
OPENBRAIN_API_KEY=your_generated_secure_api_key_here
DB_PASSWORD=your_generated_secure_db_password_here

# AI Services
OPENAI_API_KEY=your_openai_api_key_here

# Internal Database
DB_HOST=db
DB_PORT=5432
DB_NAME=openbrain
```

### 3. Update Database Password in init.sql

Edit `init.sql` and replace `REPLACE_WITH_DB_PASSWORD_FROM_ENV` with your actual `DB_PASSWORD`:

```sql
-- Line 17-18, replace both occurrences:
CREATE USER brain_writer WITH PASSWORD 'your_actual_db_password_here';
CREATE USER brain_reader WITH PASSWORD 'your_actual_db_password_here';
```

**Security Note**: In production, consider using Docker secrets or a secrets manager instead of plain text passwords.

### 4. Start the Stack

```bash
docker-compose up -d
```

Check all services are healthy:

```bash
docker-compose ps
```

View logs:

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f capture-api
```

### 5. Test the Capture API

Test adding a thought:

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

Add more thoughts for testing:

```bash
curl -X POST http://localhost:8888/capture \
  -H "Content-Type: application/json" \
  -H "X-OpenBrain-Key: your_openbrain_api_key_here" \
  -d '{
    "content": "PostgreSQL is a powerful open-source relational database with excellent support for JSON data types.",
    "metadata": {
      "source": "documentation",
      "topic": "databases"
    }
  }'
```

Test health endpoint:

```bash
curl http://localhost:8888/health
```

## MCP Server Integration

The MCP server runs over stdio and provides three tools:

### Tools

1. **semantic_search**: Find semantically similar thoughts
   - Input: `query` (string), `limit` (number, optional)
   - Returns: Thoughts ranked by cosine similarity

2. **list_recent**: Get most recent thoughts
   - Input: `limit` (number, optional, default: 20)
   - Returns: Thoughts ordered by creation time

3. **get_stats**: Database statistics
   - Returns: Total thought count, latest thought timestamp

### Connecting with Claude Desktop

Add to your Claude Desktop config file:

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

### Connecting with Cursor

1. Open Cursor Settings
2. Navigate to MCP Servers
3. Add new server:
   - Name: `openbrain`
   - Command: `docker exec -i openbrain-mcp-server node /app/index.js`

### Connecting with OpenClaw or Other MCP Clients

For detailed instructions on connecting OpenClaw or other MCP-compatible clients,
see [MCP_CONNECTION_GUIDE.md](MCP_CONNECTION_GUIDE.md).

**Quick Start - HTTP Connection:**
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

**Quick Start - Stdio Connection:**
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

## Telegram Bot Integration

Capture and search your thoughts directly from Telegram! 📱

### Quick Setup

1. **Create a Telegram Bot**:
   - Message @BotFather on Telegram: `/newbot`
   - Follow prompts and copy your bot token

2. **Configure Environment**:
   ```bash
   # Add to .env
   TELEGRAM_BOT_TOKEN=your_bot_token_here
   ```

3. **Start the Bot**:
   ```bash
   docker compose build telegram-bot mcp-server-http
   docker compose up -d telegram-bot mcp-server-http
   ```

4. **Start Using**:
   - Open Telegram and search for your bot
   - Send `/start` to begin

### Available Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/start` | Initialize bot | `/start` |
| `/capture <text>` | Store a thought | `/capture Docker containers are lightweight` |
| `/search <query>` | Semantic search | `/search database technology` |
| `/recent [limit]` | Show recent thoughts | `/recent 10` |
| `/stats` | Show statistics | `/stats` |

**Full documentation**: See [TELEGRAM_SETUP.md](TELEGRAM_SETUP.md)

## API Endpoints

### POST /capture

Store a new thought with automatic embedding generation.

**Headers**:
- `Content-Type: application/json`
- `X-OpenBrain-Key`: Your API key from `.env`

**Body**:
```json
{
  "content": "The thought content to store (required)",
  "metadata": {  // optional
    "any": "custom fields",
    "tags": ["important", "reference"]
  }
}
```

**Response**:
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

### GET /health

Health check endpoint (no authentication required).

## Security Features

### Database Roles

- **brain_writer**: Can INSERT and SELECT thoughts (used by capture-api)
- **brain_reader**: Can only SELECT thoughts (used by mcp-server)
- **postgres**: Administrative access (database initialization only)

### API Authentication

All `/capture` requests must include:
```
X-OpenBrain-Key: your_api_key_here
```

Invalid or missing keys return `401 Unauthorized`.

### Performance Notes

- **Embedding Model**: text-embedding-3-large provides higher quality semantic understanding
- **Search Method**: Sequential scan with cosine distance (HNSW indexing not supported for >2000 dimensions)
- **Recommended**: For better performance with large datasets, consider text-embedding-3-small (1536 dimensions) with HNSW indexing

## Troubleshooting

### Database Connection Issues

Check database logs:
```bash
docker-compose logs db
```

Verify database is accepting connections:
```bash
docker-compose exec db pg_isready -U postgres
```

### MCP Server Not Responding

Ensure the MCP server container is running:
```bash
docker-compose ps mcp-server
```

Test manually:
```bash
docker exec -i openbrain-mcp-server node /app/index.js
```

Then send a JSON-RPC message:
```json
{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
```

### Permission Errors

If you see permission errors, verify:
1. `.env` DB_PASSWORD matches `init.sql`
2. Database was initialized with `init.sql`
3. Try recreating the database:
   ```bash
   docker-compose down -v
   docker-compose up -d
   ```

## Development

### Rebuild Services

After modifying code:

```bash
docker-compose build capture-api mcp-server
docker-compose up -d
```

### Access Database Directly

```bash
docker-compose exec db psql -U postgres -d openbrain
```

Useful queries:

```sql
-- View all thoughts
SELECT id, left(content, 50) as content, created_at FROM thoughts;

-- Count thoughts
SELECT COUNT(*) FROM thoughts;

-- Search using raw vector similarity
SELECT content, 1 - (embedding <=> '[0.1, 0.2, ...]') as similarity
FROM thoughts
ORDER BY embedding <=> '[0.1, 0.2, ...]'
LIMIT 5;
```

## Production Considerations

1. **Use Docker Secrets** for sensitive credentials
2. **Enable HTTPS** with Caddy for production endpoints
3. **Set resource limits** in docker-compose.yml
4. **Configure automated backups** of PostgreSQL
5. **Monitor logs** with centralized logging
6. **Scale services** independently (consider multiple capture-api instances)
7. **Regular security updates** of base images

## License

MIT

## Contributing

This is a personal project, but suggestions and improvements are welcome!
