# Configuration Overrides

This project reads configuration from three layers (lowest to highest priority):

1. `config/app.yaml` – shared defaults for ingestion, retrieval, reranker, telemetry, etc.
2. Environment overrides – values exported in `.env` or the shell (e.g. `CABIN_RERANKER_URL`).
3. Feature-flag environment variables – `FEATURE_*` values that can selectively enable/disable subsystems.

## Common Overrides

| Setting | Environment Variable | Description |
| --- | --- | --- |
| Reranker URL | `CABIN_RERANKER_URL` / `RERANKER_URL` | Points the backend at a local or remote reranker sidecar. |
| Reranker Port | `CABIN_RERANKER_PORT` | Overrides the port used when the local sidecar is launched via `start.py`. |
| Reranker API Key | `CABIN_RERANKER_API_KEY` / `RERANKER_API_KEY` | Used for authenticating requests between the backend and sidecar. |
| LM Studio Base URL | `LLM_BASE_URL` / `EMBEDDING_BASE_URL` | Controls the base endpoints for chat completions and embeddings. |
| Feature Flags | `FEATURE_RERANKER`, `FEATURE_RM3`, `FEATURE_HEURISTIC_FALLBACK`, `FEATURE_RAG_PROVENANCE_LOCK` | Force-enable or disable individual capabilities without editing `app.yaml`. |
| Log Level | `CABIN_LOG_LEVEL` | Overrides the root logging level (defaults to `info`). |

## Adding Environment-Specific Files

For staging/production environments, create an `.env.staging` or `.env.production` file and load it before running `start.py`:

```bash
export $(grep -v '^#' .env.staging | xargs)
python start.py
```

Alternatively, set `CABIN_APP_CONFIG_PATH` to point at an environment-specific YAML file (e.g. `config/app.staging.yaml`).

## Telemetry

Telemetry defaults can be adjusted via `config/app.yaml` under the `telemetry` section. For example, to disable metrics emission entirely, set `telemetry.metrics_enabled` to `false` or export `CABIN_TELEMETRY_DISABLED=true` (handled downstream via `.env`).

## Reranker Sidecar

When running the sidecar outside of `start.py`, ensure the backend sees the correct URL/API key. For local development:

```bash
export CABIN_RERANKER_URL=http://localhost:8010/rerank
export CABIN_RERANKER_API_KEY=dev-secret
python start.py
```

The sidecar also honours the same API key via the `RERANKER_API_KEY` environment variable.

## Embedding Cache

Caching behaviour for LM Studio embeddings can be tuned by updating the `embedding_cache` block in `config/app.yaml`:

```yaml
embedding_cache:
  enabled: true
  max_items: 512
  ttl_seconds: 600
```

## Feature Flag Matrix

| Flag | Default | Controls |
| --- | --- | --- |
| `FEATURE_RERANKER` | true | Whether the reranker sidecar is queried. |
| `FEATURE_RM3` | false | Enables RM3 pseudo-relevance feedback in lexical scoring. |
| `FEATURE_HEURISTIC_FALLBACK` | true | Allows the reranker client to fall back to heuristic scoring when the sidecar is unavailable. |
| `FEATURE_RAG_PROVENANCE_LOCK` | true | Enforces provenance-locked citation post-processing. |

All feature flags can be overridden via environment variables with the same names.
