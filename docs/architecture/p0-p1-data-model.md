# P0/P1 Data Model Notes

## Namespace and provenance additions

`thoughts` now includes namespace and provenance fields:

- `tenant_id` (default: `default`)
- `workspace_id` (default: `default`)
- `agent_id`
- `source_type`
- `source_uri`
- `source_hash`
- `content_hash`
- `captured_via`
- `captured_by`

These fields are backward compatible for existing rows through defaults and nullable columns.

## MCP workspace scoping

The MCP tools now accept optional `workspace_id` arguments and scope reads to that workspace:

- `semantic_search`
- `semantic_search_filtered`
- `list_recent`
- `get_stats`
- `get_metadata_stats`

If omitted, `workspace_id` defaults to `default`.

## Indexing

Added/ensured indexes:

- `idx_thoughts_created_at`
- `idx_thoughts_metadata_gin`
- `idx_thoughts_workspace_created_at`
