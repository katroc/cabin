Implementation Plan — Confluence → (Chunk → Embed → Retrieve → Rerank) → Provenance-Locked Citations

(LM Studio for embeddings, Chroma, BM25, RRF/MMR, GPU sidecar cross-encoder reranker, quote verification, anchors)

0) Scope & Non-Goals

In scope: ingestion, chunking, dedup, embeddings, BM25, hybrid retrieval, RRF/MMR, GPU sidecar cross-encoder reranker, provenance lock, structured prompting, quote verification, rendering, telemetry, eval harness, rollout & flags.

Explicitly remove/avoid:

Post-generation BM25 “validation” that prunes sources after the LLM answers.

Any free-form URL citation rendering (LLM must cite by index).

Any second retrieval pass during/after generation.

Indexing boilerplate/macros/sidebars/footers.

Chroma ANN tuning (it’s Docker-managed).

Splink / record-linkage (not relevant to chunk-level RAG).

(Optional pilots like SPLADE/ColBERT remain out for now).

1) High-Level Architecture
Confluence MCP
   │
   ├─ Fetch pages → Normalize → Strip macros/boilerplate
   ├─ Structure-aware chunking (200–300 tok, stride 50–100)
   ├─ Dedup near-duplicates (MinHash/LSH)
   └─ Upsert + delete old versions
        │
        ├─ Embeddings (LM Studio: bge-m3) → Chroma (cosine)
        └─ BM25 (Python) over same chunk IDs
Query
   │
   ├─ Dense topK (Chroma) + BM25 topK  → RRF fuse → Hygiene filters → MMR diversify (set C≈100)
   ├─ **Sidecar GPU Reranker** (bge-reranker-base) → Top 6–8
   ├─ Provenance lock (freeze [1..N] ↔ chunk_id map)
   ├─ LLM generation (must cite by index + direct quotes)
   ├─ Quote verification (substring / fuzzy)
   └─ Render citations (url#anchor + 10–15 word quote)

2) Repos & Directory Layout (suggested)
/ingest/
  mcp_confluence_ingestor.py
  chunker.py
  dedup.py
  schema.py

/dense/
  chroma_client.py
  embed_index.py   # LM Studio embeddings client + upsert/delete

/lexical/
  bm25_index.py    # bm25s or pyserini; chunk-level index
  rm3.py           # optional (feature-flag)

/retriever/
  fusion.py        # RRF + MMR
  hygiene.py       # cosine floor, labels filter, keyword gate
  reranker_client.py

/services/reranker/
  app.py           # FastAPI sidecar (FlagEmbedding / PyTorch)
  Dockerfile

/generation/
  prompt_templates.py
  generator.py     # provenance-lock, numbered context

/citations/
  verify.py        # rapidfuzz checks / swap-from-C if needed
  render.py        # expand [i] → url#anchor + snippet

/eval/
  eval_harness.py
  gold/qa_citations.yaml

/telemetry/
  logger.py
  metrics.py

/config/
  app.yaml

3) Data & Metadata Model

Chunk ID: "{page_id}:{page_version}:{chunk_idx}"

Chunk record (stored with vector + in BM25):

{
  "id": "12345:17:08",
  "text": "...chunk text...",
  "meta": {
    "page_id": 12345,
    "page_version": 17,
    "space": "ENG",
    "title": "Install → Linux → Arch",
    "heading_path": ["Install","Linux","Arch"],
    "anchor_id": "Install-Linux-Arch",
    "url": "https://confluence/.../PAGEKEY#Install-Linux-Arch",
    "labels": ["install","linux"],
    "content_type": "paragraph",     // paragraph|table|code|list
    "is_boilerplate": false,
    "updated_at": "2025-08-21T10:22:00Z"
  }
}


Citation payload (render-time only, not LLM-emitted):

{
  "index": 2,
  "chunk_id": "12345:17:08",
  "title": "Install → Linux → Arch",
  "url": "https://...#Install-Linux-Arch",
  "quote": "exact 10–15 word snippet from the passage",
  "space": "ENG",
  "page_version": 17
}

4) Ingestion Pipeline
4.1 Fetch & Normalize (Confluence MCP)

Pull page HTML/semantic JSON.

Strip: sidebars, headers/footers, “Children Display”, “Page Properties (Report)”, nav macros.

Convert to normalized markdown/plaintext preserving heading levels.

4.2 Structure-Aware Chunking

Segment by H1>H2>H3 headings; maintain heading_path.

Tokenize; emit chunks of 200–300 tokens, stride 50–100 (for retrieval).

Cite the center chunk only (store window neighbors only for context, not for citation).

Extract anchor_id (Confluence heading slug) for each chunk’s section.

4.3 Dedup (torch-free)

Use text-dedup or datasketch MinHash/LSH across:

Within page (repeated blocks), across versions, across spaces.

Drop chunk if Jaccard ≥ 0.92 vs a newer equivalent; keep newest page_version.

Log drops with (old_id → kept_id) mapping.

4.4 Versioning & Index Hygiene

Upsert new version chunk IDs into Chroma + BM25.

Delete old version chunk IDs on page update.

Filter out labels in {template, archive, index} or is_boilerplate=true.

5) Embeddings & Indexing
5.1 LM Studio (Embeddings)

Host bge-m3; use correct query/doc prompts; normalize embeddings (L2).

Client: retry w/ backoff, simple healthcheck.

5.2 Chroma

Store vectors per chunk with id and meta.

Use cosine similarity (with normalized vectors).

6) Lexical Retrieval (BM25; RM3 optional)

Build BM25 index at chunk level (same IDs).

Tokenization with stemming and stopword removal (e.g., NLTK Snowball).

Optional: RM3 (Pyserini) for lexical query expansion behind flag.

7) Retrieval Orchestration
7.1 Candidate Gathering

Dense: k_dense=80 from Chroma (docs, metas, distances).

Lexical: k_bm25=80 (optionally RM3).

RRF fuse the ranked ID lists (dense + lexical) → fused set ~100.

Hygiene filters:

Drop is_boilerplate, labels in {template, archive, index}.

Cosine floor: drop dense hits with sim < 0.18.

Keyword gate: require ≥2 stemmed query terms unless content_type ∈ {code,table}.

MMR diversification (λ=0.5) on remaining candidates to avoid near-duplicates.

7.2 GPU Sidecar Cross-Encoder Reranker (Option A)

Sidecar service (see §10) receives (query, candidates[]), returns top N=8 by relevance.

If sidecar fails or timeouts → fallback to heuristic (overlap/proximity) reranker to never drop a query.

8) Provenance Lock, Prompting & Generation
8.1 Lock

Freeze final passages as indexed list: idmap = {1..N → chunk_id}.

Build prompt context with [1]..[N] blocks, each containing text and SOURCE=<url#anchor> footer (for human audit; the model cites only by index).

8.2 Prompt Rules (strict)

“Use ONLY passages [1..N].”

“For every claim include [i] and a ≤12-word direct quote from that passage.”

“If unsupported, answer ‘Not found in docs.’”

“Use ≤3 citations total.”

8.3 Generation

Model: whichever LLM you’re calling now (unchanged).

Postprocess to keep citations within limit and remove stray free-form links if any.

9) Post-Gen Quote Verification (fast)

For each cited [i], extract the quoted snippet:

Accept if substring exists in passage OR rapidfuzz.partial_ratio ≥ 90.

If invalid → try swap to best-matching passage within C; if none, drop that citation.

If zero valid citations and answer didn’t use “Not found” → respond with a needs-more-context message.

Store verification outcome in telemetry.

10) Sidecar Reranker Service (Option A)
10.1 API (FastAPI)

GET /healthz → {status, model}

POST /rerank

Request: {query, candidates:[{id,text}], top_n, max_seq_len}

Response: {results:[{id, score}]}

10.2 Model & Runtime

Model: BAAI/bge-reranker-base (start here).

Batching: 32 (adjust); FP16 on CUDA.

Truncation: reserve ~25% tokens for query, ~75% for passage (max_seq_len≈512).

10.3 Dockerfile (CUDA runtime) & Deployment

See earlier Dockerfile (Torch + FlagEmbedding + FastAPI + Uvicorn).

Deploy on same host as LM Studio (share the 5090).

Add readiness/liveness probes; configure resource limits.

10.4 Client Adapter & Fallback

retriever/reranker_client.py posts to sidecar.

On error/timeout → fallback to heuristic_rerank.

11) Rendering

Expand [i] → rendered citation using idmap:

Title (from heading_path), url#anchor, 10–15 word quote, space, page_version.

Absolutely no page-level links without #anchor.

12) Telemetry & Metrics

Per-query logs:

dense_ids/scores, bm25_ids/scores, fused_ids, rerank scores

final [1..N] ids

quote verification results (pass/fail; swapped/dropped)

latency per stage (dense, bm25, fusion, rerank, generation)

flags enabled

Dashboards / KPIs:

Citation precision (% cites with verified quotes)

“Not found” correctness rate

Median/95p latency end-to-end and per stage

Dedup effectiveness (drops/space/version)

13) Evaluation Harness

Gold set: 50–200 Q→A with true section anchors and expected quotes.

Metrics:

Citation precision (must match passage by quote verification).

Answerability (should say “Not found” when gold says so).

Latency.

Ablations:

With/without reranker; with/without RM3; with/without proximity feature.

Export CSV/JSON for comparison across runs.

14) Configuration (YAML)
features:
  FEATURE_RAG_PROVENANCE_LOCK: true
  FEATURE_RERANKER: true
  FEATURE_RM3: false
  FEATURE_HEURISTIC_FALLBACK: true

ingestion:
  chunk_size_tokens: 250
  chunk_stride_tokens: 75
  drop_labels: [template, archive, index]
  drop_boilerplate: true
  dedup_enabled: true
  dedup_method: minhash
  dedup_threshold: 0.92

retrieval:
  dense_k: 80
  lexical_backend: bm25
  lexical_k: 80
  rrf_k: 60
  mmr_lambda: 0.5
  cosine_floor: 0.18
  min_keyword_overlap: 2
  final_passages: 8

reranker:
  url: "http://reranker:8000/rerank"
  top_n: 8
  timeout_s: 8
  model: "BAAI/bge-reranker-base"

generation:
  max_citations: 3
  require_quotes: true
  quote_max_words: 12

verification:
  fuzzy_partial_ratio_min: 90

15) Dependencies

Core (app):

chromadb, numpy, rapidfuzz, bm25s (or pyserini), nltk (or snowballstemmer), pydantic, requests, python-dotenv (optional).

Ingestion/Dedup:

text-dedup or datasketch + xxhash.

Sidecar:

fastapi, uvicorn[standard], torch (CUDA build), FlagEmbedding.

(If you enable RM3: Java + Pyserini/Anserini.)

16) Security & Reliability

Sanitize MCP inputs; strip HTML/script; size-limit documents and requests.

Sidecar: bound max_seq_len, cap candidates per call; authentication if exposed.

Rate-limit reranker; circuit-breaker fallback to heuristic.

PII-safe logging (hash user IDs; no page secrets in logs).

17) Rollout Plan

Remove post-gen BM25 and free-URL rendering paths (feature-flag kill switch → delete).

Land ingestion updates (macro stripping, dedup, anchors, versioned IDs); reindex a canary space.

Enable hybrid retrieval (dense + BM25 → RRF + hygiene + MMR).

Deploy reranker sidecar; turn on FEATURE_RERANKER for canary; keep heuristic fallback on.

Run eval harness; tune small knobs (cosine floor, overlap gate, MMR λ).

Validate KPIs; expand to all spaces.

Remove deprecated code paths; keep feature flags for safe rollback.

18) Acceptance Criteria

100% citations originate from the frozen candidate set.

Each citation includes a verified direct quote (substring or ≥90 partial).

All links include section anchors.

Citation precision on gold set ≥ 85%.

Median end-to-end latency ≤ ~2.0–2.5s with sidecar enabled (heuristic fallback within budget too).

Dedup removes ≥ 90% near-duplicate chunks across versions/spaces in canary.

19) Risk Register & Mitigations

Reranker latency/VRAM: start on bge-reranker-base, FP16, batch 32; scale only if gains justify.

Anchor extraction gaps: fallback to nearest higher heading; log misses → fix parser.

LM Studio hiccups: embedding client retries/backoff; cache recent embeddings.

BM25 drift vs dense: RRF and MMR balance; keep keyword gate conservative for non-code queries.

Java deps (RM3): keep off by default.

20) Deliverables

Code modules per layout above.

services/reranker/ container image & compose/K8s manifest.

config/app.yaml with sane defaults.

eval/ harness + gold set template.

Runbook: sidecar health checks, common failure modes, rollback (flip FEATURE_RERANKER=false).