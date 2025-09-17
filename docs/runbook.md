# RAG Reranker Rollout Runbook

This document describes how to promote the hybrid retrieval + reranker stack from development to production, including pre-checks, health monitoring, fallback mechanisms, and incident response.

## 1. Service Overview

Component | Endpoint | Purpose
---|---|---
Python backend | `http://<host>:8788` | Handles ingestion, retrieval, and LLM generation.
Reranker sidecar | `http://<host>:8010` | Scores candidate passages using `BAAI/bge-reranker-base`.
Confluence MCP | Configured in `.env` | Supplies content to ingest jobs.

## 2. Health & Readiness Checks

Command | Description
---|---
`curl -s http://localhost:8788/health | jq` | Verifies backend dependencies (vector store, generator, reranker).
`curl -s http://localhost:8010/healthz | jq` | Confirms reranker mode (`model` vs `heuristic`).
`tail -f logs/backend.log` | Ensure no `retrieval.vector_store.errors` or `generator.citation_fallback` spikes.
`sudo systemctl status chroma` (if managed) | Confirms Chroma availability.

The backend emits structured metrics to the log via the `cabin.metrics` logger. Example entries:
```
metric.timer {"metric_payload": {"metric": "retrieval.vector_store.query_time", ...}}
```

## 3. Feature Flag Matrix & Overrides

Feature | Env Var | Default | Notes
---|---|---|---
Reranker client | `FEATURE_RERANKER` | `true` | Disable to fall back to dense+lexical only.
RM3 expansion | `FEATURE_RM3` | `false` | Enables RM3 feedback with params in `config/app.yaml`.
Heuristic fallback | `FEATURE_HEURISTIC_FALLBACK` | `true` | Allows automatic reranker fallback when sidecar is offline.
Provenance lock | `FEATURE_RAG_PROVENANCE_LOCK` | `true` | Enforces citation verification.

To override for a session:
```bash
export FEATURE_RERANKER=false
export FEATURE_HEURISTIC_FALLBACK=false
python start.py
```

## 4. Rollout Procedure

1. **Stage on canary environment**
   - Set `CABIN_RERANKER_URL` to the staging sidecar and export feature flags (`FEATURE_RERANKER=true`, `FEATURE_RM3=false`).
   - Run `python start.py` and confirm health checks.

2. **Run evaluation harness**
   - `python -m cabin_backend.eval.eval_harness` (or import in notebook) with `EvalRunConfig(use_reranker=True)`.
   - Capture latency metrics and citation precision baseline.

3. **Enable RM3 (optional)**
   - Toggle `FEATURE_RM3=true`; re-run harness with `EvalRunConfig(use_rm3=True)` to compare results.

4. **Promote to wider audience**
   - Roll out feature flags via environment management (e.g., Kubernetes config map). Gradually increase traffic while monitoring logs for `retrieval.reranker.fallback` frequency.

5. **Enable fallback toggles**
   - Leave `FEATURE_HEURISTIC_FALLBACK=true` during ramp. If the reranker becomes unhealthy, the client drops to heuristic scoring automatically; follow up with sidecar restart.

## 5. Reindexing Canary Space

1. Export credentials for the target space in `.env`.
2. Trigger indexing:
   ```bash
   curl -X POST http://localhost:8788/api/data-sources/index \
     -H 'Content-Type: application/json' \
     -d '{
       "source_type": "confluence",
       "connection": {...},
       "source_ids": ["CANARY_SPACE"],
       "config": {}
     }'
   ```
3. Poll job status:
   ```bash
   curl http://localhost:8788/api/data-sources/jobs/<job_id> | jq
   ```
4. Verify deduplication metrics (`ingest.dedup.*` logs) and rerun the evaluation harness once ingestion completes.

## 6. Incident Response & Rollbacks

Scenario | Action
---|---
Reranker sidecar down | Set `FEATURE_RERANKER=false` (or restart sidecar). Logs will show heuristic fallback counts.
Poor citation quality | Disable RM3 (`FEATURE_RM3=false`) and rerun evaluation. Inspect `generator.citation_fallback` reasons.
Latency regression | Temporarily disable reranker and RM3, collect metrics via harness, investigate Chroma load or LM Studio latency.

Keep `docs/config_overrides.md` handy for environment-specific settings and secrets management. Document any production overrides in that file so operators know which variables diverge from defaults.

## 7. Additional Resources

- Telemetry metrics list: see `packages/backend-python/src/cabin_backend/telemetry/metrics.py` for available counters.
- Config defaults: `config/app.yaml`.
- Evaluation samples: `packages/backend-python/src/cabin_backend/eval/gold/qa_citations.yaml`.

