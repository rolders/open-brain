#!/usr/bin/env node

import express from 'express';
import pg from 'pg';
import OpenAI from 'openai';

const JSON_RPC_VERSION = '2.0';
const MAX_LIMIT = 25;
const MAX_QUERY_LENGTH = 1000;
const ALLOWED_ACTION_TYPES = new Set(['task', 'decision', 'commitment', 'question']);

// Environment variables
const {
  DB_HOST,
  DB_PORT,
  DB_NAME,
  DB_USER,
  DB_PASSWORD,
  OPENAI_API_KEY,
  MCP_API_KEY,
  PORT = 3000,
} = process.env;

// Validate required environment variables
for (const variableName of ['DB_PASSWORD', 'MCP_API_KEY']) {
  if (!process.env[variableName]) {
    console.error(`Missing required environment variable: ${variableName}`);
    process.exit(1);
  }
}

// PostgreSQL connection pool (using brain_reader role - read-only)
const pool = new pg.Pool({
  host: DB_HOST,
  port: parseInt(DB_PORT, 10),
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
const mcpJsonParser = express.json({ strict: true });

// MCP Server metadata
const SERVER_INFO = {
  name: 'openbrain-mcp-server',
  version: '1.0.0',
  description: 'Open Brain memory system - persistent memory with semantic search',
  author: 'Open Brain',
  homepage: 'https://github.com/rolders/open-brain',
};

// MCP Tools schema
const TOOLS = [
  {
    name: 'semantic_search',
    description: 'Search your memory using semantic similarity to find related thoughts',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to find semantically similar thoughts',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 10)',
          default: 10,
        },
        workspace_id: {
          type: 'string',
          description: 'Workspace namespace filter (default: default)',
          default: 'default',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_recent',
    description: 'Get the most recent thoughts from your memory',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of recent thoughts to return (default: 20)',
          default: 20,
        },
        workspace_id: {
          type: 'string',
          description: 'Workspace namespace filter (default: default)',
          default: 'default',
        },
      },
    },
  },
  {
    name: 'get_stats',
    description: 'Get statistics about your memory (total thoughts, latest thought, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: {
          type: 'string',
          description: 'Workspace namespace filter (default: default)',
          default: 'default',
        },
      },
    },
  },
  {
    name: 'semantic_search_filtered',
    description: 'Search memory with semantic similarity and metadata filters (people, topics, action types)',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to find semantically similar thoughts',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 10)',
          default: 10,
        },
        workspace_id: {
          type: 'string',
          description: 'Workspace namespace filter (default: default)',
          default: 'default',
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
    description: 'Get metadata statistics and available filters (people, topics, action items)',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: {
          type: 'string',
          description: 'Workspace namespace filter (default: default)',
          default: 'default',
        },
      },
    },
  },
  {
    name: 'list_entities',
    description: 'List canonical entities for a workspace (aliases resolved).',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: {
          type: 'string',
          description: 'Workspace namespace filter (default: default)',
          default: 'default',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of entities to return (default: 20)',
          default: 20,
        },
      },
    },
  },
  {
    name: 'list_action_items',
    description: 'List action items independently from raw memory content.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: {
          type: 'string',
          description: 'Workspace namespace filter (default: default)',
          default: 'default',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of action items to return (default: 20)',
          default: 20,
        },
      },
    },
  },
];

const TOOL_NAMES = new Set(TOOLS.map((tool) => tool.name));

class JsonRpcError extends Error {
  constructor({ status = 400, code, message, id = null }) {
    super(message);
    this.name = 'JsonRpcError';
    this.status = status;
    this.code = code;
    this.id = id;
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getRequestId(body) {
  if (!isPlainObject(body) || !Object.prototype.hasOwnProperty.call(body, 'id')) {
    return null;
  }

  return body.id;
}

function createJsonRpcErrorResponse(code, message, id = null) {
  return {
    jsonrpc: JSON_RPC_VERSION,
    error: { code, message },
    id,
  };
}

function sendJsonRpcError(res, error, fallbackId = null) {
  const id = error instanceof JsonRpcError ? error.id ?? fallbackId : fallbackId;
  const status = error instanceof JsonRpcError ? error.status : 500;
  const code = error instanceof JsonRpcError ? error.code : -32603;
  const message = error instanceof JsonRpcError ? error.message : 'Internal error';

  return res.status(status).json(createJsonRpcErrorResponse(code, message, id));
}

function invalidRequest(message, id = null) {
  return new JsonRpcError({ status: 400, code: -32600, message, id });
}

function invalidParams(message, id = null) {
  return new JsonRpcError({ status: 400, code: -32602, message, id });
}

function methodNotFound(id = null) {
  return new JsonRpcError({ status: 400, code: -32601, message: 'Method not found', id });
}

function toolNotFound(id = null) {
  return new JsonRpcError({ status: 400, code: -32601, message: 'Tool not found', id });
}

function normalizeLimit(value, defaultLimit, id) {
  if (value === undefined) {
    return defaultLimit;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidParams('Invalid params: limit must be a finite number', id);
  }

  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(value)));
}

function normalizeWorkspaceId(value, id) {
  if (value === undefined) {
    return 'default';
  }

  if (typeof value !== 'string') {
    throw invalidParams('Invalid params: workspace_id must be a non-empty string', id);
  }

  const workspaceId = value.trim();
  if (!workspaceId) {
    throw invalidParams('Invalid params: workspace_id must be a non-empty string', id);
  }

  return workspaceId;
}

function normalizeStringArray(values, fieldName, id, allowedValues = null) {
  if (values === undefined) {
    return undefined;
  }

  if (!Array.isArray(values)) {
    throw invalidParams(`Invalid params: ${fieldName} must be an array of non-empty strings`, id);
  }

  const normalizedValues = values.map((value) => {
    if (typeof value !== 'string') {
      throw invalidParams(`Invalid params: ${fieldName} must be an array of non-empty strings`, id);
    }

    const trimmedValue = value.trim();
    if (!trimmedValue) {
      throw invalidParams(`Invalid params: ${fieldName} must be an array of non-empty strings`, id);
    }

    if (allowedValues && !allowedValues.has(trimmedValue.toLowerCase())) {
      throw invalidParams(`Invalid params: ${fieldName} contains an unsupported value`, id);
    }

    return trimmedValue;
  });

  return normalizedValues;
}

function normalizeFilters(filters, id) {
  if (filters === undefined) {
    return undefined;
  }

  if (!isPlainObject(filters)) {
    throw invalidParams('Invalid params: filters must be an object', id);
  }

  const normalizedFilters = {};

  const people = normalizeStringArray(filters.people, 'filters.people', id);
  if (people && people.length > 0) {
    normalizedFilters.people = people;
  }

  const topics = normalizeStringArray(filters.topics, 'filters.topics', id);
  if (topics && topics.length > 0) {
    normalizedFilters.topics = topics;
  }

  const actionTypes = normalizeStringArray(filters.action_types, 'filters.action_types', id, ALLOWED_ACTION_TYPES);
  if (actionTypes && actionTypes.length > 0) {
    normalizedFilters.action_types = actionTypes.map((actionType) => actionType.toLowerCase());
  }

  return normalizedFilters;
}

function requireQuery(args, id) {
  if (typeof args.query !== 'string') {
    throw invalidParams('Invalid params: query must be a non-empty string', id);
  }

  const query = args.query.trim();
  if (!query) {
    throw invalidParams('Invalid params: query must be a non-empty string', id);
  }

  if (query.length > MAX_QUERY_LENGTH) {
    throw invalidParams(`Invalid params: query must not exceed ${MAX_QUERY_LENGTH} characters`, id);
  }

  return query;
}

function normalizeToolArguments(toolName, rawArguments, id) {
  const args = rawArguments === undefined ? {} : rawArguments;

  if (!isPlainObject(args)) {
    throw invalidParams('Invalid params: arguments must be an object', id);
  }

  switch (toolName) {
    case 'semantic_search':
      return {
        query: requireQuery(args, id),
        limit: normalizeLimit(args.limit, 10, id),
        workspace_id: normalizeWorkspaceId(args.workspace_id, id),
      };

    case 'semantic_search_filtered':
      return {
        query: requireQuery(args, id),
        limit: normalizeLimit(args.limit, 10, id),
        workspace_id: normalizeWorkspaceId(args.workspace_id, id),
        filters: normalizeFilters(args.filters, id) ?? {},
      };

    case 'list_recent':
      return {
        limit: normalizeLimit(args.limit, 20, id),
        workspace_id: normalizeWorkspaceId(args.workspace_id, id),
      };

    case 'get_stats':
    case 'get_metadata_stats':
      return {
        workspace_id: normalizeWorkspaceId(args.workspace_id, id),
      };

    case 'list_entities':
    case 'list_action_items':
      return {
        workspace_id: normalizeWorkspaceId(args.workspace_id, id),
        limit: normalizeLimit(args.limit, 20, id),
      };

    default:
      throw toolNotFound(id);
  }
}

function validateMcpRequest(body) {
  const id = getRequestId(body);

  if (!isPlainObject(body)) {
    throw invalidRequest('Invalid Request: body must be a JSON object', id);
  }

  if (body.jsonrpc !== undefined && body.jsonrpc !== JSON_RPC_VERSION) {
    throw invalidRequest(`Invalid Request: jsonrpc must be ${JSON_RPC_VERSION}`, id);
  }

  if (typeof body.method !== 'string' || !body.method.trim()) {
    throw invalidRequest('Invalid Request: method must be a non-empty string', id);
  }

  switch (body.method) {
    case 'initialize':
    case 'tools/list':
      if (body.params !== undefined && !isPlainObject(body.params)) {
        throw invalidRequest('Invalid Request: params must be an object when provided', id);
      }

      return {
        id,
        method: body.method,
      };

    case 'tools/call': {
      if (!isPlainObject(body.params)) {
        throw invalidParams('Invalid params: params must be an object', id);
      }

      const toolName = typeof body.params.name === 'string' ? body.params.name.trim() : '';
      if (!toolName) {
        throw invalidParams('Invalid params: name must be a non-empty string', id);
      }

      if (!TOOL_NAMES.has(toolName)) {
        throw toolNotFound(id);
      }

      return {
        id,
        method: body.method,
        params: {
          name: toolName,
          arguments: normalizeToolArguments(toolName, body.params.arguments, id),
        },
      };
    }

    default:
      throw methodNotFound(id);
  }
}

function requireMcpAuth(req, res, next) {
  const requestKey = req.get('X-MCP-Key');

  if (!requestKey || requestKey !== MCP_API_KEY) {
    return res.status(401).json(createJsonRpcErrorResponse(-32001, 'Unauthorized', null));
  }

  return next();
}

async function createQueryEmbedding(query) {
  if (!openai) {
    throw new Error('Semantic search is unavailable');
  }

  const embeddingResponse = await openai.embeddings.create({
    model: 'text-embedding-3-large',
    input: query,
    dimensions: 3072,
  });

  return `[${embeddingResponse.data[0].embedding.join(',')}]`;
}

function buildMetadataFilterClause(filters = {}, startingIndex = 5) {
  const conditions = ['embedding IS NOT NULL', 'workspace_id = $3'];
  const values = [];
  let nextIndex = startingIndex;

  if (filters.people?.length > 0) {
    conditions.push(`EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(metadata->'extracted'->'people', '[]'::jsonb)) AS person
      WHERE LOWER(person->>'name') = ANY($${nextIndex}::text[])
    )`);
    values.push(filters.people.map((person) => person.toLowerCase()));
    nextIndex += 1;
  }

  if (filters.topics?.length > 0) {
    conditions.push(`EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(metadata->'extracted'->'topics', '[]'::jsonb)) AS topic
      WHERE LOWER(topic->>'name') = ANY($${nextIndex}::text[])
    )`);
    values.push(filters.topics.map((topic) => topic.toLowerCase()));
    nextIndex += 1;
  }

  if (filters.action_types?.length > 0) {
    conditions.push(`EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(metadata->'extracted'->'action_items', '[]'::jsonb)) AS action
      WHERE LOWER(action->>'type') = ANY($${nextIndex}::text[])
    )`);
    values.push(filters.action_types.map((actionType) => actionType.toLowerCase()));
    nextIndex += 1;
  }

  return {
    whereClause: conditions.join(' AND '),
    values,
  };
}

async function runSemanticSearch(query, limit = 10, filters = null, workspaceId = 'default') {
  const embeddingString = await createQueryEmbedding(query);
  const candidateLimit = Math.max(50, Math.min(500, limit * 8));
  const values = [embeddingString, limit, workspaceId, candidateLimit];
  let whereClause = 'embedding IS NOT NULL AND workspace_id = $3';

  if (filters) {
    const filterQuery = buildMetadataFilterClause(filters, 5);
    whereClause = filterQuery.whereClause;
    values.push(...filterQuery.values);
  }

  const result = await pool.query(
    `WITH candidates AS (
       SELECT id, tenant_id, workspace_id, content, metadata, created_at,
              1 - (embedding <=> $1::vector) AS vector_similarity
       FROM thoughts
       WHERE ${whereClause}
       ORDER BY embedding <=> $1::vector
       LIMIT $4
     ), scored AS (
       SELECT *,
              EXP(-GREATEST(EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400.0, 0) / 30.0) AS recency_weight,
              CASE WHEN metadata ? 'extracted' THEN 1.0 ELSE 0.0 END AS entity_match_bonus,
              LEAST(1.0, GREATEST(0.0, COALESCE((metadata->>'importance_score')::double precision, 0.5))) AS importance_score,
              LEAST(1.0, GREATEST(0.0, COALESCE((metadata->>'confidence_score')::double precision, 0.5))) AS confidence_score
       FROM candidates
     )
     SELECT id, tenant_id, workspace_id, content, metadata, created_at,
            vector_similarity AS similarity,
            recency_weight,
            entity_match_bonus,
            importance_score,
            confidence_score,
            (
              vector_similarity * 0.65 +
              recency_weight * 0.15 +
              entity_match_bonus * 0.10 +
              importance_score * 0.05 +
              confidence_score * 0.05
            ) AS hybrid_score
     FROM scored
     ORDER BY hybrid_score DESC, similarity DESC
     LIMIT $2`,
    values,
  );

  return result.rows;
}

async function getMetadataStats(workspaceId = 'default') {
  const statsResult = await pool.query(`
    SELECT
      COUNT(*)::int AS total_thoughts,
      COUNT(*) FILTER (WHERE metadata ? 'extracted')::int AS thoughts_with_metadata,
      COALESCE(SUM(jsonb_array_length(COALESCE(metadata->'extracted'->'people', '[]'::jsonb))), 0)::int AS total_people,
      COALESCE(SUM(jsonb_array_length(COALESCE(metadata->'extracted'->'topics', '[]'::jsonb))), 0)::int AS total_topics,
      COALESCE(SUM(jsonb_array_length(COALESCE(metadata->'extracted'->'action_items', '[]'::jsonb))), 0)::int AS total_actions
    FROM thoughts
    WHERE workspace_id = $1
  `, [workspaceId]);

  const peopleResult = await pool.query(`
    SELECT DISTINCT person->>'name' AS person
    FROM thoughts
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(metadata->'extracted'->'people', '[]'::jsonb)) AS person
    WHERE workspace_id = $1
      AND person->>'name' IS NOT NULL AND person->>'name' <> ''
    ORDER BY person
    LIMIT 20
  `, [workspaceId]);

  const topicsResult = await pool.query(`
    SELECT DISTINCT topic->>'name' AS topic
    FROM thoughts
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(metadata->'extracted'->'topics', '[]'::jsonb)) AS topic
    WHERE workspace_id = $1
      AND topic->>'name' IS NOT NULL AND topic->>'name' <> ''
    ORDER BY topic
    LIMIT 20
  `, [workspaceId]);

  const actionTypesResult = await pool.query(`
    SELECT action->>'type' AS action_type, COUNT(*)::int AS count
    FROM thoughts
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(metadata->'extracted'->'action_items', '[]'::jsonb)) AS action
    WHERE workspace_id = $1
      AND action->>'type' IS NOT NULL AND action->>'type' <> ''
    GROUP BY action->>'type'
    ORDER BY count DESC, action_type ASC
  `, [workspaceId]);

  return {
    stats: statsResult.rows[0],
    unique_people: peopleResult.rows.map((row) => row.person),
    unique_topics: topicsResult.rows.map((row) => row.topic),
    action_types: actionTypesResult.rows,
  };
}

async function listEntities(workspaceId = 'default', limit = 20) {
  const result = await pool.query(
    `SELECT e.id, e.entity_type, e.canonical_name,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT a.alias_name), NULL) AS aliases,
            e.created_at
     FROM entities e
     LEFT JOIN entity_aliases a ON a.entity_id = e.id
     WHERE e.workspace_id = $1
     GROUP BY e.id, e.entity_type, e.canonical_name, e.created_at
     ORDER BY e.created_at DESC
     LIMIT $2`,
    [workspaceId, limit],
  );

  return result.rows;
}

async function listActionItems(workspaceId = 'default', limit = 20) {
  const result = await pool.query(
    `SELECT ai.id, ai.action_type, ai.description, ai.deadline, ai.status, ai.confidence,
            e.canonical_name AS assignee,
            ai.created_at
     FROM action_items ai
     LEFT JOIN entities e ON e.id = ai.assignee_entity_id
     WHERE ai.workspace_id = $1
     ORDER BY ai.created_at DESC
     LIMIT $2`,
    [workspaceId, limit],
  );

  return result.rows;
}

async function executeTool(toolName, args) {
  switch (toolName) {
    case 'semantic_search': {
      const thoughts = await runSemanticSearch(args.query, args.limit, null, args.workspace_id);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            query: args.query,
            workspace_id: args.workspace_id,
            thoughts,
            count: thoughts.length,
          }, null, 2),
        }],
      };
    }

    case 'semantic_search_filtered': {
      const thoughts = await runSemanticSearch(args.query, args.limit, args.filters, args.workspace_id);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            query: args.query,
            workspace_id: args.workspace_id,
            filters: args.filters,
            thoughts,
            count: thoughts.length,
          }, null, 2),
        }],
      };
    }

    case 'list_recent': {
      const dbResult = await pool.query(
        'SELECT id, tenant_id, workspace_id, content, metadata, created_at FROM thoughts WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2',
        [args.workspace_id, args.limit],
      );

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            workspace_id: args.workspace_id,
            thoughts: dbResult.rows,
            count: dbResult.rows.length,
          }, null, 2),
        }],
      };
    }

    case 'get_stats': {
      const countResult = await pool.query('SELECT COUNT(*) AS count FROM thoughts WHERE workspace_id = $1', [args.workspace_id]);
      const latestResult = await pool.query(
        'SELECT created_at FROM thoughts WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 1',
        [args.workspace_id],
      );

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            workspace_id: args.workspace_id,
            total_thoughts: parseInt(countResult.rows[0].count, 10),
            latest_thought_at: latestResult.rows[0]?.created_at || null,
          }, null, 2),
        }],
      };
    }

    case 'get_metadata_stats': {
      const metadataStats = await getMetadataStats(args.workspace_id);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ workspace_id: args.workspace_id, ...metadataStats }, null, 2),
        }],
      };
    }

    case 'list_entities': {
      const entities = await listEntities(args.workspace_id, args.limit);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ workspace_id: args.workspace_id, entities, count: entities.length }, null, 2),
        }],
      };
    }

    case 'list_action_items': {
      const actionItems = await listActionItems(args.workspace_id, args.limit);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ workspace_id: args.workspace_id, action_items: actionItems, count: actionItems.length }, null, 2),
        }],
      };
    }

    default:
      throw toolNotFound();
  }
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', server: SERVER_INFO });
});

// SSE endpoint for real-time updates (optional, for future use)
app.get('/sse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Send initial server info
  res.write('event: endpoint\n');
  res.write(`data: ${JSON.stringify({ endpoint: '/mcp' })}\n\n`);

  // Keep connection alive
  const heartbeat = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
  });
});

// Main MCP endpoint
app.post('/mcp', requireMcpAuth, mcpJsonParser, async (req, res) => {
  const requestId = getRequestId(req.body);

  try {
    const request = validateMcpRequest(req.body);

    if (request.method === 'initialize') {
      return res.json({
        jsonrpc: JSON_RPC_VERSION,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: SERVER_INFO,
          capabilities: {
            tools: {},
          },
        },
        id: request.id ?? Date.now(),
      });
    }

    if (request.method === 'tools/list') {
      return res.json({
        jsonrpc: JSON_RPC_VERSION,
        result: {
          tools: TOOLS,
        },
        id: request.id ?? Date.now(),
      });
    }

    const result = await executeTool(request.params.name, request.params.arguments);

    return res.json({
      jsonrpc: JSON_RPC_VERSION,
      result,
      id: request.id ?? Date.now(),
    });
  } catch (error) {
    if (error instanceof JsonRpcError) {
      return sendJsonRpcError(res, error, requestId);
    }

    console.error('Error processing MCP request:', error);
    return sendJsonRpcError(
      res,
      new JsonRpcError({ status: 500, code: -32603, message: 'Internal error', id: requestId }),
      requestId,
    );
  }
});

app.use((error, req, res, next) => {
  if (req.path === '/mcp' && error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json(createJsonRpcErrorResponse(-32700, 'Parse error', null));
  }

  if (req.path === '/mcp') {
    console.error('Unexpected MCP middleware error:', error);
    return res.status(500).json(createJsonRpcErrorResponse(-32603, 'Internal error', null));
  }

  return next(error);
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
      retries -= 1;
      if (retries === 0) throw err;
      console.error(`Database not ready, retrying... (${retries} attempts left)`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MCP HTTP server listening on port ${PORT}`);
    console.log(`Server info: ${SERVER_INFO.name} v${SERVER_INFO.version}`);
    console.log(`Available tools: ${TOOLS.map((tool) => tool.name).join(', ')}`);
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
