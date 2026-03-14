import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import FormData from 'form-data';

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
    'X-OpenBrain-Key': OPENBRAIN_API_KEY
  }
});

// Helper function to clean OCR text and decode HTML entities
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/\\n/g, '\n')        // Keep actual newlines
    .replace(/\\t/g, ' ')         // Replace tabs with space
    .replace(/\\"/g, '"')         // Replace escaped quotes
    .replace(/\\'/g, "'")         // Replace escaped apostrophes
    .replace(/\\</g, '<')         // Replace escaped <
    .replace(/\\>/g, '>')         // Replace escaped >
    .replace(/\\\\/g, '\\')       // Replace double backslashes
    .replace(/<\/td>/g, ' | ')    // Replace closing td with space
    .replace(/<\/tr>/g, '\n')     // Replace closing tr with newline
    .replace(/<[^>]*>/g, '')      // Remove remaining HTML tags
    .replace(/&lt;/g, '<')        // Decode HTML entities
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/!\[.*?\]\(.*?\)/g, '')  // Remove markdown image references
    .replace(/\n{3,}/g, '\n\n')  // Reduce multiple newlines to 2
    .trim();
}

// Helper function to escape basic markdown characters for messages with markdown formatting
function escapeBasicMarkdown(text) {
  if (!text) return '';
  // Only escape the most common markdown characters that break formatting
  return text.replace(/[*_()\[\]]/g, '\\$&');
}

// Helper function to format file size
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
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

*File Support:*
📄 Send text files (.txt, .md)
📄 Send documents (.pdf, .docx)
🖼️ Send images (.jpg, .png, etc.)

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

*File Uploads:*
📄 Simply send any file to extract and store its content!
  • Text files: .txt, .md
  • Documents: .pdf, .docx
  • Images: .jpg, .png, .gif (extracts text via OCR)

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

    let searchResults = `🔍 Search Results: "${query}"\n\n`;

    result.thoughts.forEach((thought, index) => {
      const similarity = Math.round(thought.similarity * 100);
      const preview = cleanText(thought.content);

      // Split into lines and format nicely
      const lines = preview.split('\n').filter(line => line.trim());
      const previewLines = lines.slice(0, 6); // Show up to 6 lines
      const formattedPreview = previewLines.join('\n');
      const hasMore = lines.length > 6;

      // Add file info if available
      let fileInfo = '';
      if (thought.metadata && thought.metadata.filename) {
        fileInfo = `\n   📄 ${thought.metadata.filename}`;
      }

      searchResults += `${index + 1}. [${similarity}%]${fileInfo}\n${formattedPreview}${hasMore ? '\n...' : ''}\n\n`;
    });

    bot.sendMessage(chatId, searchResults);
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

    let recentMessage = `📝 Recent ${result.thoughts.length} Thoughts\n\n`;

    result.thoughts.forEach((thought, index) => {
      const date = new Date(thought.created_at).toLocaleDateString();
      const preview = cleanText(thought.content);
      const lines = preview.split('\n').filter(line => line.trim());
      const previewLines = lines.slice(0, 3); // Show up to 3 lines
      const formattedPreview = previewLines.join(' • '); // Join with bullet separator
      const hasMore = lines.length > 3;

      // Add file info if available
      let fileInfo = '';
      if (thought.metadata) {
        if (thought.metadata.filename) {
          fileInfo = `\n   📄 ${thought.metadata.filename}`;
        }
        if (thought.metadata.source === 'file_upload') {
          fileInfo = `\n   📎 ${thought.metadata.filename || 'File'}`;
        }
      }

      recentMessage += `${index + 1}. ${formattedPreview}${hasMore ? '...' : ''}\n   📅 ${date}${fileInfo}\n\n`;
    });

    bot.sendMessage(chatId, recentMessage);
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

// Handle document uploads
bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const document = msg.document;

  console.log(`Received document: ${document.file_name} (${document.mime_type})`);

  try {
    await bot.sendChatAction(chatId, 'typing');
    await bot.sendMessage(chatId, `📄 Processing document: ${document.file_name}...\n\nThis may take a moment for large files.`);

    // Download file from Telegram
    const fileLink = await bot.getFileLink(document.file_id);

    // Download file content
    const fileResponse = await axios.get(fileLink, { responseType: 'stream' });
    const fileBuffer = await new Promise((resolve, reject) => {
      const chunks = [];
      fileResponse.data.on('data', (chunk) => chunks.push(chunk));
      fileResponse.data.on('end', () => resolve(Buffer.concat(chunks)));
      fileResponse.data.on('error', reject);
    });

    // Create form data
    const formData = new FormData();
    formData.append('file', fileBuffer, {
      filename: document.file_name,
      contentType: document.mime_type
    });

    // Upload to capture API
    const uploadResponse = await api.post('/upload', formData, {
      headers: formData.getHeaders(),
      maxContentLength: 10 * 1024 * 1024, // 10MB
      maxBodyLength: 10 * 1024 * 1024
    });

    const result = uploadResponse.data.data;

    const successMessage = `
✅ *Document Processed Successfully!*

📄 *File:* ${result.original_filename}
📏 *Size:* ${formatFileSize(result.file_size)}
📝 *Content Length:* ${result.full_content_length} characters
🆔 *Thought ID:* ${result.id}

Preview: ${escapeBasicMarkdown(cleanText(result.content).substring(0, 200))}${result.content.length > 200 ? '...' : ''}
    `.trim();

    bot.sendMessage(chatId, successMessage, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Error processing document:', error.response?.data || error.message);
    bot.sendMessage(chatId, `❌ Failed to process document: ${error.response?.data?.message || error.message}`);
  }
});

// Handle photo uploads
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const photos = msg.photo;

  // Get the largest photo
  const photo = photos[photos.length - 1];

  console.log(`Received photo: ${photo.file_id}`);

  try {
    await bot.sendChatAction(chatId, 'typing');
    await bot.sendMessage(chatId, `🖼️ Processing image...\n\nExtracting text with OCR. This may take a moment.`);

    // Download file from Telegram
    const fileLink = await bot.getFileLink(photo.file_id);

    // Download file content
    const fileResponse = await axios.get(fileLink, { responseType: 'stream' });
    const fileBuffer = await new Promise((resolve, reject) => {
      const chunks = [];
      fileResponse.data.on('data', (chunk) => chunks.push(chunk));
      fileResponse.data.on('end', () => resolve(Buffer.concat(chunks)));
      fileResponse.data.on('error', reject);
    });

    // Create form data
    const formData = new FormData();
    formData.append('file', fileBuffer, {
      filename: `photo_${photo.file_id}.jpg`,
      contentType: 'image/jpeg'
    });

    // Upload to capture API
    const uploadResponse = await api.post('/upload', formData, {
      headers: formData.getHeaders(),
      maxContentLength: 10 * 1024 * 1024, // 10MB
      maxBodyLength: 10 * 1024 * 1024
    });

    const result = uploadResponse.data.data;

    const successMessage = `
✅ *Image Processed Successfully!*

🖼️ *File:* ${result.original_filename}
📏 *Size:* ${formatFileSize(result.file_size)}
📝 *Extracted Text:* ${result.full_content_length} characters
🆔 *Thought ID:* ${result.id}

Preview: ${escapeBasicMarkdown(cleanText(result.content).substring(0, 200))}${result.content.length > 200 ? '...' : ''}
    `.trim();

    bot.sendMessage(chatId, successMessage, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Error processing photo:', error.response?.data || error.message);
    bot.sendMessage(chatId, `❌ Failed to process image: ${error.response?.data?.message || error.message}`);
  }
});

// Handle non-command messages
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Ignore commands, documents, and photos
  if (text?.startsWith('/')) return;
  if (msg.document || msg.photo) return;

  // Treat non-command messages as capture hint
  if (text && text.trim().length > 0) {
    bot.sendMessage(chatId, `💡 To save this thought, use: /capture ${text}\n\n💡 Or send a file/document to extract and store its content!\n\nUse /help for more commands.`);
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
console.log('📝 Listening for commands and file uploads...');
console.log('📄 File upload support enabled');
console.log('🖼️ Image OCR support enabled');
