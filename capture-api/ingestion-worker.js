const pg = require('pg');
const OpenAI = require('openai');
const axios = require('axios');
const path = require('path');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const { buildHashes } = require('./hashing');
const { chunkDocument } = require('./chunking');

const DEFAULT_NAMESPACE = 'default';
const POLL_INTERVAL_MS = 2000;

const {
  DB_HOST,
  DB_PORT,
  DB_NAME,
  DB_USER,
  DB_PASSWORD,
  OPENAI_API_KEY,
  ZAI_API_KEY,
} = process.env;

if (!DB_PASSWORD || !OPENAI_API_KEY) {
  // eslint-disable-next-line no-console
  console.error('Missing required environment variables for ingestion worker');
  process.exit(1);
}

const pool = new pg.Pool({
  host: DB_HOST,
  port: parseInt(DB_PORT, 10),
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

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

async function extractMetadata(content, existingMetadata = {}) {
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
      temperature: 0.1,
    });

    const extracted = JSON.parse(response.choices[0].message.content);
    return {
      ...existingMetadata,
      extracted: {
        people: extracted.people || [],
        topics: extracted.topics || [],
        action_items: extracted.action_items || [],
      },
      extracted_at: new Date().toISOString(),
      extraction_model: 'gpt-4o',
    };
  } catch {
    return existingMetadata;
  }
}

async function extractTextWithGLMOCR(buffer, filename) {
  if (!ZAI_API_KEY) {
    throw new Error('Image text extraction is unavailable');
  }

  const base64Image = buffer.toString('base64');
  const ext = path.extname(filename).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' :
    ext === '.gif' ? 'image/gif' :
      ext === '.bmp' ? 'image/bmp' :
        ext === '.webp' ? 'image/webp' :
          'image/jpeg';

  const response = await axios.post(
    'https://api.z.ai/api/paas/v4/layout_parsing',
    {
      model: 'glm-ocr',
      file: `data:${mimeType};base64,${base64Image}`
    },
    {
      headers: {
        Authorization: `Bearer ${ZAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );

  if (response.data?.md_results) return response.data.md_results;
  if (response.data?.text) return response.data.text;
  if (response.data?.content) return response.data.content;

  throw new Error('Image text extraction failed');
}

async function extractTextFromBuffer(buffer, filename) {
  const ext = path.extname(filename).toLowerCase();

  switch (ext) {
    case '.txt':
    case '.md':
      return buffer.toString('utf-8');
    case '.pdf': {
      const data = await pdf(buffer);
      return data.text;
    }
    case '.docx': {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }
    case '.jpg':
    case '.jpeg':
    case '.png':
    case '.gif':
    case '.bmp':
    case '.webp':
      return extractTextWithGLMOCR(buffer, filename);
    default:
      throw new Error('Unsupported file type');
  }
}

async function saveThoughtWithDedupe({
  scope,
  content,
  metadata,
  embedding,
  originalFilename,
  fileType,
  fileSize,
  sourceContext,
  parentDocumentId = null,
  chunkIndex = null,
  tokenCount = null,
  headingPath = null,
  dedupeByContent = true,
}) {
  const hashes = buildHashes({
    content,
    workspaceId: scope.workspace_id,
    sourceType: scope.source_type || 'unknown',
    sourceUri: scope.source_uri || '',
    sourceHash: scope.source_hash,
    sourceContext,
  });

  if (dedupeByContent) {
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
        ...row,
        content_hash: hashes.contentHash,
        source_hash: hashes.sourceHash,
        deduplicated: true,
      };
    }
  }

  const inserted = await pool.query(
    `INSERT INTO thoughts
      (tenant_id, workspace_id, agent_id, source_type, source_uri, source_hash, content_hash, parent_document_id, chunk_index, token_count, heading_path, captured_via, captured_by, content, metadata, embedding, original_filename, file_type, file_size)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::vector, $17, $18, $19)
     RETURNING id, created_at, tenant_id, workspace_id`,
    [
      scope.tenant_id,
      scope.workspace_id,
      scope.agent_id,
      scope.source_type,
      scope.source_uri,
      hashes.sourceHash,
      hashes.contentHash,
      parentDocumentId,
      chunkIndex,
      tokenCount,
      headingPath,
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

async function claimNextJob(client) {
  await client.query('BEGIN');
  try {
    const next = await client.query(
      `SELECT id
       FROM ingestion_jobs
       WHERE status IN ('queued')
       ORDER BY created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1`
    );

    if (next.rows.length === 0) {
      await client.query('COMMIT');
      return null;
    }

    const claimed = await client.query(
      `UPDATE ingestion_jobs
       SET status = 'processing', attempt_count = attempt_count + 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING id, workspace_id, status, attempt_count, payload, created_at, updated_at`,
      [next.rows[0].id],
    );

    await client.query('COMMIT');
    return claimed.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function markJobCompleted(jobId, result) {
  await pool.query(
    `UPDATE ingestion_jobs
     SET status = 'completed', result = $2::jsonb, error = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [jobId, JSON.stringify(result)],
  );
}

async function markJobFailed(jobId, message) {
  await pool.query(
    `UPDATE ingestion_jobs
     SET status = 'failed', error = $2, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [jobId, String(message).slice(0, 1000)],
  );
}

async function processJob(job) {
  const payload = job.payload || {};
  const filename = payload.filename;
  const mimetype = payload.mimetype || 'application/octet-stream';
  const fileSize = payload.file_size || 0;
  const rawMetadata = payload.metadata || {};

  if (!filename || !payload.file_base64) {
    throw new Error('Invalid job payload');
  }

  const buffer = Buffer.from(payload.file_base64, 'base64');
  const content = await extractTextFromBuffer(buffer, filename);

  if (!content || !content.trim()) {
    throw new Error('No text content found in file');
  }

  const metadata = buildUploadMetadata(filename, mimetype, fileSize, rawMetadata);
  const enhancedMetadata = await extractMetadata(content, metadata);

  const scope = deriveScopeAndProvenance(enhancedMetadata, {
    source_type: 'file_upload',
    captured_via: 'ingestion-worker',
  });

  const documentHashes = buildHashes({
    content,
    workspaceId: scope.workspace_id,
    sourceType: scope.source_type || 'file_upload',
    sourceUri: scope.source_uri || '',
    sourceHash: scope.source_hash,
    sourceContext: `${filename}:${fileSize}`,
  });

  const scopedWithSource = {
    ...scope,
    source_hash: documentHashes.sourceHash,
  };

  const existingDoc = await pool.query(
    `SELECT id, tenant_id, workspace_id
     FROM thoughts
     WHERE workspace_id = $1 AND source_hash = $2 AND chunk_index = 0
     ORDER BY id ASC
     LIMIT 1`,
    [scopedWithSource.workspace_id, scopedWithSource.source_hash],
  );

  if (existingDoc.rows.length > 0) {
    const root = existingDoc.rows[0];
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM thoughts
       WHERE workspace_id = $1 AND source_hash = $2`,
      [scopedWithSource.workspace_id, scopedWithSource.source_hash],
    );

    return {
      thought_id: root.id,
      tenant_id: root.tenant_id,
      workspace_id: root.workspace_id,
      deduplicated: true,
      content_hash: null,
      source_hash: scopedWithSource.source_hash,
      original_filename: filename,
      file_type: path.extname(filename).toLowerCase(),
      file_size: fileSize,
      full_content_length: content.length,
      chunk_count: countResult.rows[0].count,
    };
  }

  const chunks = chunkDocument(content, {
    maxTokens: 350,
    overlapTokens: 60,
  });

  let rootThoughtId = null;
  let firstChunkResult = null;

  for (const chunk of chunks) {
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-large',
      input: chunk.content,
      dimensions: 3072,
    });

    const embedding = embeddingResponse.data[0].embedding;

    const saved = await saveThoughtWithDedupe({
      scope: scopedWithSource,
      content: chunk.content,
      metadata: enhancedMetadata,
      embedding,
      originalFilename: filename,
      fileType: path.extname(filename).toLowerCase(),
      fileSize,
      sourceContext: `${filename}:${fileSize}:chunk:${chunk.chunk_index}`,
      parentDocumentId: rootThoughtId,
      chunkIndex: chunk.chunk_index,
      tokenCount: chunk.token_count,
      headingPath: chunk.heading_path,
      dedupeByContent: false,
    });

    if (!rootThoughtId) {
      rootThoughtId = saved.id;
      firstChunkResult = saved;

      await pool.query(
        `UPDATE thoughts
         SET parent_document_id = $2
         WHERE id = $1`,
        [rootThoughtId, rootThoughtId],
      );
    }
  }

  return {
    thought_id: rootThoughtId,
    tenant_id: firstChunkResult?.tenant_id || scopedWithSource.tenant_id,
    workspace_id: firstChunkResult?.workspace_id || scopedWithSource.workspace_id,
    deduplicated: false,
    content_hash: firstChunkResult?.content_hash || null,
    source_hash: scopedWithSource.source_hash,
    original_filename: filename,
    file_type: path.extname(filename).toLowerCase(),
    file_size: fileSize,
    full_content_length: content.length,
    chunk_count: chunks.length,
  };
}

async function workerLoop() {
  while (true) {
    const client = await pool.connect();
    let claimed = null;

    try {
      claimed = await claimNextJob(client);
    } finally {
      client.release();
    }

    if (!claimed) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      continue;
    }

    try {
      // eslint-disable-next-line no-console
      console.log(`[ingestion-worker] processing job ${claimed.id}`);
      const result = await processJob(claimed);
      await markJobCompleted(claimed.id, result);
      // eslint-disable-next-line no-console
      console.log(`[ingestion-worker] completed job ${claimed.id}`);
    } catch (error) {
      await markJobFailed(claimed.id, error.message || 'processing failed');
      // eslint-disable-next-line no-console
      console.error(`[ingestion-worker] failed job ${claimed.id}:`, error.message || error);
    }
  }
}

async function main() {
  let retries = 30;
  while (retries > 0) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch (err) {
      retries -= 1;
      if (retries === 0) throw err;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  // eslint-disable-next-line no-console
  console.log('[ingestion-worker] started');
  await workerLoop();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[ingestion-worker] fatal error:', error);
  process.exit(1);
});
