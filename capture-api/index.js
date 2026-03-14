const Fastify = require('fastify');
const pg = require('pg');
const OpenAI = require('openai');
const axios = require('axios');
const path = require('path');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const { buildHashes } = require('./hashing');

const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024;
const MAX_CAPTURE_CONTENT_CHARS = 20000;
const MAX_EXTRACTED_CONTENT_CHARS = 20000;
const OCR_LOG_KEY_LIMIT = 10;
const DEFAULT_NAMESPACE = 'default';

const fastify = Fastify({ logger: true });

// Enable multipart form data
fastify.register(require('@fastify/multipart'), {
  limits: {
    fileSize: MAX_UPLOAD_FILE_BYTES
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

// Metadata schema for intelligent extraction
const METADATA_SCHEMA = {
  people: [{
    name: 'string',
    role: 'string (optional)',
    organization: 'string (optional)',
    email: 'string (optional)',
    confidence: 'number (0-1)'
  }],
  topics: [{
    name: 'string',
    category: 'string (optional)',
    confidence: 'number (0-1)'
  }],
  action_items: [{
    type: 'enum: task|decision|commitment|question',
    description: 'string',
    assignee: 'string (optional)',
    deadline: 'string (optional)',
    status: 'enum: pending|completed|cancelled (optional)',
    confidence: 'number (0-1)'
  }]
};

function createClientError(statusCode, clientError) {
  const error = new Error(clientError);
  error.statusCode = statusCode;
  error.clientError = clientError;
  return error;
}

function sendClientError(reply, error, fallbackStatusCode = 500) {
  const statusCode = error?.statusCode && error.statusCode >= 400 && error.statusCode < 600
    ? error.statusCode
    : fallbackStatusCode;
  const clientError = error?.clientError || (
    statusCode === 413
      ? 'Payload too large'
      : statusCode >= 400 && statusCode < 500
        ? 'Request could not be processed'
        : 'Internal server error'
  );

  reply.code(statusCode).send({ error: clientError });
}

function enforceContentLength(content, maxChars, label) {
  if (typeof content !== 'string') {
    throw createClientError(400, 'Invalid content');
  }

  if (content.length > maxChars) {
    throw createClientError(413, `${label} too large`);
  }
}

function parseMultipartMetadata(fields = {}) {
  const rawMetadata = fields.metadata?.value;

  if (!rawMetadata) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawMetadata);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Metadata must be an object');
    }

    return parsed;
  } catch (error) {
    throw createClientError(400, 'Invalid metadata');
  }
}

function buildUploadMetadata(filename, mimetype, fileSize, clientMetadata = {}) {
  const fileType = path.extname(filename).toLowerCase();
  const existingFileMetadata = clientMetadata.file && typeof clientMetadata.file === 'object' && !Array.isArray(clientMetadata.file)
    ? clientMetadata.file
    : {};

  return {
    ...clientMetadata,
    source: clientMetadata.source || 'file_upload',
    filename,
    file_type: fileType,
    file_size: fileSize,
    mimetype,
    file: {
      ...existingFileMetadata,
      filename,
      file_type: fileType,
      file_size: fileSize,
      mimetype
    }
  };
}

function getObjectKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  return Object.keys(value).slice(0, OCR_LOG_KEY_LIMIT);
}

function deriveScopeAndProvenance(metadata = {}, defaults = {}) {
  const safeMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata
    : {};

  return {
    tenant_id: typeof safeMetadata.tenant_id === 'string' && safeMetadata.tenant_id.trim()
      ? safeMetadata.tenant_id.trim()
      : DEFAULT_NAMESPACE,
    workspace_id: typeof safeMetadata.workspace_id === 'string' && safeMetadata.workspace_id.trim()
      ? safeMetadata.workspace_id.trim()
      : DEFAULT_NAMESPACE,
    agent_id: typeof safeMetadata.agent_id === 'string' && safeMetadata.agent_id.trim()
      ? safeMetadata.agent_id.trim()
      : null,
    source_type: typeof safeMetadata.source_type === 'string' && safeMetadata.source_type.trim()
      ? safeMetadata.source_type.trim()
      : (defaults.source_type || null),
    source_uri: typeof safeMetadata.source_uri === 'string' && safeMetadata.source_uri.trim()
      ? safeMetadata.source_uri.trim()
      : null,
    source_hash: typeof safeMetadata.source_hash === 'string' && safeMetadata.source_hash.trim()
      ? safeMetadata.source_hash.trim()
      : null,
    captured_via: typeof safeMetadata.captured_via === 'string' && safeMetadata.captured_via.trim()
      ? safeMetadata.captured_via.trim()
      : (defaults.captured_via || null),
    captured_by: typeof safeMetadata.captured_by === 'string' && safeMetadata.captured_by.trim()
      ? safeMetadata.captured_by.trim()
      : null
  };
}

async function saveThoughtWithDedupe({
  scope,
  content,
  metadata,
  embedding,
  originalFilename = null,
  fileType = null,
  fileSize = null,
  sourceContext = '',
}) {
  const hashes = buildHashes({
    content,
    workspaceId: scope.workspace_id,
    sourceType: scope.source_type || 'unknown',
    sourceUri: scope.source_uri || '',
    sourceHash: scope.source_hash,
    sourceContext,
  });

  const existing = await pool.query(
    `SELECT id, created_at, tenant_id, workspace_id
     FROM thoughts
     WHERE workspace_id = $1 AND content_hash = $2
     ORDER BY id ASC
     LIMIT 1`,
    [scope.workspace_id, hashes.contentHash],
  );

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    return {
      id: row.id,
      created_at: row.created_at,
      tenant_id: row.tenant_id,
      workspace_id: row.workspace_id,
      content_hash: hashes.contentHash,
      source_hash: hashes.sourceHash,
      deduplicated: true,
    };
  }

  const inserted = await pool.query(
    `INSERT INTO thoughts
      (tenant_id, workspace_id, agent_id, source_type, source_uri, source_hash, content_hash, captured_via, captured_by, content, metadata, embedding, original_filename, file_type, file_size)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::vector, $13, $14, $15)
     RETURNING id, created_at, tenant_id, workspace_id`,
    [
      scope.tenant_id,
      scope.workspace_id,
      scope.agent_id,
      scope.source_type,
      scope.source_uri,
      hashes.sourceHash,
      hashes.contentHash,
      scope.captured_via,
      scope.captured_by,
      content,
      JSON.stringify(metadata),
      `[${embedding.join(',')}]`,
      originalFilename,
      fileType,
      fileSize,
    ],
  );

  return {
    ...inserted.rows[0],
    content_hash: hashes.contentHash,
    source_hash: hashes.sourceHash,
    deduplicated: false,
  };
}

fastify.setErrorHandler((error, request, reply) => {
  if (reply.sent) {
    return;
  }

  if (error.validation) {
    fastify.log.warn({
      method: request.method,
      url: request.url,
      validationErrors: error.validation.length
    }, 'Request validation failed');
    reply.code(400).send({ error: 'Invalid request' });
    return;
  }

  if (error.code === 'FST_REQ_FILE_TOO_LARGE' || error.statusCode === 413) {
    fastify.log.warn({ method: request.method, url: request.url }, 'Request rejected: payload too large');
    reply.code(413).send({ error: 'Payload too large' });
    return;
  }

  if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
    fastify.log.warn({
      err: error,
      method: request.method,
      url: request.url
    }, 'Request rejected');
    reply.code(error.statusCode).send({ error: error.clientError || 'Request could not be processed' });
    return;
  }

  fastify.log.error({
    err: error,
    method: request.method,
    url: request.url
  }, 'Unhandled request failure');
  reply.code(500).send({ error: 'Internal server error' });
});

// Security middleware: Validate X-OpenBrain-Key
async function validateApiKey(request, reply) {
  const providedKey = request.headers['x-openbrain-key'];

  if (!providedKey || providedKey !== OPENBRAIN_API_KEY) {
    reply.code(401).send({ error: 'Unauthorized' });
    return reply;
  }
}

// Health check endpoint
fastify.get('/health', async () => {
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

// Helper: Extract intelligent metadata from content using GPT-4o
async function extractMetadata(content, existingMetadata = {}) {
  // Skip extraction if content is too short (< 50 chars)
  if (content.length < 50) {
    return existingMetadata;
  }

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'system',
        content: `You are a metadata extraction assistant. Extract structured information from text and return ONLY valid JSON.

Extract:
1. People - names, roles, organizations mentioned
2. Topics - categories, themes, subject matter
3. Action Items - tasks, decisions, commitments, questions

For each extracted item, assign a confidence score (0-1) indicating how certain you are.

Return JSON matching this schema:
${JSON.stringify(METADATA_SCHEMA, null, 2)}

If no items of a type are found, return an empty array for that type. Be conservative with confidence scores - only extract what is clearly stated in the text.`
      }, {
        role: 'user',
        content: `Extract metadata from this text:\n\n${content.substring(0, 4000)}\n\nReturn JSON following the specified schema.`
      }],
      response_format: { type: 'json_object' },
      temperature: 0.1
    });

    const extracted = JSON.parse(response.choices[0].message.content);

    // Merge with existing metadata
    return {
      ...existingMetadata,
      extracted: {
        people: extracted.people || [],
        topics: extracted.topics || [],
        action_items: extracted.action_items || []
      },
      extracted_at: new Date().toISOString(),
      extraction_model: 'gpt-4o'
    };
  } catch (error) {
    fastify.log.error({ message: error.message }, 'Metadata extraction failed');
    // Return original metadata on failure
    return existingMetadata;
  }
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

    case '.pdf': {
      // PDF files - use pdf-parse
      const data = await pdf(buffer);
      content = data.text;
      break;
    }

    case '.docx': {
      // Word documents - use mammoth
      const result = await mammoth.extractRawText({ buffer });
      content = result.value;
      break;
    }

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
      throw createClientError(400, 'Unsupported file type');
  }

  return { content, fileSize };
}

// Helper: Extract text from images using z.ai GLM-OCR
async function extractTextWithGLMOCR(buffer, filename) {
  if (!ZAI_API_KEY) {
    throw createClientError(503, 'Image text extraction is unavailable');
  }

  try {
    // Convert buffer to base64
    const base64Image = buffer.toString('base64');

    // Determine MIME type based on file extension
    const ext = path.extname(filename).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' :
      ext === '.gif' ? 'image/gif' :
        ext === '.bmp' ? 'image/bmp' :
          ext === '.webp' ? 'image/webp' :
            'image/jpeg';

    // Call z.ai GLM-OCR API
    const response = await axios.post(
      'https://api.z.ai/api/paas/v4/layout_parsing',
      {
        model: 'glm-ocr',
        file: `data:${mimeType};base64,${base64Image}`
      },
      {
        headers: {
          Authorization: `Bearer ${ZAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    fastify.log.info({ statusCode: response.status }, 'GLM-OCR request completed');

    // Extract text from response - the API returns data at root level
    if (response.data) {
      if (response.data.md_results) {
        return response.data.md_results;
      }

      if (response.data.text) {
        return response.data.text;
      }

      if (response.data.content) {
        return response.data.content;
      }

      fastify.log.warn({
        statusCode: response.status,
        responseKeys: getObjectKeys(response.data)
      }, 'Unexpected GLM-OCR response format');
      throw createClientError(502, 'Image text extraction failed');
    }

    throw createClientError(502, 'Image text extraction failed');
  } catch (error) {
    if (error.clientError) {
      throw error;
    }

    if (error.response) {
      fastify.log.error({
        statusCode: error.response.status,
        responseKeys: getObjectKeys(error.response.data)
      }, 'GLM-OCR API error response');
    } else {
      fastify.log.error({ message: error.message }, 'GLM-OCR API error');
    }

    throw createClientError(502, 'Image text extraction failed');
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
    enforceContentLength(content, MAX_CAPTURE_CONTENT_CHARS, 'Content');

    // Extract intelligent metadata using GPT-4o
    const enhancedMetadata = await extractMetadata(content, metadata);

    fastify.log.info('Extracting metadata...');
    if (enhancedMetadata.extracted) {
      const { people, topics, action_items } = enhancedMetadata.extracted;
      fastify.log.info(`Extracted ${people.length} people, ${topics.length} topics, ${action_items.length} action items`);
    }

    // Generate embedding using OpenAI text-embedding-3-large (3072 dimensions)
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-large',
      input: content,
      dimensions: 3072,
    });

    const embedding = embeddingResponse.data[0].embedding;

    const scope = deriveScopeAndProvenance(enhancedMetadata, {
      source_type: 'manual',
      captured_via: 'api'
    });

    const result = await saveThoughtWithDedupe({
      scope,
      content,
      metadata: enhancedMetadata,
      embedding,
      sourceContext: 'capture',
    });

    const { id, created_at, tenant_id, workspace_id, deduplicated, content_hash, source_hash } = result;

    return {
      success: true,
      data: {
        id,
        tenant_id,
        workspace_id,
        deduplicated,
        content_hash,
        source_hash,
        content,
        metadata: enhancedMetadata,
        created_at
      }
    };
  } catch (error) {
    fastify.log.error({
      err: error,
      contentLength: typeof content === 'string' ? content.length : undefined
    }, 'Error capturing thought');
    sendClientError(reply, error);
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
    const clientMetadata = parseMultipartMetadata(data.fields || {});

    fastify.log.info(`Processing file upload: ${filename} (${mimetype})`);

    // Extract text from file
    const extractionResult = await extractTextFromFile(file, filename);
    const { content, fileSize } = extractionResult;

    // Validate extracted content
    if (!content || content.trim().length === 0) {
      reply.code(400).send({ error: 'No text content found in file' });
      return;
    }

    enforceContentLength(content, MAX_EXTRACTED_CONTENT_CHARS, 'Extracted content');

    // Generate metadata
    const metadata = buildUploadMetadata(filename, mimetype, fileSize, clientMetadata);

    // Extract intelligent metadata using GPT-4o
    const enhancedMetadata = await extractMetadata(content, metadata);

    if (enhancedMetadata.extracted) {
      const { people, topics, action_items } = enhancedMetadata.extracted;
      fastify.log.info(`Extracted ${people.length} people, ${topics.length} topics, ${action_items.length} action items from file`);
    }

    // Generate embedding using OpenAI
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-large',
      input: content,
      dimensions: 3072,
    });

    const embedding = embeddingResponse.data[0].embedding;

    const scope = deriveScopeAndProvenance(enhancedMetadata, {
      source_type: 'file_upload',
      captured_via: 'upload'
    });

    const result = await saveThoughtWithDedupe({
      scope,
      content,
      metadata: enhancedMetadata,
      embedding,
      originalFilename: filename,
      fileType: path.extname(filename).toLowerCase(),
      fileSize,
      sourceContext: `${filename}:${fileSize}`,
    });

    const { id, created_at, tenant_id, workspace_id, deduplicated, content_hash, source_hash } = result;

    fastify.log.info(`Successfully processed file: ${filename} -> thought ID: ${id}`);

    return {
      success: true,
      data: {
        id,
        tenant_id,
        workspace_id,
        deduplicated,
        content_hash,
        source_hash,
        content: content.substring(0, 500) + (content.length > 500 ? '...' : ''),
        full_content_length: content.length,
        metadata: enhancedMetadata,
        original_filename: filename,
        file_type: path.extname(filename).toLowerCase(),
        file_size: fileSize,
        created_at
      }
    };
  } catch (error) {
    fastify.log.error({ err: error }, 'Error processing file upload');
    sendClientError(reply, error);
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
        await new Promise((resolve) => setTimeout(resolve, 2000));
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
