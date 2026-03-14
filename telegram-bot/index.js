import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';

// Environment variables
const {
  TELEGRAM_BOT_TOKEN,
  OPENBRAIN_API_KEY,
  CAPTURE_API_URL = 'http://capture-api:3000'
} = process.env;

// Validate required environment variables
if (!TELEGRAM_BOT_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN is required');
  process.exit(1);
}

if (!OPENBRAIN_API_KEY) {
  console.error('OPENBRAIN_API_KEY is required');
  process.exit(1);
}

// Initialize Telegram bot
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Axios instance for capture API
const api = axios.create({
  baseURL: CAPTURE_API_URL,
  headers: {
    'Content-Type': 'application/json',
    'X-OpenBrain-Key': OPENBRAIN_API_KEY
  }
});

// Helper function to escape markdown special characters
function escapeMarkdown(text) {
  return text.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, '\\$&');
}

// Command: /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeMessage = `
🧠 *Open Brain Telegram Bot*

Welcome! I'm your personal memory assistant. Here's what I can do:

*Commands:*
/capture <text> - Store a new thought
/search <query> - Search your memory
/recent - Show recent thoughts
/stats - Memory statistics
/help - Show this help message

*Examples:*
/capture Docker containers are isolated runtime environments
/search database technology
/recent

Let's start building your memory! 🚀
  `.trim();

  bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
});

// Command: /help
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  const helpMessage = `
🧠 *Open Brain Commands*

/capture <text>
  Store a new thought in your memory
  Example: /capture PostgreSQL is an advanced database

/search <query>
  Search your memory using semantic similarity
  Example: /search container technology

/recent [limit]
  Show recent thoughts (default: 5)
  Example: /recent 10

/stats
  Display memory statistics

/help
  Show this help message

💡 *Tip:* The more you capture, the better your semantic search becomes!
  `.trim();

  bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

// Command: /capture <text>
bot.onText(/\/capture (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const content = match[1].trim();

  if (!content) {
    bot.sendMessage(chatId, '❌ Please provide some text to capture.\n\nUsage: /capture <your thought>');
    return;
  }

  try {
    await bot.sendChatAction(chatId, 'typing');

    const response = await api.post('/capture', {
      content,
      metadata: {
        source: 'telegram',
        user_id: chatId,
        username: msg.from.username || 'unknown'
      }
    });

    const { id, created_at } = response.data.data;
    const message = `
✅ *Thought Captured!*

ID: ${id}
Created: ${new Date(created_at).toLocaleString()}

Preview: ${escapeMarkdown(content.substring(0, 100))}${content.length > 100 ? '...' : ''}
    `.trim();

    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error capturing thought:', error.response?.data || error.message);
    bot.sendMessage(chatId, `❌ Failed to capture thought: ${error.response?.data?.error || error.message}`);
  }
});

// Command: /search <query>
bot.onText(/\/search (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const query = match[1].trim();

  if (!query) {
    bot.sendMessage(chatId, '❌ Please provide a search query.\n\nUsage: /search <your query>');
    return;
  }

  try {
    await bot.sendChatAction(chatId, 'typing');

    // Search via MCP server HTTP endpoint
    const mcpResponse = await axios.post(
      'http://mcp-server-http:3000/mcp',
      {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: 'semantic_search',
          arguments: {
            query,
            limit: 5
          }
        }
      }
    );

    const result = JSON.parse(mcpResponse.data.result.content[0].text);

    if (result.thoughts.length === 0) {
      bot.sendMessage(chatId, '🔍 No thoughts found. Try capturing some memories first!');
      return;
    }

    let searchResults = `🔍 *Search Results: "${escapeMarkdown(query)}"*\n\n`;

    result.thoughts.forEach((thought, index) => {
      const similarity = Math.round(thought.similarity * 100);
      const preview = thought.content.substring(0, 80);
      searchResults += `${index + 1}. *${similarity}% match*\n${escapeMarkdown(preview)}${thought.content.length > 80 ? '...' : ''}\n\n`;
    });

    bot.sendMessage(chatId, searchResults, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error searching thoughts:', error.response?.data || error.message);
    bot.sendMessage(chatId, `❌ Failed to search: ${error.response?.data?.error || error.message}`);
  }
});

// Command: /recent
bot.onText(/\/recent(?: (\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const limit = match[1] ? parseInt(match[1]) : 5;

  try {
    await bot.sendChatAction(chatId, 'typing');

    // Get recent thoughts via MCP server HTTP endpoint
    const mcpResponse = await axios.post(
      'http://mcp-server-http:3000/mcp',
      {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: 'list_recent',
          arguments: {
            limit
          }
        }
      }
    );

    const result = JSON.parse(mcpResponse.data.result.content[0].text);

    if (result.thoughts.length === 0) {
      bot.sendMessage(chatId, '📭 No thoughts yet. Start capturing some memories!');
      return;
    }

    let recentMessage = `📝 *Recent ${result.thoughts.length} Thoughts*\n\n`;

    result.thoughts.forEach((thought, index) => {
      const date = new Date(thought.created_at).toLocaleDateString();
      const preview = thought.content.substring(0, 60);
      recentMessage += `${index + 1}. ${escapeMarkdown(preview)}${thought.content.length > 60 ? '...' : ''}\n   📅 ${date}\n\n`;
    });

    bot.sendMessage(chatId, recentMessage, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error fetching recent thoughts:', error.response?.data || error.message);
    bot.sendMessage(chatId, `❌ Failed to fetch recent thoughts: ${error.response?.data?.error || error.message}`);
  }
});

// Command: /stats
bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    await bot.sendChatAction(chatId, 'typing');

    // Get stats via MCP server HTTP endpoint
    const mcpResponse = await axios.post(
      'http://mcp-server-http:3000/mcp',
      {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: 'get_stats',
          arguments: {}
        }
      }
    );

    const result = JSON.parse(mcpResponse.data.result.content[0].text);

    const statsMessage = `
📊 *Memory Statistics*

📝 Total Thoughts: *${result.total_thoughts}*
${result.latest_thought_at ? `🕐 Latest: ${new Date(result.latest_thought_at).toLocaleString()}` : ''}

🧠 Your memory is growing!
    `.trim();

    bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error fetching stats:', error.response?.data || error.message);
    bot.sendMessage(chatId, `❌ Failed to fetch statistics: ${error.response?.data?.error || error.message}`);
  }
});

// Handle non-command messages
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Ignore commands
  if (text?.startsWith('/')) return;

  // Treat non-command messages as capture
  if (text && text.trim().length > 0) {
    bot.sendMessage(chatId, `💡 To save this thought, use: /capture ${text}\n\nOr use /help for more commands.`);
  }
});

// Error handling
bot.on('polling_error', (error) => {
  console.error(`Polling error: ${error.code} - ${error.message}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, stopping bot...');
  bot.stopPolling();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, stopping bot...');
  bot.stopPolling();
  process.exit(0);
});

// Start bot
console.log('🤖 Open Brain Telegram Bot started');
console.log('📝 Listening for commands...');
