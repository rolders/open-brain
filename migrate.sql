-- Migration: thoughts table parity with current bootstrap schema
-- Run this to update existing databases

ALTER TABLE thoughts
ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default',
ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'default',
ADD COLUMN IF NOT EXISTS agent_id TEXT,
ADD COLUMN IF NOT EXISTS source_type TEXT,
ADD COLUMN IF NOT EXISTS source_uri TEXT,
ADD COLUMN IF NOT EXISTS source_hash TEXT,
ADD COLUMN IF NOT EXISTS content_hash TEXT,
ADD COLUMN IF NOT EXISTS parent_document_id BIGINT,
ADD COLUMN IF NOT EXISTS chunk_index INTEGER,
ADD COLUMN IF NOT EXISTS token_count INTEGER,
ADD COLUMN IF NOT EXISTS heading_path TEXT,
ADD COLUMN IF NOT EXISTS captured_via TEXT,
ADD COLUMN IF NOT EXISTS captured_by TEXT,
ADD COLUMN IF NOT EXISTS original_filename TEXT,
ADD COLUMN IF NOT EXISTS file_type TEXT,
ADD COLUMN IF NOT EXISTS file_size BIGINT;

COMMENT ON COLUMN thoughts.original_filename IS 'Original filename of uploaded file';
COMMENT ON COLUMN thoughts.file_type IS 'File extension (e.g., .pdf, .jpg, .txt)';
COMMENT ON COLUMN thoughts.file_size IS 'File size in bytes';
COMMENT ON COLUMN thoughts.tenant_id IS 'Top-level tenant namespace';
COMMENT ON COLUMN thoughts.workspace_id IS 'Workspace namespace used for MCP query scoping';
COMMENT ON COLUMN thoughts.agent_id IS 'Agent identifier that produced the memory item';
COMMENT ON COLUMN thoughts.source_type IS 'Capture source type (manual, upload, telegram, etc.)';
COMMENT ON COLUMN thoughts.source_uri IS 'Source URI or external reference';
COMMENT ON COLUMN thoughts.source_hash IS 'Deterministic hash for source provenance';
COMMENT ON COLUMN thoughts.content_hash IS 'Deterministic hash for normalized content deduplication';
COMMENT ON COLUMN thoughts.parent_document_id IS 'Root document row id for chunked ingestion';
COMMENT ON COLUMN thoughts.chunk_index IS 'Chunk ordering within a parent document';
COMMENT ON COLUMN thoughts.token_count IS 'Approximate token count for this chunk';
COMMENT ON COLUMN thoughts.heading_path IS 'Heading path context for chunked content';
COMMENT ON COLUMN thoughts.captured_via IS 'Capture channel (api, upload, bot, ingestion-worker)';
COMMENT ON COLUMN thoughts.captured_by IS 'User or system actor that initiated capture';

CREATE INDEX IF NOT EXISTS idx_thoughts_metadata ON thoughts USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_thoughts_created_at ON thoughts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_thoughts_workspace_created_at ON thoughts (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_thoughts_workspace_source_hash ON thoughts (workspace_id, source_hash);
CREATE INDEX IF NOT EXISTS idx_thoughts_workspace_content_hash ON thoughts (workspace_id, content_hash);
CREATE INDEX IF NOT EXISTS idx_thoughts_parent_document_id ON thoughts (parent_document_id, chunk_index);

CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  status TEXT NOT NULL DEFAULT 'queued',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  payload JSONB NOT NULL,
  result JSONB DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status_created_at ON ingestion_jobs (status, created_at);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_workspace_created_at ON ingestion_jobs (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS memory_items (
  id BIGSERIAL PRIMARY KEY,
  thought_id INTEGER NOT NULL UNIQUE REFERENCES thoughts(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  workspace_id TEXT NOT NULL DEFAULT 'default',
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS entities (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  workspace_id TEXT NOT NULL DEFAULT 'default',
  entity_type TEXT NOT NULL DEFAULT 'person',
  canonical_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, entity_type, normalized_name)
);

CREATE TABLE IF NOT EXISTS entity_aliases (
  id BIGSERIAL PRIMARY KEY,
  entity_id BIGINT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  alias_name TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, normalized_alias)
);

CREATE TABLE IF NOT EXISTS memory_entity_links (
  memory_item_id BIGINT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
  entity_id BIGINT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL DEFAULT 'mentioned',
  confidence DOUBLE PRECISION,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (memory_item_id, entity_id, relation_type)
);

CREATE TABLE IF NOT EXISTS action_items (
  id BIGSERIAL PRIMARY KEY,
  memory_item_id BIGINT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  workspace_id TEXT NOT NULL DEFAULT 'default',
  action_type TEXT NOT NULL,
  description TEXT NOT NULL,
  assignee_entity_id BIGINT REFERENCES entities(id) ON DELETE SET NULL,
  deadline TEXT,
  status TEXT,
  confidence DOUBLE PRECISION,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (memory_item_id, action_type, description)
);

CREATE INDEX IF NOT EXISTS idx_memory_items_workspace_created_at ON memory_items (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entities_workspace_type_name ON entities (workspace_id, entity_type, normalized_name);
CREATE INDEX IF NOT EXISTS idx_entity_aliases_workspace_alias ON entity_aliases (workspace_id, normalized_alias);
CREATE INDEX IF NOT EXISTS idx_action_items_workspace_created_at ON action_items (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_items_status ON action_items (workspace_id, status);

GRANT INSERT, SELECT, UPDATE ON thoughts TO brain_writer;
GRANT INSERT, SELECT, UPDATE ON ingestion_jobs TO brain_writer;
GRANT INSERT, SELECT, UPDATE ON memory_items TO brain_writer;
GRANT INSERT, SELECT, UPDATE ON entities TO brain_writer;
GRANT INSERT, SELECT, UPDATE ON entity_aliases TO brain_writer;
GRANT INSERT, SELECT, UPDATE ON memory_entity_links TO brain_writer;
GRANT INSERT, SELECT, UPDATE ON action_items TO brain_writer;
GRANT USAGE, SELECT ON SEQUENCE ingestion_jobs_id_seq TO brain_writer;
GRANT USAGE, SELECT ON SEQUENCE memory_items_id_seq TO brain_writer;
GRANT USAGE, SELECT ON SEQUENCE entities_id_seq TO brain_writer;
GRANT USAGE, SELECT ON SEQUENCE entity_aliases_id_seq TO brain_writer;
GRANT USAGE, SELECT ON SEQUENCE action_items_id_seq TO brain_writer;

GRANT SELECT ON memory_items TO brain_reader;
GRANT SELECT ON entities TO brain_reader;
GRANT SELECT ON entity_aliases TO brain_reader;
GRANT SELECT ON memory_entity_links TO brain_reader;
GRANT SELECT ON action_items TO brain_reader;
