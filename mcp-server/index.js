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

const TOOLS = [
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
  {
    name: 'semantic_search_filtered',
    description: 'Search thoughts using semantic similarity plus metadata filters for people, topics, and action types.',
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
        filters: {
          type: 'object',
          properties: {
            people: {
              type: 'array',
              items: { type: 'string' },
              description: 'Match any extracted person name',
            },
            topics: {
              type: 'array',
              items: { type: 'string' },
              description: 'Match any extracted topic name',
            },
            action_types: {
              type: 'array',
              items: { type: 'string', enum: ['task', 'decision', 'commitment', 'question'] },
              description: 'Match any extracted action item type',
            },
          },
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_metadata_stats',
    description: 'Get aggregate metadata statistics plus commonly available people, topics, and action types.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

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

async function createQueryEmbedding(query) {
  if (!openai) {
    throw new Error('OPENAI_API_KEY is required for semantic search');
  }

  const embeddingResponse = await openai.embeddings.create({
    model: 'text-embedding-3-large',
    input: query,
    dimensions: 3072,
  });

  return `[${embeddingResponse.data[0].embedding.join(',')}]`;
}

function buildMetadataFilterClause(filters = {}, startingIndex = 3) {
  const conditions = ['embedding IS NOT NULL'];
  const values = [];
  let nextIndex = startingIndex;

  if (filters.people?.length > 0) {
    conditions.push(`EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(metadata->'extracted'->'people', '[]'::jsonb)) AS person
      WHERE LOWER(person->>'name') = ANY($${nextIndex}::text[])
    )`);
    values.push(filters.people.map((person) => person.toLowerCase()));
    nextIndex++;
  }

  if (filters.topics?.length > 0) {
    conditions.push(`EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(metadata->'extracted'->'topics', '[]'::jsonb)) AS topic
      WHERE LOWER(topic->>'name') = ANY($${nextIndex}::text[])
    )`);
    values.push(filters.topics.map((topic) => topic.toLowerCase()));
    nextIndex++;
  }

  if (filters.action_types?.length > 0) {
    conditions.push(`EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(metadata->'extracted'->'action_items', '[]'::jsonb)) AS action
      WHERE LOWER(action->>'type') = ANY($${nextIndex}::text[])
    )`);
    values.push(filters.action_types.map((actionType) => actionType.toLowerCase()));
    nextIndex++;
  }

  return {
    whereClause: conditions.join(' AND '),
    values,
  };
}

async function runSemanticSearch(query, limit = 10, filters = null) {
  if (!query) {
    throw new Error('Missing required parameter: query');
  }

  const embeddingString = await createQueryEmbedding(query);
  const values = [embeddingString, limit];
  let whereClause = 'embedding IS NOT NULL';

  if (filters) {
    const filterQuery = buildMetadataFilterClause(filters, 3);
    whereClause = filterQuery.whereClause;
    values.push(...filterQuery.values);
  }

  const result = await pool.query(
    `SELECT id, content, metadata, created_at,
            1 - (embedding <=> $1::vector) AS similarity
     FROM thoughts
     WHERE ${whereClause}
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    values
  );

  return result.rows;
}

async function getMetadataStats() {
  const statsResult = await pool.query(`
    SELECT
      COUNT(*)::int AS total_thoughts,
      COUNT(*) FILTER (WHERE metadata ? 'extracted')::int AS thoughts_with_metadata,
      COALESCE(SUM(jsonb_array_length(COALESCE(metadata->'extracted'->'people', '[]'::jsonb))), 0)::int AS total_people,
      COALESCE(SUM(jsonb_array_length(COALESCE(metadata->'extracted'->'topics', '[]'::jsonb))), 0)::int AS total_topics,
      COALESCE(SUM(jsonb_array_length(COALESCE(metadata->'extracted'->'action_items', '[]'::jsonb))), 0)::int AS total_actions
    FROM thoughts
  `);

  const peopleResult = await pool.query(`
    SELECT DISTINCT person->>'name' AS person
    FROM thoughts
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(metadata->'extracted'->'people', '[]'::jsonb)) AS person
    WHERE person->>'name' IS NOT NULL AND person->>'name' <> ''
    ORDER BY person
    LIMIT 20
  `);

  const topicsResult = await pool.query(`
    SELECT DISTINCT topic->>'name' AS topic
    FROM thoughts
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(metadata->'extracted'->'topics', '[]'::jsonb)) AS topic
    WHERE topic->>'name' IS NOT NULL AND topic->>'name' <> ''
    ORDER BY topic
    LIMIT 20
  `);

  const actionTypesResult = await pool.query(`
    SELECT action->>'type' AS action_type, COUNT(*)::int AS count
    FROM thoughts
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(metadata->'extracted'->'action_items', '[]'::jsonb)) AS action
    WHERE action->>'type' IS NOT NULL AND action->>'type' <> ''
    GROUP BY action->>'type'
    ORDER BY count DESC, action_type ASC
  `);

  return {
    stats: statsResult.rows[0],
    unique_people: peopleResult.rows.map((row) => row.person),
    unique_topics: topicsResult.rows.map((row) => row.topic),
    action_types: actionTypesResult.rows,
  };
}

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'semantic_search': {
        const { query, limit = 10 } = args || {};
        const thoughts = await runSemanticSearch(query, limit);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ query, thoughts, count: thoughts.length }, null, 2),
            },
          ],
        };
      }

      case 'semantic_search_filtered': {
        const { query, limit = 10, filters = {} } = args || {};
        const thoughts = await runSemanticSearch(query, limit, filters);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ query, filters, thoughts, count: thoughts.length }, null, 2),
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
              text: JSON.stringify({ thoughts: result.rows, count: result.rows.length }, null, 2),
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
                total_thoughts: parseInt(countResult.rows[0].count, 10),
                latest_thought_at: latestResult.rows[0]?.created_at || null,
              }, null, 2),
            },
          ],
        };
      }

      case 'get_metadata_stats': {
        const metadataStats = await getMetadataStats();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(metadataStats, null, 2),
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
          text: JSON.stringify({ error: error.message }),
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
