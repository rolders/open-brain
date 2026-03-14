#!/usr/bin/env node

import express from 'express';
import pg from 'pg';
import OpenAI from 'openai';

// Environment variables
const {
  DB_HOST,
  DB_PORT,
  DB_NAME,
  DB_USER,
  DB_PASSWORD,
  OPENAI_API_KEY,
  PORT = 3000
} = process.env;

// Validate required environment variables
if (!DB_PASSWORD) {
  console.error('Missing required environment variable: DB_PASSWORD');
  process.exit(1);
}

// PostgreSQL connection pool (using brain_reader role - read-only)
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

// OpenAI client for query embeddings
const openai = OPENAI_API_KEY ? new OpenAI({
  apiKey: OPENAI_API_KEY,
}) : null;

// Express app
const app = express();
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// MCP endpoint for Telegram bot
app.post('/mcp', async (req, res) => {
  try {
    const { method, params } = req.body;

    if (method === 'tools/call') {
      const { name, arguments: args } = params;

      let result;
      switch (name) {
        case 'semantic_search': {
          const { query, limit = 10 } = args || {};

          if (!query) {
            throw new Error('Missing required parameter: query');
          }

          if (!openai) {
            throw new Error('OPENAI_API_KEY is required for semantic search');
          }

          const embeddingResponse = await openai.embeddings.create({
            model: 'text-embedding-3-large',
            input: query,
            dimensions: 3072,
          });

          const queryEmbedding = embeddingResponse.data[0].embedding;
          const embeddingString = `[${queryEmbedding.join(',')}]`;

          const dbResult = await pool.query(
            `SELECT id, content, metadata, created_at,
                    1 - (embedding <=> $1::vector) as similarity
             FROM thoughts
             WHERE embedding IS NOT NULL
             ORDER BY embedding <=> $1::vector
             LIMIT $2`,
            [embeddingString, limit]
          );

          result = {
            content: [{
              type: 'text',
              text: JSON.stringify({
                query,
                thoughts: dbResult.rows,
                count: dbResult.rows.length,
              }, null, 2),
            }],
          };
          break;
        }

        case 'list_recent': {
          const { limit = 20 } = args || {};

          const dbResult = await pool.query(
            'SELECT id, content, metadata, created_at FROM thoughts ORDER BY created_at DESC LIMIT $1',
            [limit]
          );

          result = {
            content: [{
              type: 'text',
              text: JSON.stringify({
                thoughts: dbResult.rows,
                count: dbResult.rows.length,
              }, null, 2),
            }],
          };
          break;
        }

        case 'get_stats': {
          const countResult = await pool.query('SELECT COUNT(*) as count FROM thoughts');
          const latestResult = await pool.query(
            'SELECT created_at FROM thoughts ORDER BY created_at DESC LIMIT 1'
          );

          result = {
            content: [{
              type: 'text',
              text: JSON.stringify({
                total_thoughts: parseInt(countResult.rows[0].count),
                latest_thought_at: latestResult.rows[0]?.created_at || null,
              }, null, 2),
            }],
          };
          break;
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      res.json({
        jsonrpc: '2.0',
        result,
        id: req.body.id || Date.now(),
      });
    } else {
      res.status(400).json({ error: 'Unsupported method' });
    }
  } catch (error) {
    console.error('Error processing MCP request:', error);
    res.status(500).json({
      error: error.message,
    });
  }
});

// Graceful shutdown
const gracefulShutdown = async () => {
  console.log('Shutting down MCP HTTP server gracefully...');
  await pool.end();
  process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start server
async function main() {
  // Wait for database to be ready
  let retries = 30;
  while (retries > 0) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch (err) {
      retries--;
      if (retries === 0) throw err;
      console.error(`Database not ready, retrying... (${retries} attempts left)`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MCP HTTP server listening on port ${PORT}`);
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
