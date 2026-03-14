#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import pg from 'pg';
import OpenAI from 'openai';

// Environment variables
const {
  DB_HOST,
  DB_PORT,
  DB_NAME,
  DB_USER,
  DB_PASSWORD,
  OPENAI_API_KEY
} = process.env;

// Validate required environment variables
if (!DB_PASSWORD) {
  console.error('Missing required environment variable: DB_PASSWORD');
  process.exit(1);
}

// OpenAI client for query embeddings
const openai = OPENAI_API_KEY ? new OpenAI({
  apiKey: OPENAI_API_KEY,
}) : null;

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

// Create MCP server instance
const server = new Server(
  {
    name: 'openbrain-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'semantic_search',
        description: 'Search thoughts using semantic similarity. Returns thoughts ranked by cosine similarity to the query.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query text to find semantically similar thoughts',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return (default: 10)',
              default: 10,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'list_recent',
        description: 'List the most recently added thoughts',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum number of results to return (default: 20)',
              default: 20,
            },
          },
        },
      },
      {
        name: 'get_stats',
        description: 'Get statistics about the thoughts database',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'semantic_search': {
        const { query, limit = 10 } = args || {};

        if (!query) {
          throw new Error('Missing required parameter: query');
        }

        // Generate embedding for the search query
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

        // Perform semantic search using cosine distance (<=>)
        // Lower cosine distance = higher similarity (1 - distance gives similarity score)
        const result = await pool.query(
          `SELECT id, content, metadata, created_at,
                  1 - (embedding <=> $1::vector) as similarity
           FROM thoughts
           WHERE embedding IS NOT NULL
           ORDER BY embedding <=> $1::vector
           LIMIT $2`,
          [embeddingString, limit]
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                query,
                thoughts: result.rows,
                count: result.rows.length,
              }, null, 2),
            },
          ],
        };
      }

      case 'list_recent': {
        const { limit = 20 } = args || {};

        const result = await pool.query(
          'SELECT id, content, metadata, created_at FROM thoughts ORDER BY created_at DESC LIMIT $1',
          [limit]
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                thoughts: result.rows,
                count: result.rows.length,
              }, null, 2),
            },
          ],
        };
      }

      case 'get_stats': {
        const countResult = await pool.query('SELECT COUNT(*) as count FROM thoughts');
        const latestResult = await pool.query(
          'SELECT created_at FROM thoughts ORDER BY created_at DESC LIMIT 1'
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                total_thoughts: parseInt(countResult.rows[0].count),
                latest_thought_at: latestResult.rows[0]?.created_at || null,
              }, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: error.message,
          }),
        },
      ],
      isError: true,
    };
  }
});

// Graceful shutdown
const gracefulShutdown = async () => {
  console.error('Shutting down MCP server gracefully...');
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Open Brain MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
