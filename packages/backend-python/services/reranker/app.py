"""FastAPI sidecar service for cross-encoder reranking."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import List, Optional, Tuple

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logger = logging.getLogger("cabin.reranker")

try:  # pragma: no cover - heavy dependency
    from FlagEmbedding import FlagReranker
except Exception as exc:  # pragma: no cover - runtime import guard
    FlagReranker = None  # type: ignore
    IMPORT_ERROR = exc
else:
    IMPORT_ERROR = None


@dataclass
class RerankerConfig:
    model_name: str = "BAAI/bge-reranker-base"
    device: str = "cuda"
    max_length: int = 512
    batch_size: int = 32


class Candidate(BaseModel):
    id: str
    text: str


class RerankRequest(BaseModel):
    query: str
    candidates: List[Candidate]
    top_n: int = 8
    max_seq_len: Optional[int] = None


class RerankResponseItem(BaseModel):
    id: str
    score: float


class RerankResponse(BaseModel):
    results: List[RerankResponseItem]


app = FastAPI()
CONFIG = RerankerConfig()


def _load_model() -> Optional[FlagReranker]:
    if IMPORT_ERROR is not None:
        logger.warning(
            "FlagReranker import failed: %s. Falling back to heuristic scoring.",
            IMPORT_ERROR,
        )
        return None
    if FlagReranker is None:
        logger.warning("FlagReranker library not available; using heuristic scoring mode.")
        return None
    try:
        return FlagReranker(CONFIG.model_name, use_fp16=True, device=CONFIG.device)
    except Exception as exc:  # pragma: no cover - model init may fail on CPU hosts
        logger.warning(
            "Unable to load reranker model '%s': %s. Using heuristic scoring mode.",
            CONFIG.model_name,
            exc,
        )
        return None


@app.on_event("startup")
async def startup_event() -> None:  # pragma: no cover - integration hook
    app.state.model = _load_model()
    mode = "model" if getattr(app.state, "model", None) else "heuristic"
    logger.info("Reranker sidecar initialised in %s mode", mode)


@app.get("/healthz")
def healthz() -> dict:
    model_loaded = getattr(app.state, "model", None) is not None
    return {
        "status": "ok",
        "mode": "model" if model_loaded else "heuristic",
        "model": CONFIG.model_name if model_loaded else None,
    }


@app.post("/rerank", response_model=RerankResponse)
def rerank(payload: RerankRequest) -> RerankResponse:
    if not payload.candidates:
        raise HTTPException(status_code=400, detail="No candidates provided")

    model: Optional[FlagReranker] = getattr(app.state, "model", None)

    if model is None:
        scores = _heuristic_scores(payload.query, payload.candidates)
    else:
        max_length = payload.max_seq_len or CONFIG.max_length
        pairs = [(payload.query, candidate.text) for candidate in payload.candidates]

        try:
            scores = [
                (candidate.id, float(score))
                for candidate, score in zip(
                    payload.candidates,
                    model.compute_score(
                        pairs,
                        batch_size=CONFIG.batch_size,
                        max_length=max_length,
                    ),
                )
            ]
        except Exception as exc:  # pragma: no cover - inference error
            logger.warning("Model inference failed (%s); falling back to heuristic scoring", exc)
            scores = _heuristic_scores(payload.query, payload.candidates)

    sorted_ids = sorted(scores, key=lambda item: item[1], reverse=True)[: payload.top_n]

    return RerankResponse(
        results=[RerankResponseItem(id=item_id, score=score) for item_id, score in sorted_ids]
    )


def _heuristic_scores(query: str, candidates: List[Candidate]) -> List[Tuple[str, float]]:
    query_terms = {term for term in query.lower().split() if term}
    if not query_terms:
        return [(candidate.id, 0.0) for candidate in candidates]

    scores: List[Tuple[str, float]] = []
    for candidate in candidates:
        text_terms = {term for term in candidate.text.lower().split() if term}
        overlap = query_terms.intersection(text_terms)
        score = len(overlap) / len(query_terms)
        scores.append((candidate.id, score))
    return scores
