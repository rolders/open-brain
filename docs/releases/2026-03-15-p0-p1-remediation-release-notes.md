# Release Notes — P0/P1 Remediation

**Date:** 2026-03-15  
**Branch:** `main`

This release implements the full P0/P1 remediation backlog focused on safety, reproducibility, ingestion scalability, and retrieval quality.

## Highlights

### P0 foundation
- **Namespace + provenance fields** added to memory rows:
  - `tenant_id`, `workspace_id`, `agent_id`
  - `source_type`, `source_uri`, `source_hash`
  - `captured_via`, `captured_by`
- **Workspace-scoped reads** added to MCP search/list/stats tools.
- **Secret rotation automation** added via `scripts/rotate-secrets.sh` (dry-run + restart flow).
- **Docker image pinning** enforced in compose and validation checks.

### P1 ingestion pipeline
- **Baseline indexes** now included in bootstrap/migration.
- **Idempotent ingestion** implemented with deterministic hashes (`content_hash`, `source_hash`) and dedupe behavior.
- **Async ingestion jobs** added with `ingestion_jobs` table, worker service, and job status/retry endpoints.
- **Chunked document ingestion** added with parent/chunk metadata:
  - `parent_document_id`, `chunk_index`, `token_count`, `heading_path`

### P1 data model
- **Normalized schema** added:
  - `memory_items`, `entities`, `entity_aliases`, `memory_entity_links`, `action_items`
- **Canonical entity resolution** implemented via alias normalization.
- New MCP tools expose normalized data:
  - `list_entities`
  - `list_action_items`

### P1 retrieval quality/scalability
- **Two-stage semantic retrieval** implemented (candidate retrieval + reranking).
- **Hybrid ranking** implemented with explainable score components:
  - vector similarity
  - recency weight
  - entity bonus
  - importance/confidence scores

## Operational updates
- Added docs:
  - `docs/architecture/p0-p1-data-model.md`
  - `docs/operations/secret-rotation.md`
- Added scripts:
  - `scripts/rotate-secrets.sh`
  - `scripts/reindex-vectors.sh`

## Verification summary
- `./validate.sh` passes
- `./test.sh` passes end-to-end
- Migration applied successfully to running database via `migrate.sql`
- Core services rebuilt/restarted successfully (`db`, `capture-api`, `ingestion-worker`, `mcp-server`, `mcp-server-http`, `caddy`)

## Notes
- Current pinned DB image is `ankane/pgvector:v0.5.1` in `docker-compose.yml`.
- ANN index creation is environment-constrained for current 3072-d embeddings; system uses two-stage retrieval + hybrid reranking path.
