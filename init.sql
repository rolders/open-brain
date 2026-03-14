CREATE EXTENSION IF NOT EXISTS vector;

-- Create the thoughts table
CREATE TABLE thoughts (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    embedding vector(3072), -- Optimized for OpenAI text-embedding-3-large
    original_filename TEXT,
    file_type TEXT,
    file_size BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Note: HNSW index not supported for >2000 dimensions (text-embedding-3-large has 3072)
-- Semantic search will use sequential scan with cosine distance (<=> operator)

-- Security: Principle of Least Privilege
CREATE USER brain_writer WITH PASSWORD '80571a37c639722957b31c991b7410c85f2a80a90bfef909366349cfdf36ce1d';
CREATE USER brain_reader WITH PASSWORD '80571a37c639722957b31c991b7410c85f2a80a90bfef909366349cfdf36ce1d';

GRANT INSERT, SELECT ON thoughts TO brain_writer;
GRANT USAGE, SELECT ON SEQUENCE thoughts_id_seq TO brain_writer;
GRANT SELECT ON thoughts TO brain_reader;
