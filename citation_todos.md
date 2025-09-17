# Citation Implementation TODOs

_Last updated: 2025-09-17_

## Global Setup
- [x] Map existing backend modules (`data_sources`, `chunker`, `vector_store`, `generation`) onto the proposed layout; add new packages or `__init__.py` only where functionality is missing.
- [x] Review `packages/backend-python/src/cabin_backend/models.py` and extend metadata/citation structures (chunk IDs, anchors, provenance payload) so they can be reused across ingestion/retrieval modules.
- [x] Extend existing `packages/backend-python/src/cabin_backend/config.py` to load `config/app.yaml`, surface feature flags, and keep `.env` overrides working.
- [ ] Update dependency manifests (`requirements.txt`, `pyproject.toml`, Dockerfiles) with chromadb, rapidfuzz, bm25s/pyserini, nltk stemmer, text-dedup/datasketch, FlagEmbedding, PyYAML (already added), etc., and refresh lockfiles/pins.
- [ ] Audit existing pipeline to ensure non-goals remain disabled: no post-gen BM25 pruning, no free-form URL citations, no secondary retrieval passes, no indexing boilerplate/macros/sidebars/footers, no Chroma ANN tuning, and no Splink/SPLADE/ColBERT pilots (verify with config and code sweeps).

## Ingestion Pipeline
- [x] Audit `packages/backend-python/src/cabin_backend/data_sources/confluence.py` (MCP client) and enhance it to cover normalization, macro/boilerplate stripping, and structured metadata (anchors handled in chunker).
- [x] Add label/metadata filtering (drop templates, archives, boilerplate) before chunking and log page-level skips.
- [x] Enhance existing `packages/backend-python/src/cabin_backend/chunker.py` to ensure heading-aware token chunking (200–300 tokens, stride 50–100), maintain `heading_path`, and derive Confluence `anchor_id` slugs.
- [x] Add `ingest/dedup.py` (or equivalent module) using MinHash/LSH (text-dedup or datasketch + xxhash) to remove near-duplicate chunks across versions/spaces with drop logs.
- [x] Wire ingestion flow to reuse `VectorStore`/lexical index for upsert+delete, enforcing versioned chunk IDs and label filters across dense + BM25 backends.
- [x] Add telemetry hooks for ingestion latency, drop counts, and retry/backoff on MCP client failures.

## Dense Embeddings & Chroma
- [x] Refactor existing `packages/backend-python/src/cabin_backend/vector_store.py` (Chroma + embeddings) into reusable modules (`dense/chroma_client.py`, `dense/embed_index.py`) without breaking current API, and layer retries/health checks.
- [x] Confirm current embedding client usage (OpenAI-compatible in `VectorStore`) and adapt it to LM Studio bge-m3 with healthcheck, batching, and L2 normalization in `dense/embed_index.py`.
- [x] Add caching layer for recent embeddings to mitigate LM Studio hiccups and expose metrics (hit rate, latency).

## Lexical Retrieval (BM25 + RM3)
- [x] Upgrade the existing BM25 implementation in `VectorStore` into `lexical/bm25_index.py` (chunk-level, with stemming/stopwords) including persistence and refresh logic.
- [x] Implement optional RM3 expansion in `lexical/rm3.py`, guarded by FEATURE_RM3 flag and configurable parameters (stub exists).
- [x] Expose combined lexical query interface returning scored candidates with metadata aligned to dense IDs.

## Retrieval Orchestration
- [x] Implement `retriever/fusion.py` to combine existing dense+lexical scores via RRF (configurable `rrf_k`) targeting ~100 candidates.
- [x] Implement hygiene filters (labels, cosine floor, keyword overlap, content_type exceptions) in `retriever/hygiene.py` with instrumentation for drop reasons.
- [x] Add MMR diversification (λ=0.5) to final candidate set and expose tuning hooks for evaluation runs.

## Reranker Sidecar Service
- [x] Scaffold `services/reranker/app.py` FastAPI service providing `/healthz` and `/rerank` endpoints using BAAI/bge-reranker-base (FP16 on CUDA) with batching + truncation rules, reusing any existing FastAPI utilities if available.
- [x] Author Dockerfile for sidecar (CUDA runtime, torch, FlagEmbedding, uvicorn) plus compose/K8s manifests and resource limits.
- [x] Implement client adapter `retriever/reranker_client.py` with timeout handling, retries, and fallback to heuristic reranker when sidecar unavailable.
- [x] Add heuristic proximity/overlap reranker in-core as fallback path with feature flag gating.
- [x] Integrate reranker step after fusion/MMR to produce top 6–8 passages and persist provenance map.

## Provenance Lock, Prompting, Generation
- [x] Extend `packages/backend-python/src/cabin_backend/generation.py` to support provenance lock `[1..N] → chunk_id`, numbered context blocks, and SOURCE footers.
- [x] Extract prompt templates from the current generator into `generation/prompt_templates.py`, enforcing citation/quote rules while keeping existing LLM invocation compatible.
- [x] Add post-generation enforcement in `packages/backend-python/src/cabin_backend/generation.py` limiting citations to ≤3, removing free-form URLs, and emitting "Not found" when unsupported.

## Citation Verification & Rendering
- [x] Implement `citations/verify.py` using substring + RapidFuzz partial ratio (≥90) with swap-to-best logic and telemetry for pass/fail outcomes.
- [x] Implement `citations/render.py` to expand `[i]` references into {title, url#anchor, 10–15 word quote, space, page_version} structures for UI/API.
- [x] Ensure verification failures trigger fallback messaging or heuristic rerank retries per spec and document behavior.

## Telemetry & Metrics
- [x] Implement `telemetry/logger.py` and `telemetry/metrics.py` capturing per-stage latencies, candidate ID lists, reranker results, verification outcomes, feature flags, and dedup statistics, integrating with existing logging where possible.
- [ ] Integrate telemetry with existing logging/metrics stack (e.g., OpenTelemetry/Prometheus) and add dashboards for KPIs (citation precision, latency, "Not found" accuracy).

## Evaluation Harness
- [x] Build `eval/eval_harness.py` to run gold QA set through pipeline, compute citation precision, answerability, and latency metrics, and export CSV/JSON summaries.
- [x] Create `eval/gold/qa_citations.yaml` template with representative questions, expected anchors, and quotes.
- [x] Implement ablation toggles (reranker off, RM3 on/off, heuristic fallback) for comparative experiments and track results.

## Configuration & Feature Flags
- [x] Materialize `config/app.yaml` with defaults from spec and hook it into the extended config loader.
- [x] Ensure feature flags (FEATURE_RAG_PROVENANCE_LOCK, FEATURE_RERANKER, FEATURE_RM3, FEATURE_HEURISTIC_FALLBACK) gate behavior at runtime with dynamic reload support if needed.
- [x] Document configuration overrides for environments (dev, staging, prod) and ensure secrets (.env) updated accordingly.

## Security & Reliability
- [x] Sanitize and size-limit ingestion inputs; strip scripts/HTML and validate anchors before indexing.
- [x] Add auth or network ACL options for reranker sidecar plus rate limiting and circuit breaker to heuristic fallback.
- [x] Ensure PII-safe logging (hash user IDs, exclude sensitive page content) and review for compliance.

## Rollout & Operations
- [x] Remove deprecated post-generation BM25 validation and free-URL rendering paths (flagged for deletion) once new pipeline ready.
- [ ] Reindex canary Confluence space with updated ingestion+dedup path; monitor metrics and validate anchors.
- [x] Gradually enable hybrid retrieval + reranker via feature flags (canary → global) with rollback instructions.
- [ ] Tune cosine floor, keyword gate, MMR λ using eval harness results before full rollout.
- [x] Produce runbook covering sidecar health checks, failure modes, fallback toggles, and incident response steps.

## Acceptance Criteria & Validation
- [x] Verify citation provenance lock prevents out-of-set sources; add tests covering candidate freeze behavior.
- [x] Confirm quote verification enforces ≤12 word snippets and >=90 similarity across evaluation set.
- [ ] Measure latency end-to-end (median ≤2.5s) under load with reranker enabled and heuristic fallback.
- [ ] Validate dedup removes ≥90% near duplicates on canary data and log results.



## Documentation & Knowledge Transfer
- [x] Update `HANDOVER.md` or new docs with architecture diagrams, pipeline flow, and module responsibilities.
- [x] Document feature flag matrix, config parameters, and tuning guidelines for future adjustments.
