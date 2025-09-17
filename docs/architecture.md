# Backend Architecture Overview

Directory | Responsibility
---|---
`data_sources/` | Connectors (Confluence MCP) for ingestion.
`ingest/` | Chunking, deduplication, and metadata normalization utilities.
`dense/` | Chroma client and embedding helpers (LM Studio integration).
`lexical/` | BM25 index and RM3 expansion logic.
`retriever/` | Fusion, hygiene, reranker client, and reranking heuristics.
`generator/` & `generation/` | Prompt templates and provenance-locked LLM generation.
`citations/` | Quote verification and payload rendering.
`telemetry/` | Structured logging and metrics utilities.
`eval/` | Evaluation harness and gold QA datasets.

This layout matches the implementation plan documented in `citation.md`.
