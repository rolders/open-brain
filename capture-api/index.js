const Fastify = require('fastify');
const pg = require('pg');
const OpenAI = require('openai');

const fastify = Fastify({ logger: true });

// Environment variables
const {
  DB_HOST,
  DB_PORT,
  DB_NAME,
  DB_USER,
  DB_PASSWORD,
  OPENBRAIN_API_KEY,
  OPENAI_API_KEY,
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

// Capture endpoint
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
    // Generate embedding using OpenAI text-embedding-3-small (1536 dimensions)
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
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
