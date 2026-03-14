#!/bin/bash
set -euo pipefail

echo "[reindex-vectors] Skipping IVFFLAT rebuild: current embedding dimension is 3072 and IVFFLAT requires <= 2000 dimensions in this environment."
echo "[reindex-vectors] Semantic search uses two-stage candidate retrieval + hybrid reranking."

docker compose exec -T db psql -U postgres -d openbrain -c "ANALYZE thoughts;" >/dev/null

echo "[reindex-vectors] ANALYZE completed"
