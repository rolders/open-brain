# MCP Connection Guide

Open Brain exposes MCP in two modes:
- `mcp-server`: stdio for local desktop apps
- `mcp-server-http`: HTTP for clients that support MCP over HTTP

## Recommended default

Use stdio when possible. The HTTP endpoint is optional and is intentionally published on localhost only:

```text
http://127.0.0.1:3000/mcp
```

That means:
- local host processes can connect directly
- remote machines cannot connect unless you add an explicit tunnel or proxy

## Required setup

Run the bootstrap flow first:

```bash
./setup.sh
./validate.sh
```

Make sure `.env` contains:

```bash
OPENAI_API_KEY=...
MCP_API_KEY=...
BRAIN_READER_PASSWORD=...
```

Start the HTTP service only if you need it:

```bash
docker compose up -d mcp-server-http
```

## HTTP MCP client config

Basic endpoint:

```json
{
  "mcpServers": {
    "openbrain": {
      "url": "http://127.0.0.1:3000/mcp",
      "transport": "http"
    }
  }
}
```

If your MCP client supports custom headers, configure the generated MCP key as well:

```json
{
  "mcpServers": {
    "openbrain": {
      "url": "http://127.0.0.1:3000/mcp",
      "transport": "http",
      "headers": {
        "X-MCP-Key": "<your MCP_API_KEY>"
      }
    }
  }
}
```

If your client cannot set headers directly, front the service with a local proxy that injects `X-MCP-Key`.

## Docker-network clients

Containers on the same Compose network can use the internal service name instead of the host bind:

```json
{
  "mcpServers": {
    "openbrain": {
      "url": "http://mcp-server-http:3000/mcp",
      "transport": "http",
      "headers": {
        "X-MCP-Key": "<your MCP_API_KEY>"
      }
    }
  }
}
```

## Stdio MCP config

For Claude Desktop, Cursor, and similar tools:

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

Equivalent command-line form:

```text
docker exec -i openbrain-mcp-server node /app/index.js
```

## Quick curl checks

Health check:

```bash
curl http://127.0.0.1:3000/health
```

Tool list request:

```bash
curl -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" \
  -H "X-MCP-Key: $MCP_API_KEY" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'
```

Tool call request:

```bash
curl -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" \
  -H "X-MCP-Key: $MCP_API_KEY" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "list_recent",
      "arguments": {"limit": 5}
    }
  }'
```

## Troubleshooting

### Connection refused

```bash
docker compose ps mcp-server-http
docker compose logs mcp-server-http
```

Remember that the default host bind is `127.0.0.1:3000`, not `0.0.0.0:3000`.

### Authentication failures

Confirm the client is sending the same `MCP_API_KEY` value that exists in `.env`.

### Database permission issues

The MCP services use the read-only database role:

```bash
BRAIN_READER_PASSWORD=...
```

If the database was created before the new env model, review the existing-volume rotation/recreate caveat in [README.md](README.md).
