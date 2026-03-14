
# Open Brain – Technical Improvement Backlog

This document contains a prioritized set of architectural, performance, and reliability improvements identified during a technical review of the repository.

Priority levels:
- **P0** – Foundation / safety / correctness
- **P1** – Core scalability and architecture improvements
- **P2** – Developer experience, security hardening, and API quality
- **P3** – Observability, documentation, and long-term maintainability

---

# P0 — Foundation

## Issue: Add namespace and provenance fields to memory model

### Problem
The current schema stores all entries in a single `thoughts` table without namespaces such as user, workspace, or agent identifiers.

### Proposed Solution
Add the following fields:

tenant_id  
workspace_id  
agent_id  
source_type  
source_uri  
source_hash  
captured_via  
captured_by

### Acceptance Criteria
- Memory inserts support workspace and agent scoping
- MCP queries can filter by workspace
- Existing rows remain compatible

Labels: schema, architecture, priority:P0

---

## Issue: Pin Docker image versions

### Problem
The project uses floating Docker tags such as `ankane/pgvector:latest` and `caddy:latest`, which can break reproducibility.

### Proposed Solution
Pin exact versions in docker-compose:

ankane/pgvector:0.7.0  
caddy:2.7.6

### Acceptance Criteria
- Docker builds become reproducible
- Versions documented in README

Labels: devops, reliability, priority:P0

---

## Issue: Add secret rotation script

### Problem
Database credentials are injected only during initial bootstrap.

### Proposed Solution
Add helper script:

scripts/rotate-secrets.sh

Responsibilities:
- Generate new credentials
- Update `.env`
- Apply `ALTER ROLE` commands
- Restart services safely

### Acceptance Criteria
- Secrets can be rotated without manual SQL editing

Labels: security, ops, priority:P0

---

# P1 — Performance & Core Architecture

## Issue: Add metadata and timestamp indexes

### Problem
Baseline indexes are not created during initial schema bootstrap.

### Proposed Solution

CREATE INDEX idx_thoughts_created_at ON thoughts (created_at DESC);
CREATE INDEX idx_thoughts_metadata ON thoughts USING GIN (metadata);

### Acceptance Criteria
- Fresh installs include indexes automatically

Labels: performance, database, priority:P1

---

## Issue: Replace sequential vector scan

### Problem
Semantic search currently performs sequential cosine scans on embeddings.

### Proposed Solution
Implement indexed ANN search or a two-stage retrieval pipeline.

candidate selection → vector index  
reranking → full similarity

### Acceptance Criteria
- Search latency remains acceptable with large datasets

Labels: search, performance, priority:P1

---

## Issue: Implement hybrid ranking

### Problem
Results are ranked only by vector similarity.

### Proposed Solution
Combine ranking factors:

vector_similarity  
recency_weight  
entity_match_bonus  
importance_score  
confidence_score

### Acceptance Criteria
- Search relevance improves measurably

Labels: search, ranking, priority:P1

---

# P1 — Ingestion Pipeline

## Issue: Introduce asynchronous ingestion jobs

### Problem
File ingestion currently appears synchronous.

### Proposed Solution
Create ingestion pipeline:

upload → job creation → worker processing

New table:

ingestion_jobs

Worker handles:
- parsing
- chunking
- embedding
- metadata extraction

### Acceptance Criteria
- Upload returns job ID immediately
- Failed jobs can be retried

Labels: ingestion, backend, priority:P1

---

## Issue: Implement document chunking

### Problem
Large documents stored as single entries reduce retrieval quality.

### Proposed Solution

parent_document_id  
chunk_index  
token_count  
heading_path

### Acceptance Criteria
- Documents stored as searchable chunks

Labels: ingestion, search, priority:P1

---

## Issue: Add idempotent ingestion using hashes

### Problem
Repeated uploads may create duplicate records.

### Proposed Solution

content_hash  
source_hash

### Acceptance Criteria
- Duplicate ingestion prevented

Labels: data-quality, ingestion, priority:P1

---

# P1 — Memory Model Improvements

## Issue: Separate raw memory from entities and actions

### Proposed Schema

memory_items  
entities  
memory_entity_links  
action_items

### Acceptance Criteria
- Entities and actions are queryable independently

Labels: schema, memory-model, priority:P1

---

## Issue: Implement canonical entity resolution

### Problem
JSON string matching causes alias fragmentation.

### Proposed Solution

entities  
entity_aliases

### Acceptance Criteria
- Alias names resolve to canonical entities

Labels: search, memory-model, priority:P1

---

# P2 — MCP & API Improvements

## Issue: Add scoped MCP tools

Examples:

get_entity_context  
get_open_actions  
get_project_memory  
summarize_recent_changes  
search_by_source

Labels: mcp, ux, priority:P2

---

## Issue: Improve MCP response format

Add structured fields:

match_reason  
similarity_score  
matched_entities  
source_summary

Labels: mcp, search, priority:P2

---

## Issue: Add cursor-based pagination

### Acceptance Criteria
- Large result sets paginated efficiently

Labels: api, mcp, priority:P2

---

# P2 — Security & Resilience

## Issue: Add rate limiting and request size limits

### Acceptance Criteria
- Oversized requests rejected
- System resists abuse

Labels: security, api, priority:P2

---

## Issue: Add audit logging

Audit fields:

timestamp  
operation  
source  
agent

Labels: security, ops, priority:P2

---

## Issue: Implement backup/export/import tooling

CLI commands:

openbrain export  
openbrain import  
openbrain backup

Labels: portability, ops, priority:P2

---

# P3 — Quality & Maintainability

## Issue: Expand automated test coverage

Add tests for:
- migrations
- duplicate ingestion
- chunking correctness
- namespace isolation
- ranking regressions

Labels: tests, quality, priority:P3

---

## Issue: Add observability metrics

Metrics:

request latency  
DB query timing  
ingestion job duration  
embedding failures

Labels: observability, ops, priority:P3

---

## Issue: Document MCP compatibility matrix

Document supported modes:

stdio MCP  
HTTP MCP

Labels: docs, mcp, priority:P3

---

# Suggested Implementation Order

1. Namespace fields
2. Docker version pinning
3. Secret rotation tooling
4. Default indexes
5. Async ingestion jobs
6. Document chunking
7. Idempotent ingestion
8. ANN vector search
9. Hybrid ranking
10. Provenance fields
11. Entity normalization
12. Schema separation
13. MCP tool improvements
14. Pagination
15. Rate limiting
16. Audit logging
17. Export/import
18. Test expansion
19. Observability
20. Compatibility documentation
