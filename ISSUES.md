# Open Brain – Technical Improvement Backlog

This document contains a prioritized set of architectural, performance, and reliability improvements identified during technical review.

Priority levels:
- **P0** – Foundation / safety / correctness
- **P1** – Core scalability and architecture improvements
- **P2** – Developer experience, security hardening, and API quality
- **P3** – Observability, documentation, and long-term maintainability

Status legend:
- ✅ **Done**
- 🔄 **Partial / constrained**
- ⏳ **Open**

Last updated: **2026-03-15**

---

## Current status snapshot

- **P0:** ✅ Completed
- **P1:** ✅ Completed with one environment constraint noted under ANN indexing
- **P2:** ⏳ Not started
- **P3:** ⏳ Not started

Related implementation and docs:
- `docs/releases/2026-03-15-p0-p1-remediation-release-notes.md`
- `docs/architecture/p0-p1-data-model.md`
- `docs/operations/secret-rotation.md`

---

# P0 — Foundation

## Issue: Add namespace and provenance fields to memory model

**Status:** ✅ Done (2026-03-15)

### Implemented
- Added fields on memory rows:
  - `tenant_id`, `workspace_id`, `agent_id`
  - `source_type`, `source_uri`, `source_hash`
  - `captured_via`, `captured_by`
- Capture API supports namespace/provenance writes with safe defaults.
- MCP queries support `workspace_id` filtering.
- Existing rows remain compatible through defaults/null-safe behavior.

Labels: schema, architecture, priority:P0

---

## Issue: Pin Docker image versions

**Status:** ✅ Done (2026-03-15)

### Implemented
- Compose now uses pinned tags (no `:latest`).
- Validation checks enforce no floating tags for core images.
- README updated with version policy and upgrade guidance.

### Note
- Current pinned DB image is `ankane/pgvector:v0.5.1` in this repo, with `caddy:2.7.6`.

Labels: devops, reliability, priority:P0

---

## Issue: Add secret rotation script

**Status:** ✅ Done (2026-03-15)

### Implemented
- Added `scripts/rotate-secrets.sh`.
- Supports dry-run and operational rotation flow.
- Updates `.env`, applies role password updates, and supports service restart flow.
- Added operator runbook: `docs/operations/secret-rotation.md`.

Labels: security, ops, priority:P0

---

# P1 — Performance & Core Architecture

## Issue: Add metadata and timestamp indexes

**Status:** ✅ Done (2026-03-15)

### Implemented
- Added baseline indexes to bootstrap + migration paths:
  - `idx_thoughts_created_at`
  - `idx_thoughts_metadata`
- Additional scoped indexes added for workspace/hash/chunk access patterns.

Labels: performance, database, priority:P1

---

## Issue: Replace sequential vector scan

**Status:** 🔄 Partial / constrained (2026-03-15)

### Implemented
- Added two-stage retrieval pipeline (candidate retrieval + reranking).
- Added retrieval maintenance script: `scripts/reindex-vectors.sh`.

### Constraint
- ANN index (`ivfflat`) is currently constrained in this environment for 3072-d embeddings, so runtime relies on the two-stage/hybrid pipeline without ivfflat index creation.

Labels: search, performance, priority:P1

---

## Issue: Implement hybrid ranking

**Status:** ✅ Done (2026-03-15)

### Implemented
- Ranking now blends:
  - `vector_similarity`
  - `recency_weight`
  - `entity_match_bonus`
  - `importance_score`
  - `confidence_score`
- Score components are returned for explainability/tuning.

Labels: search, ranking, priority:P1

---

# P1 — Ingestion Pipeline

## Issue: Introduce asynchronous ingestion jobs

**Status:** ✅ Done (2026-03-15)

### Implemented
- Added `ingestion_jobs` table.
- Upload flow now enqueues async jobs.
- Added ingestion worker service and job status/retry handling.

Labels: ingestion, backend, priority:P1

---

## Issue: Implement document chunking

**Status:** ✅ Done (2026-03-15)

### Implemented
- Added chunk metadata fields:
  - `parent_document_id`
  - `chunk_index`
  - `token_count`
  - `heading_path`
- Worker stores documents as ordered chunks for better retrieval quality.

Labels: ingestion, search, priority:P1

---

## Issue: Add idempotent ingestion using hashes

**Status:** ✅ Done (2026-03-15)

### Implemented
- Added deterministic hashes:
  - `content_hash`
  - `source_hash`
- Added dedupe behavior and hash indexes.
- Repeated ingestion in same workspace returns deduplicated result.

Labels: data-quality, ingestion, priority:P1

---

# P1 — Memory Model Improvements

## Issue: Separate raw memory from entities and actions

**Status:** ✅ Done (2026-03-15)

### Implemented schema
- `memory_items`
- `entities`
- `memory_entity_links`
- `action_items`

### Implemented behavior
- Normalized writes are performed alongside raw thoughts.
- Entities/actions are queryable independently.

Labels: schema, memory-model, priority:P1

---

## Issue: Implement canonical entity resolution

**Status:** ✅ Done (2026-03-15)

### Implemented
- Added `entity_aliases` and canonical-name resolution.
- MCP exposes normalized tools for entity and action retrieval.

Labels: search, memory-model, priority:P1

---

# P2 — MCP & API Improvements

## Issue: Add scoped MCP tools

**Status:** ⏳ Open

Examples:
- `get_entity_context`
- `get_open_actions`
- `get_project_memory`
- `summarize_recent_changes`
- `search_by_source`

Labels: mcp, ux, priority:P2

---

## Issue: Improve MCP response format

**Status:** ⏳ Open

Planned structured fields:
- `match_reason`
- `similarity_score`
- `matched_entities`
- `source_summary`

Labels: mcp, search, priority:P2

---

## Issue: Add cursor-based pagination

**Status:** ⏳ Open

### Acceptance Criteria
- Large result sets paginated efficiently

Labels: api, mcp, priority:P2

---

# P2 — Security & Resilience

## Issue: Add rate limiting and request size limits

**Status:** ⏳ Open

### Acceptance Criteria
- Oversized requests rejected
- System resists abuse

Labels: security, api, priority:P2

---

## Issue: Add audit logging

**Status:** ⏳ Open

Audit fields:
- `timestamp`
- `operation`
- `source`
- `agent`

Labels: security, ops, priority:P2

---

## Issue: Implement backup/export/import tooling

**Status:** ⏳ Open

CLI commands:
- `openbrain export`
- `openbrain import`
- `openbrain backup`

Labels: portability, ops, priority:P2

---

# P3 — Quality & Maintainability

## Issue: Expand automated test coverage

**Status:** ⏳ Open

Add tests for:
- migrations
- duplicate ingestion
- chunking correctness
- namespace isolation
- ranking regressions

Labels: tests, quality, priority:P3

---

## Issue: Add observability metrics

**Status:** ⏳ Open

Metrics:
- request latency
- DB query timing
- ingestion job duration
- embedding failures

Labels: observability, ops, priority:P3

---

## Issue: Document MCP compatibility matrix

**Status:** ⏳ Open

Document supported modes:
- stdio MCP
- HTTP MCP

Labels: docs, mcp, priority:P3

---

# Suggested implementation order (remaining)

1. Scoped MCP tool expansion
2. MCP response format improvements
3. Cursor-based pagination
4. Rate limiting + request-size limits
5. Audit logging
6. Export/import/backup tooling
7. Test coverage expansion
8. Observability metrics
9. MCP compatibility matrix documentation
