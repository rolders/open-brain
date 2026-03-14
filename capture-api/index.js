const Fastify = require('fastify');
const pg = require('pg');
const OpenAI = require('openai');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');

const fastify = Fastify({ logger: true });

// Enable multipart form data
fastify.register(require('@fastify/multipart'), {
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max file size
  }
});

// Environment variables
const {
  DB_HOST,
  DB_PORT,
  DB_NAME,
  DB_USER,
  DB_PASSWORD,
  OPENBRAIN_API_KEY,
  OPENAI_API_KEY,
  ZAI_API_KEY,
  PORT = 3000
} = process.env;

// Validate required environment variables
if (!OPENBRAIN_API_KEY || !DB_PASSWORD || !OPENAI_API_KEY) {
  console.error('Missing required environment variables');
  process.exit(1);
}

// PostgreSQL connection pool (using brain_writer role)
const pool = new pg.Pool({
  host: DB_HOST,
  port: parseInt(DB_PORT),
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// OpenAI client for embeddings
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// Security middleware: Validate X-OpenBrain-Key
async function validateApiKey(request, reply) {
  const providedKey = request.headers['x-openbrain-key'];

  if (!providedKey || providedKey !== OPENBRAIN_API_KEY) {
    reply.code(401).send({ error: 'Unauthorized: Invalid API key' });
    return reply;
  }
}

// Health check endpoint
fastify.get('/health', async (request, reply) => {
  return { status: 'healthy', timestamp: new Date().toISOString() };
});

// Helper: Convert file stream to buffer
async function fileToBuffer(file) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    file.on('data', (chunk) => chunks.push(chunk));
    file.on('end', () => resolve(Buffer.concat(chunks)));
    file.on('error', reject);
  });
}

// Helper: Extract text from file based on type
// Returns: { content, fileSize }
async function extractTextFromFile(file, filename) {
  const ext = path.extname(filename).toLowerCase();
  const buffer = await fileToBuffer(file);
  const fileSize = buffer.length;

  let content;

  switch (ext) {
    case '.txt':
    case '.md':
      // Text files - read directly
      content = buffer.toString('utf-8');
      break;

    case '.pdf':
      // PDF files - use pdf-parse
      const data = await pdf(buffer);
      content = data.text;
      break;

    case '.docx':
      // Word documents - use mammoth
      const result = await mammoth.extractRawText({ buffer });
      content = result.value;
      break;

    case '.jpg':
    case '.jpeg':
    case '.png':
    case '.gif':
    case '.bmp':
    case '.webp':
      // Image files - use z.ai GLM-OCR
      content = await extractTextWithGLMOCR(buffer, filename);
      break;

    default:
      throw new Error(`Unsupported file type: ${ext}`);
  }

  return { content, fileSize };
}

// Helper: Extract text from images using z.ai GLM-OCR
async function extractTextWithGLMOCR(buffer, filename) {
  if (!ZAI_API_KEY) {
    throw new Error('ZAI_API_KEY is not configured. Please add it to your .env file.');
  }

  try {
    // Convert buffer to base64
    const base64Image = buffer.toString('base64');

    // Call z.ai GLM-OCR API
    const response = await axios.post(
      'https://api.z.ai/api/paas/v4/layout_parsing',
      {
        model: 'glm-ocr',
        file: `data:image/jpeg;base64,${base64Image}` // GLM-OCR accepts base64 data URL
      },
      {
        headers: {
          'Authorization': `Bearer ${ZAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 second timeout
      }
    );

    // Extract text from response
    if (response.data && response.data.data) {
      // The API returns parsed text in the data field
      const result = response.data.data;
      return result.text || result.content || JSON.stringify(result);
    } else {
      throw new Error('Invalid response format from GLM-OCR API');
    }
  } catch (error) {
    fastify.log.error('GLM-OCR API error:', error.response?.data || error.message);
    throw new Error(`Failed to extract text from image: ${error.message}`);
  }
}

// Capture endpoint (existing text-only endpoint)
fastify.post('/capture', {
  preHandler: validateApiKey,
  schema: {
    body: {
      type: 'object',
      required: ['content'],
      properties: {
        content: { type: 'string', minLength: 1 },
        metadata: { type: 'object' }
      }
    }
  }
}, async (request, reply) => {
  const { content, metadata = {} } = request.body;

  try {
    // Generate embedding using OpenAI text-embedding-3-large (3072 dimensions)
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-large',
      input: content,
      dimensions: 3072,
    });

    const embedding = embeddingResponse.data[0].embedding;

    // Insert into database using brain_writer role
    const result = await pool.query(
      'INSERT INTO thoughts (content, metadata, embedding) VALUES ($1, $2, $3::vector) RETURNING id, created_at',
      [content, JSON.stringify(metadata), `[${embedding.join(',')}]`]
    );

    const { id, created_at } = result.rows[0];

    return {
      success: true,
      data: {
        id,
        content,
        metadata,
        created_at
      }
    };

  } catch (error) {
    fastify.log.error('Error capturing thought:', error);
    reply.code(500).send({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// File upload endpoint (new)
fastify.post('/upload', {
  preHandler: validateApiKey
}, async (request, reply) => {
  try {
    const data = await request.file();

    if (!data) {
      reply.code(400).send({ error: 'No file uploaded' });
      return;
    }

    const filename = data.filename;
    const file = data.file;
    const mimetype = data.mimetype;

    fastify.log.info(`Processing file upload: ${filename} (${mimetype})`);

    // Extract text from file
    let extractionResult;
    try {
      extractionResult = await extractTextFromFile(file, filename);
    } catch (error) {
      fastify.log.error('Error extracting text from file:', error);
      reply.code(400).send({
        error: 'Failed to extract text from file',
        message: error.message
      });
      return;
    }

    const { content, fileSize } = extractionResult;

    // Validate extracted content
    if (!content || content.trim().length === 0) {
      reply.code(400).send({ error: 'No text content found in file' });
      return;
    }

    // Generate metadata
    const metadata = {
      source: 'file_upload',
      filename: filename,
      file_type: path.extname(filename).toLowerCase(),
      file_size: fileSize,
      mimetype: mimetype
    };

    // Generate embedding using OpenAI
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-large',
      input: content,
      dimensions: 3072,
    });

    const embedding = embeddingResponse.data[0].embedding;

    // Insert into database
    const result = await pool.query(
      'INSERT INTO thoughts (content, metadata, embedding, original_filename, file_type, file_size) VALUES ($1, $2, $3::vector, $4, $5, $6) RETURNING id, created_at',
      [
        content,
        JSON.stringify(metadata),
        `[${embedding.join(',')}]`,
        filename,
        path.extname(filename).toLowerCase(),
        fileSize
      ]
    );

    const { id, created_at } = result.rows[0];

    fastify.log.info(`Successfully processed file: ${filename} -> thought ID: ${id}`);

    return {
      success: true,
      data: {
        id,
        content: content.substring(0, 500) + (content.length > 500 ? '...' : ''), // Preview only
        full_content_length: content.length,
        metadata,
        original_filename: filename,
        file_type: path.extname(filename).toLowerCase(),
        file_size: fileSize,
        created_at
      }
    };

  } catch (error) {
    fastify.log.error('Error processing file upload:', error);
    reply.code(500).send({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Graceful shutdown
const gracefulShutdown = async () => {
  fastify.log.info('Shutting down gracefully...');
  await pool.end();
  await fastify.close();
  process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start server
const start = async () => {
  try {
    // Wait for database to be ready
    let retries = 5;
    while (retries > 0) {
      try {
        await pool.query('SELECT 1');
        break;
      } catch (err) {
        retries--;
        if (retries === 0) throw err;
        fastify.log.warn(`Database not ready, retrying... (${retries} attempts left)`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    await fastify.listen({ host: '0.0.0.0', port: parseInt(PORT) });
    fastify.log.info(`Capture API listening on port ${PORT}`);

    if (ZAI_API_KEY) {
      fastify.log.info('Z.ai GLM-OCR integration enabled');
    } else {
      fastify.log.warn('Z.ai GLM-OCR integration disabled - ZAI_API_KEY not set');
    }
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
