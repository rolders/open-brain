# MCP Connection Guide for OpenClaw

This guide shows how to connect OpenClaw (or any MCP-compatible client) to your Open Brain memory system.

## Connection Methods

There are two ways to connect to the Open Brain MCP server:

### Method 1: HTTP Connection (Recommended for OpenClaw)

Connect via HTTP endpoint on port 3000.

**Configuration:**
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

**If connecting from outside Docker:**
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

**If using docker-compose networking:**
```json
{
  "mcpServers": {
    "openbrain": {
      "url": "http://mcp-server-http:3000/mcp",
      "transport": "http"
    }
  }
}
```

### Method 2: Stdio Connection (For Desktop Apps)

Connect via Docker stdio (recommended for Claude Desktop, Cursor).

**Configuration:**
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

## Available MCP Tools

Once connected, OpenClaw can access these tools:

### 1. semantic_search
Search your memory using semantic similarity.

**Parameters:**
- `query` (string, required): Search query
- `limit` (number, optional): Max results (default: 5)

**Example:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "semantic_search",
    "arguments": {
      "query": "docker containers",
      "limit": 5
    }
  }
}
```

### 2. list_recent
Get most recent thoughts.

**Parameters:**
- `limit` (number, optional): Max results (default: 20)

**Example:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "list_recent",
    "arguments": {
      "limit": 10
    }
  }
}
```

### 3. get_stats
Get memory statistics.

**Parameters:** None

**Example:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_stats",
    "arguments": {}
  }
}
```

## OpenClaw-Specific Configuration

### For OpenClaw Desktop App

1. **Open OpenClaw Settings**
2. **Navigate to MCP Servers**
3. **Add new server with these settings:**

**Using HTTP (Recommended):**
```
Name: openbrain
URL: http://localhost:3000/mcp
Transport: HTTP
```

**Using Docker:**
```
Name: openbrain
Command: docker exec -i openbrain-mcp-server node /app/index.js
Type: stdio
```

### For OpenClaw CLI

**Environment variables:**
```bash
export OPENBRAIN_MCP_URL="http://localhost:3000/mcp"
export OPENBRAIN_API_KEY="your_openbrain_api_key_here"
```

**Config file (~/.openclaw/config.json):**
```json
{
  "mcp": {
    "servers": {
      "openbrain": {
        "url": "http://localhost:3000/mcp",
        "apiKey": "your_openbrain_api_key_here"
      }
    }
  }
}
```

## Testing the Connection

### Test via curl

**List available tools:**
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'
```

**Test semantic search:**
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "semantic_search",
      "arguments": {
        "query": "docker",
        "limit": 3
      }
    }
  }'
```

### Test via Docker exec

```bash
docker exec -i openbrain-mcp-server node /app/index.js << EOF
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
EOF
```

## Troubleshooting

### Connection Refused

**Problem:** Cannot connect to MCP server

**Solutions:**
1. Check if MCP HTTP server is running:
   ```bash
   docker ps | grep mcp-server-http
   ```

2. Check server logs:
   ```bash
   docker logs openbrain-mcp-server-http
   ```

3. Restart the server:
   ```bash
   docker compose restart mcp-server-http
   ```

### Permission Errors

**Problem:** Access denied when calling tools

**Solution:** Verify OPENBRAIN_API_KEY matches between services

### Docker Networking Issues

**Problem:** Cannot connect from host machine

**Solution:** Ensure port 3000 is exposed:
```bash
docker compose ps mcp-server-http
# Should show: 0.0.0.0:3000->3000/tcp
```

## Usage Examples

### Example 1: Search and Retrieve

```python
import openclaw

# Connect to Open Brain
openclaw.connect_mcp("openbrain", "http://localhost:3000/mcp")

# Search memory
results = openclaw.call_tool("semantic_search", {
    "query": "machine learning embeddings",
    "limit": 5
})

# Display results
for thought in results["thoughts"]:
    print(f"{thought['similarity']:.1%} - {thought['content'][:100]}...")
```

### Example 2: Store and Search

```python
import openclaw

# Store a memory
openclaw.call_tool("capture", {
    "content": "Neural networks use backpropagation for training",
    "metadata": {"source": "openclaw", "topic": "ml"}
})

# Search for it
results = openclaw.call_tool("semantic_search", {
    "query": "neural network training"
})
```

### Example 3: Get Recent Thoughts

```python
import openclaw

# Get latest 10 thoughts
recent = openclaw.call_tool("list_recent", {"limit": 10})

for thought in recent["thoughts"]:
    print(f"{thought['created_at']}: {thought['content'][:80]}...")
```

## Advanced Configuration

### Custom Port Mapping

If port 3000 is already in use, modify `docker-compose.yml`:

```yaml
mcp-server-http:
  ports:
    - "3001:3000"  # Map host port 3001 to container port 3000
```

Then connect to: `http://localhost:3001/mcp`

### Multiple MCP Servers

You can run multiple Open Brain instances:

```yaml
mcp-server-http-1:
  ports:
    - "3000:3000"

mcp-server-http-2:
  ports:
    - "3001:3000"
```

## Security Notes

1. **API Key Required**: All /capture requests require OPENBRAIN_API_KEY
2. **Read-only MCP**: MCP server uses brain_reader role (can only read)
3. **Local Only**: By default, services are not exposed externally
4. **HTTPS in Production**: Use Caddy for HTTPS in production environments

## Performance Tips

1. **HTTP vs Stdio**: HTTP is faster for frequent queries
2. **Connection Pooling**: Reuse HTTP connections when possible
3. **Batch Queries**: Use higher limit values rather than multiple queries
4. **Caching**: Cache frequently accessed thoughts in your application

## Additional Resources

- [MCP Specification](https://modelcontextprotocol.io/)
- [Open Brain README](README.md)
- [File Ingestion Guide](FILE_INGESTION.md)
- [Telegram Bot Setup](TELEGRAM_SETUP.md)
