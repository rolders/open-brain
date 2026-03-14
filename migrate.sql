-- Migration: thoughts table parity with current bootstrap schema
-- Run this to update existing databases

ALTER TABLE thoughts
ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default',
ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'default',
ADD COLUMN IF NOT EXISTS agent_id TEXT,
ADD COLUMN IF NOT EXISTS source_type TEXT,
ADD COLUMN IF NOT EXISTS source_uri TEXT,
ADD COLUMN IF NOT EXISTS source_hash TEXT,
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
COMMENT ON COLUMN thoughts.captured_via IS 'Capture channel (api, upload, bot, ingestion-worker)';
COMMENT ON COLUMN thoughts.captured_by IS 'User or system actor that initiated capture';

CREATE INDEX IF NOT EXISTS idx_thoughts_metadata_gin ON thoughts USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_thoughts_created_at ON thoughts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_thoughts_workspace_created_at ON thoughts (workspace_id, created_at DESC);
