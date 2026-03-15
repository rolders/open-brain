import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import FormData from 'form-data';
import { buildUploadSuccessMessage } from './upload-format.js';

const TELEGRAM_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const RECENT_DEFAULT_LIMIT = 5;
const RECENT_MIN_LIMIT = 1;
const RECENT_MAX_LIMIT = 20;

// Environment variables
const {
  TELEGRAM_BOT_TOKEN,
  OPENBRAIN_API_KEY,
  CAPTURE_API_URL = 'http://capture-api:3000',
  TELEGRAM_ALLOWED_CHAT_IDS,
  MCP_API_KEY
} = process.env;

function parseAllowedChatIds(value) {
  if (!value) {
    return new Set();
  }

  return new Set(
    value
      .split(',')
      .map((chatId) => chatId.trim())
      .filter(Boolean)
  );
}

const allowedChatIds = parseAllowedChatIds(TELEGRAM_ALLOWED_CHAT_IDS);

// Validate required environment variables
if (!TELEGRAM_BOT_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN is required');
  process.exit(1);
}

if (!OPENBRAIN_API_KEY) {
  console.error('OPENBRAIN_API_KEY is required');
  process.exit(1);
}

if (allowedChatIds.size === 0) {
  console.error('TELEGRAM_ALLOWED_CHAT_IDS is required');
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

const mcpApi = axios.create({
  baseURL: 'http://mcp-server-http:3000',
  headers: MCP_API_KEY
    ? {
      'X-MCP-Key': MCP_API_KEY
    }
    : {}
});

// Helper function to clean OCR text and decode HTML entities
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\</g, '<')
    .replace(/\\>/g, '>')
    .replace(/\\\\/g, '\\')
    .replace(/<\/td>/g, ' | ')
    .replace(/<\/tr>/g, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Helper function to normalize text for plain Telegram messages
function formatPlainText(text) {
  if (!text) return '';
  return String(text).replace(/\r/g, '').trim();
}

// Helper function to format file size
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function getChatId(msg) {
  return String(msg.chat.id);
}

function isAuthorizedChat(msg) {
  return allowedChatIds.has(getChatId(msg));
}

async function rejectUnauthorizedChat(msg) {
  const chatId = msg.chat.id;
  console.warn(`Rejected unauthorized Telegram chat: ${getChatId(msg)}`);
  await bot.sendMessage(chatId, 'This bot is not available in this chat.');
}

async function requireAuthorizedChat(msg) {
  if (isAuthorizedChat(msg)) {
    return true;
  }

  await rejectUnauthorizedChat(msg);
  return false;
}

function clampRecentLimit(rawLimit) {
  if (!rawLimit) {
    return RECENT_DEFAULT_LIMIT;
  }

  const parsedLimit = Number.parseInt(rawLimit, 10);
  if (Number.isNaN(parsedLimit)) {
    return RECENT_DEFAULT_LIMIT;
  }

  return Math.min(RECENT_MAX_LIMIT, Math.max(RECENT_MIN_LIMIT, parsedLimit));
}

function buildTelegramMetadata(msg, extra = {}) {
  const userId = msg.from?.id ?? null;
  const username = msg.from?.username || null;
  const baseMetadata = {
    source: 'telegram',
    chat_id: msg.chat.id,
    user_id: userId,
    username,
    access_scope: {
      transport: 'telegram',
      chat_id: getChatId(msg),
      user_id: userId !== null ? String(userId) : null
    },
    telegram: {
      chat: {
        id: getChatId(msg),
        type: msg.chat.type,
        title: msg.chat.title || null
      },
      from: {
        id: userId !== null ? String(userId) : null,
        username,
        first_name: msg.from?.first_name || null,
        last_name: msg.from?.last_name || null
      },
      message_id: msg.message_id
    }
  };

  const mergedTelegram = {
    ...baseMetadata.telegram,
    ...(extra.telegram || {}),
    chat: {
      ...baseMetadata.telegram.chat,
      ...(extra.telegram?.chat || {})
    },
    from: {
      ...baseMetadata.telegram.from,
      ...(extra.telegram?.from || {})
    }
  };

  return {
    ...baseMetadata,
    ...extra,
    access_scope: {
      ...baseMetadata.access_scope,
      ...(extra.access_scope || {})
    },
    telegram: mergedTelegram
  };
}

function appendMetadata(formData, metadata) {
  formData.append('metadata', JSON.stringify(metadata));
}

function logServiceError(context, error) {
  console.error(context, {
    status: error.response?.status,
    code: error.code,
    clientError: error.response?.data?.error,
    message: error.message
  });
}

function getSanitizedUserError(operation, error) {
  const status = error.response?.status;

  if (status === 400) {
    if (operation === 'document' || operation === 'photo') {
      if (error.response?.data?.error === 'No text content found in file') {
        return 'No text could be extracted from that file.';
      }

      return 'That file could not be processed.';
    }

    if (operation === 'capture') {
      return 'That message could not be captured.';
    }

    return 'That request could not be processed.';
  }

  if (status === 401 || status === 403) {
    return 'Access denied.';
  }

  if (status === 413) {
    if (operation === 'capture') {
      return 'That message is too large to capture.';
    }

    return `That file is too large to process. Maximum size is ${formatFileSize(TELEGRAM_MAX_UPLOAD_BYTES)}.`;
  }

  if (status === 502 || status === 503) {
    if (operation === 'photo') {
      return 'Image text extraction is unavailable right now. Please try again later.';
    }

    return 'The service is temporarily unavailable. Please try again later.';
  }

  switch (operation) {
    case 'capture':
      return 'Failed to capture your thought. Please try again later.';
    case 'search':
      return 'Failed to search your memory. Please try again later.';
    case 'recent':
      return 'Failed to fetch recent thoughts. Please try again later.';
    case 'stats':
      return 'Failed to fetch statistics. Please try again later.';
    case 'document':
      return 'Failed to process that document. Please try again later.';
    case 'photo':
      return 'Failed to process that image. Please try again later.';
    default:
      return 'Request failed. Please try again later.';
  }
}

function ensureFileWithinLimit(fileSize) {
  return typeof fileSize !== 'number' || fileSize <= TELEGRAM_MAX_UPLOAD_BYTES;
}

async function downloadTelegramFile(fileId) {
  const fileLink = await bot.getFileLink(fileId);
  const fileResponse = await axios.get(fileLink, { responseType: 'stream' });

  return new Promise((resolve, reject) => {
    const chunks = [];
    fileResponse.data.on('data', (chunk) => chunks.push(chunk));
    fileResponse.data.on('end', () => resolve(Buffer.concat(chunks)));
    fileResponse.data.on('error', reject);
  });
}

async function callMcpTool(name, args) {
  const response = await mcpApi.post('/mcp', {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: {
      name,
      arguments: args
    }
  });

  return JSON.parse(response.data.result.content[0].text);
}

async function waitForIngestionJob(jobId, {
  timeoutMs = 60_000,
  pollIntervalMs = 2_000,
} = {}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const response = await api.get(`/ingestion/jobs/${jobId}`);
    const job = response.data?.data;

    if (job?.status === 'completed') {
      return job.result || {};
    }

    if (job?.status === 'failed') {
      const jobError = String(job.error || 'Ingestion job failed');
      const error = new Error(jobError);
      error.response = {
        status: 400,
        data: {
          error: jobError
        }
      };
      throw error;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return null;
}

// Command: /start
bot.onText(/\/start/, async (msg) => {
  if (!(await requireAuthorizedChat(msg))) {
    return;
  }

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
bot.onText(/\/help/, async (msg) => {
  if (!(await requireAuthorizedChat(msg))) {
    return;
  }

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
  Show recent thoughts (default: 5, max: 20)
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
  • Maximum upload size: ${formatFileSize(TELEGRAM_MAX_UPLOAD_BYTES)}

💡 *Tip:* The more you capture, the better your semantic search becomes!
  `.trim();

  bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

// Command: /capture <text>
bot.onText(/\/capture (.+)/, async (msg, match) => {
  if (!(await requireAuthorizedChat(msg))) {
    return;
  }

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
      metadata: buildTelegramMetadata(msg, {
        ingestion: {
          channel: 'telegram',
          mode: 'capture_command'
        }
      })
    });

    const { id, created_at } = response.data.data;
    const preview = `${formatPlainText(content.substring(0, 100))}${content.length > 100 ? '…' : ''}`;
    const message = `
✅ Thought Captured!

ID: ${id}
Created: ${new Date(created_at).toLocaleString()}

Preview: ${preview}
    `.trim();

    bot.sendMessage(chatId, message);
  } catch (error) {
    logServiceError('Error capturing thought', error);
    bot.sendMessage(chatId, `❌ ${getSanitizedUserError('capture', error)}`);
  }
});

// Command: /search <query>
bot.onText(/\/search (.+)/, async (msg, match) => {
  if (!(await requireAuthorizedChat(msg))) {
    return;
  }

  const chatId = msg.chat.id;
  const query = match[1].trim();

  if (!query) {
    bot.sendMessage(chatId, '❌ Please provide a search query.\n\nUsage: /search <your query>');
    return;
  }

  try {
    await bot.sendChatAction(chatId, 'typing');

    const result = await callMcpTool('semantic_search', {
      query,
      limit: 5
    });

    if (result.thoughts.length === 0) {
      bot.sendMessage(chatId, '🔍 No thoughts found. Try capturing some memories first!');
      return;
    }

    let searchResults = `🔍 Search Results: "${query}"\n\n`;

    result.thoughts.forEach((thought, index) => {
      const similarity = Math.round(thought.similarity * 100);
      const preview = cleanText(thought.content);

      const lines = preview.split('\n').filter((line) => line.trim());
      const previewLines = lines.slice(0, 6);
      const formattedPreview = previewLines.join('\n');
      const hasMore = lines.length > 6;

      let fileInfo = '';
      if (thought.metadata && thought.metadata.filename) {
        fileInfo = `\n   📄 ${thought.metadata.filename}`;
      }

      searchResults += `${index + 1}. [${similarity}%]${fileInfo}\n${formattedPreview}${hasMore ? '\n...' : ''}\n\n`;
    });

    bot.sendMessage(chatId, searchResults);
  } catch (error) {
    logServiceError('Error searching thoughts', error);
    bot.sendMessage(chatId, `❌ ${getSanitizedUserError('search', error)}`);
  }
});

// Command: /recent
bot.onText(/\/recent(?: (\d+))?/, async (msg, match) => {
  if (!(await requireAuthorizedChat(msg))) {
    return;
  }

  const chatId = msg.chat.id;
  const limit = clampRecentLimit(match[1]);

  try {
    await bot.sendChatAction(chatId, 'typing');

    const result = await callMcpTool('list_recent', {
      limit
    });

    if (result.thoughts.length === 0) {
      bot.sendMessage(chatId, '📭 No thoughts yet. Start capturing some memories!');
      return;
    }

    let recentMessage = `📝 Recent ${result.thoughts.length} Thoughts\n\n`;

    result.thoughts.forEach((thought, index) => {
      const date = new Date(thought.created_at).toLocaleDateString();
      const preview = cleanText(thought.content);
      const lines = preview.split('\n').filter((line) => line.trim());
      const previewLines = lines.slice(0, 3);
      const formattedPreview = previewLines.join(' • ');
      const hasMore = lines.length > 3;

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
    logServiceError('Error fetching recent thoughts', error);
    bot.sendMessage(chatId, `❌ ${getSanitizedUserError('recent', error)}`);
  }
});

// Command: /stats
bot.onText(/\/stats/, async (msg) => {
  if (!(await requireAuthorizedChat(msg))) {
    return;
  }

  const chatId = msg.chat.id;

  try {
    await bot.sendChatAction(chatId, 'typing');

    const result = await callMcpTool('get_stats', {});

    const statsMessage = `
📊 *Memory Statistics*

📝 Total Thoughts: *${result.total_thoughts}*
${result.latest_thought_at ? `🕐 Latest: ${new Date(result.latest_thought_at).toLocaleString()}` : ''}

🧠 Your memory is growing!
    `.trim();

    bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
  } catch (error) {
    logServiceError('Error fetching stats', error);
    bot.sendMessage(chatId, `❌ ${getSanitizedUserError('stats', error)}`);
  }
});

// Handle document uploads
bot.on('document', async (msg) => {
  if (!(await requireAuthorizedChat(msg))) {
    return;
  }

  const chatId = msg.chat.id;
  const document = msg.document;

  console.log(`Received document from chat ${getChatId(msg)}: ${document.file_name} (${document.mime_type})`);

  if (!ensureFileWithinLimit(document.file_size)) {
    await bot.sendMessage(chatId, `❌ That file is too large to process. Maximum size is ${formatFileSize(TELEGRAM_MAX_UPLOAD_BYTES)}.`);
    return;
  }

  try {
    await bot.sendChatAction(chatId, 'typing');
    await bot.sendMessage(chatId, `📄 Processing document: ${document.file_name}...\n\nThis may take a moment for large files.`);

    const fileBuffer = await downloadTelegramFile(document.file_id);

    const formData = new FormData();
    formData.append('file', fileBuffer, {
      filename: document.file_name,
      contentType: document.mime_type
    });
    appendMetadata(formData, buildTelegramMetadata(msg, {
      ingestion: {
        channel: 'telegram',
        mode: 'document_upload'
      }
    }));

    const uploadResponse = await api.post('/upload', formData, {
      headers: formData.getHeaders(),
      maxContentLength: TELEGRAM_MAX_UPLOAD_BYTES,
      maxBodyLength: TELEGRAM_MAX_UPLOAD_BYTES
    });

    const uploadResult = uploadResponse.data.data;

    if (uploadResult.job_id) {
      await bot.sendMessage(chatId, `⏳ Document queued for processing (job ${uploadResult.job_id}). I'll send the result when it's ready.`);
      const completedResult = await waitForIngestionJob(uploadResult.job_id);

      if (!completedResult) {
        await bot.sendMessage(chatId, `⌛ Document job ${uploadResult.job_id} is still processing. Please try /recent in a minute.`);
        return;
      }

      const successMessage = buildUploadSuccessMessage('document', completedResult, { formatFileSize });
      await bot.sendMessage(chatId, successMessage);
      return;
    }

    const successMessage = buildUploadSuccessMessage('document', uploadResult, { formatFileSize });
    await bot.sendMessage(chatId, successMessage);
  } catch (error) {
    logServiceError('Error processing document', error);
    bot.sendMessage(chatId, `❌ ${getSanitizedUserError('document', error)}`);
  }
});

// Handle photo uploads
bot.on('photo', async (msg) => {
  if (!(await requireAuthorizedChat(msg))) {
    return;
  }

  const chatId = msg.chat.id;
  const photos = msg.photo;
  const photo = photos[photos.length - 1];

  console.log(`Received photo from chat ${getChatId(msg)}: ${photo.file_id}`);

  if (!ensureFileWithinLimit(photo.file_size)) {
    await bot.sendMessage(chatId, `❌ That file is too large to process. Maximum size is ${formatFileSize(TELEGRAM_MAX_UPLOAD_BYTES)}.`);
    return;
  }

  try {
    await bot.sendChatAction(chatId, 'typing');
    await bot.sendMessage(chatId, '🖼️ Processing image...\n\nExtracting text with OCR. This may take a moment.');

    const fileBuffer = await downloadTelegramFile(photo.file_id);

    const formData = new FormData();
    formData.append('file', fileBuffer, {
      filename: `photo_${photo.file_id}.jpg`,
      contentType: 'image/jpeg'
    });
    appendMetadata(formData, buildTelegramMetadata(msg, {
      ingestion: {
        channel: 'telegram',
        mode: 'photo_upload'
      }
    }));

    const uploadResponse = await api.post('/upload', formData, {
      headers: formData.getHeaders(),
      maxContentLength: TELEGRAM_MAX_UPLOAD_BYTES,
      maxBodyLength: TELEGRAM_MAX_UPLOAD_BYTES
    });

    const uploadResult = uploadResponse.data.data;

    if (uploadResult.job_id) {
      await bot.sendMessage(chatId, `⏳ Image queued for processing (job ${uploadResult.job_id}). I'll send the result when it's ready.`);
      const completedResult = await waitForIngestionJob(uploadResult.job_id);

      if (!completedResult) {
        await bot.sendMessage(chatId, `⌛ Image job ${uploadResult.job_id} is still processing. Please try /recent in a minute.`);
        return;
      }

      const successMessage = buildUploadSuccessMessage('photo', completedResult, { formatFileSize });
      await bot.sendMessage(chatId, successMessage);
      return;
    }

    const successMessage = buildUploadSuccessMessage('photo', uploadResult, { formatFileSize });
    await bot.sendMessage(chatId, successMessage);
  } catch (error) {
    logServiceError('Error processing photo', error);
    bot.sendMessage(chatId, `❌ ${getSanitizedUserError('photo', error)}`);
  }
});

// Handle non-command messages
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text?.startsWith('/')) return;
  if (msg.document || msg.photo) return;
  if (!isAuthorizedChat(msg)) return;

  if (text && text.trim().length > 0) {
    await bot.sendMessage(chatId, `💡 To save this thought, use: /capture ${text}\n\n💡 Or send a file/document to extract and store its content!\n\nUse /help for more commands.`);
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
console.log('Open Brain Telegram Bot started');
console.log(`Authorized Telegram chats configured: ${allowedChatIds.size}`);
console.log('Listening for commands and file uploads...');
console.log('File upload support enabled');
console.log('Image OCR support enabled');
