CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE thoughts (
    id SERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    workspace_id TEXT NOT NULL DEFAULT 'default',
    agent_id TEXT,
    source_type TEXT,
    source_uri TEXT,
    source_hash TEXT,
    captured_via TEXT,
    captured_by TEXT,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    embedding vector(3072),
    original_filename TEXT,
    file_type TEXT,
    file_size BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_thoughts_created_at ON thoughts (created_at DESC);
CREATE INDEX idx_thoughts_metadata_gin ON thoughts USING GIN (metadata);
CREATE INDEX idx_thoughts_workspace_created_at ON thoughts (workspace_id, created_at DESC);

-- Note: HNSW index is not supported for 3072-dimension vectors in this setup.
-- Semantic search uses a sequential cosine-distance scan.

-- Template placeholders are rendered into .generated/init.sql by ./setup.sh.
CREATE USER brain_writer WITH PASSWORD '__BRAIN_WRITER_PASSWORD__';
CREATE USER brain_reader WITH PASSWORD '__BRAIN_READER_PASSWORD__';

GRANT INSERT, SELECT ON thoughts TO brain_writer;
GRANT USAGE, SELECT ON SEQUENCE thoughts_id_seq TO brain_writer;
GRANT SELECT ON thoughts TO brain_reader;
