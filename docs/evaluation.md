# Evaluation & Tuning Guide

Use this checklist when validating pipeline changes before rollout.

## 1. Run Base Evaluation

```bash
python - <<'PY'
from cabin_backend.eval import EvalHarness, EvalSample, EvalRunConfig
from cabin_backend.vector_store import VectorStore
from cabin_backend.generator import Generator

samples = [
    EvalSample(question="how can i get a refund?"),
    EvalSample(question="can i extend my free trial?"),
]

harness = EvalHarness(VectorStore(), Generator())
summary = harness.run(samples, EvalRunConfig(use_reranker=True, use_rm3=False))
print(summary.to_dict())
PY
```

Record average latency (`avg_latency_seconds`) and citation precision.

## 2. Ablation Experiments

| Intent | Run Config |
| --- | --- |
| Reranker off | `EvalRunConfig(use_reranker=False)` |
| RM3 enabled | `EvalRunConfig(use_rm3=True)` |
| Heuristic fallback disabled | `EvalRunConfig(use_reranker=True, allow_reranker_fallback=False)` |

Compare precision and latency to determine whether the new feature benefits production.

## 3. Parameter Tuning

- Adjust `retrieval.cosine_floor`, `retrieval.min_keyword_overlap`, and `retrieval.mmr_lambda` in `config/app.yaml`.
- Re-run evaluation after each adjustment; target citation precision ≥ 0.9 and latency ≤ 2.5 s.
- Use metrics from logs (`retrieval.vector_store.query_time`, `generator.citation_fallback`) to diagnose issues.

## 4. Dedup Validation

After reindexing a space, confirm deduplication effectiveness via logs (`ingest.dedup.kept`, `ingest.dedup.dropped`). Expect drop ratio ≥ 90% on boilerplate-heavy spaces.

## 5. Latency Under Load

Leverage `hey` or `wrk` against `/api/chat` with reranker enabled. Record p50/p90 latency and ensure the median remains below 2.5 s. Adjust embedding cache size or reranker batch parameters as needed.

## 6. Provenance Spot-check

Sample random answers and verify citations map to `VectorStore.last_lexical_rankings()` results. Any citation outside the frozen provenance set should be treated as a regression.

