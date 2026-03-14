-- Migration: Add file metadata columns to thoughts table
-- Run this to update existing databases

-- Add new columns if they don't exist
ALTER TABLE thoughts
ADD COLUMN IF NOT EXISTS original_filename TEXT,
ADD COLUMN IF NOT EXISTS file_type TEXT,
ADD COLUMN IF NOT EXISTS file_size BIGINT;

-- Add comment for documentation
COMMENT ON COLUMN thoughts.original_filename IS 'Original filename of uploaded file';
COMMENT ON COLUMN thoughts.file_type IS 'File extension (e.g., .pdf, .jpg, .txt)';
COMMENT ON COLUMN thoughts.file_size IS 'File size in bytes';
