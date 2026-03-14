# Telegram Bot Integration for Open Brain

Connect your Open Brain memory system to Telegram for easy thought capture and semantic search on the go!

## Features

- **💾 Capture Thoughts**: Store memories directly from Telegram
- **🔍 Semantic Search**: Find thoughts by meaning, not just keywords
- **📝 Recent Thoughts**: View your latest memories
- **📊 Statistics**: Track your memory growth
- **🎯 Natural Language**: Just type commands in plain English

## Quick Setup

### 1. Create a Telegram Bot

1. Open Telegram and search for **@BotFather**
2. Send the command: `/newbot`
3. Follow the prompts to name your bot (e.g., "Open Brain Memory")
4. BotFather will give you a **bot token** (looks like `123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ`)
5. Copy this token

### 2. Configure Environment

Add your bot token to `.env`:

```bash
# Add this line to your .env file
TELEGRAM_BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ
```

### 3. Start the Bot

```bash
# Build and start all services including the Telegram bot
docker compose build telegram-bot mcp-server-http
docker compose up -d telegram-bot mcp-server-http

# Check logs
docker compose logs -f telegram-bot
```

### 4. Start Using Your Bot

1. Open Telegram
2. Search for your bot by name
3. Click **Start** or send `/start`
4. Begin capturing memories!

## Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/start` | Initialize the bot | `/start` |
| `/help` | Show help message | `/help` |
| `/capture <text>` | Store a thought | `/capture Docker containers are lightweight` |
| `/search <query>` | Search by meaning | `/search database technology` |
| `/recent [limit]` | Show recent thoughts | `/recent 10` |
| `/stats` | Show statistics | `/stats` |

## Usage Examples

### Capture a Quick Thought

```
You: /capture PostgreSQL has excellent JSON support
Bot: ✅ Thought Captured!
     ID: 42
     Created: 3/14/2026, 2:30:45 PM
```

### Semantic Search

```
You: /search container virtualization
Bot: 🔍 Search Results: "container virtualization"

1. 92% match
   Docker containers are isolated runtime environments...

2. 78% match
   Kubernetes orchestrates container deployments...

3. 65% match
   Virtual machines vs containers comparison...
```

### View Recent Thoughts

```
You: /recent 5
Bot: 📝 Recent 5 Thoughts

1. PostgreSQL handles JSON data well...
   📅 3/14/2026

2. Machine learning uses embeddings...
   📅 3/14/2026

3. Docker containers isolate applications...
   📅 3/14/2026
```

### Check Statistics

```
You: /stats
Bot: 📊 Memory Statistics

📝 Total Thoughts: 127
🕐 Latest: 3/14/2026, 3:45:12 PM

🧠 Your memory is growing!
```

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│  Telegram   │────▶│  Telegram Bot    │────▶│ Capture API  │
│   (You)     │     │   (Node.js)      │     │   (Fastify)  │
└─────────────┘     └──────────────────┘     └──────┬───────┘
                            │                        │
                            │                        ▼
                            │                 ┌──────────────┐
                            │                 │  PostgreSQL  │
                            │                 │  + pgvector  │
                            └────────────────▶│              │
                              (search)        └──────────────┘
```

## Advanced Configuration

### Custom Commands

Modify `telegram-bot/index.js` to add custom commands:

```javascript
// Example: Add a /random command
bot.onText(/\/random/, async (msg) => {
  const chatId = msg.chat.id;
  // Your custom logic here
});
```

### Customize Responses

Edit the message templates in `telegram-bot/index.js` to change the bot's personality and responses.

### Private vs Public Bot

**Private Bot** (Recommended):
- Only you can use it
- Better for personal memory
- Set up via BotFather with restrictions

**Public Bot**:
- Anyone can use it
- Requires user identification
- Add authentication logic to the bot

## Troubleshooting

### Bot Not Responding

1. Check bot is running:
   ```bash
   docker compose ps telegram-bot
   docker compose logs telegram-bot
   ```

2. Verify bot token is correct in `.env`

3. Ensure bot is running on same network as other services

### Search Not Working

1. Check MCP HTTP server:
   ```bash
   docker compose logs mcp-server-http
   ```

2. Ensure you have thoughts in your database:
   ```bash
   curl http://localhost:8888/capture \
     -H "X-OpenBrain-Key: YOUR_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"content": "Test thought"}'
   ```

### Commands Not Recognized

- Make sure commands start with `/`
- Check there are no extra spaces
- Verify bot has permissions to send messages

## Security Considerations

### Bot Security

✅ **Secure**:
- Bot token is kept in `.env` (not in git)
- Each request is authenticated with OPENBRAIN_API_KEY
- Bot only responds to commands, not arbitrary messages

⚠️ **Recommendations**:
- Use a private bot (restrict who can use it)
- Don't share your bot token publicly
- Consider adding user authentication for multi-user scenarios
- Regularly rotate your API keys

### Data Privacy

- All thoughts are stored in your private PostgreSQL database
- Telegram only sees the messages you send to the bot
- Embeddings are generated using your OpenAI API key

## Development

### Bot Logs

```bash
# Follow bot logs
docker compose logs -f telegram-bot

# Check for errors
docker compose logs telegram-bot | grep ERROR
```

### Restart Bot

```bash
docker compose restart telegram-bot
```

### Update Bot Code

```bash
# After editing telegram-bot/index.js
docker compose build telegram-bot
docker compose up -d telegram-bot
```

## Ideas for Enhancement

- 📎 **Support attachments**: Capture images, documents, voice notes
- 🏷️ **Tag system**: Organize thoughts with tags
- 🔗 **Link thoughts**: Connect related ideas
- 📅 **Reminders**: Get reminded of past thoughts
- 🤝 **Multi-user**: Support multiple users with separate memories
- 📊 **Analytics**: Charts and graphs of your memory growth
- 🔊 **Voice input**: Capture thoughts via voice messages
- 🌐 **Multi-language**: Support different languages

## Example Workflows

### Daily Journaling

```
You: /capture Today I learned about Docker networking
You: /capture Bridge networks are best for isolated containers
You: /search Docker networking concepts
Bot: Returns your thoughts about Docker networking
```

### Research Notes

```
You: /capture PostgreSQL vectors support semantic search
You: /capture pgvector extension adds HNSW indexing
You: /search database similarity search
Bot: Finds related thoughts about database search
```

### Quick Notes

```
You: /capture Remember: buy milk on the way home
You: /capture Dentist appointment next Tuesday at 3pm
You: /recent
Bot: Shows your latest notes
```

## Support

For issues or questions:
1. Check the main [README.md](README.md)
2. Review [Troubleshooting](#troubleshooting) above
3. Check logs: `docker compose logs`

## License

MIT

---

**Enjoy building your second brain! 🧠✨**
