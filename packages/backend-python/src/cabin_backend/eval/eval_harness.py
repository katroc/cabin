"""Evaluation harness for running gold QA sets through the RAG pipeline."""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass, asdict
from pathlib import Path
from statistics import mean
from typing import Iterable, List, Optional

from ..models import ChatRequest
from ..vector_store import VectorStore
from ..generator import Generator


@dataclass
class EvalSample:
    """Single evaluation sample."""

    question: str
    expected_citations: Optional[List[str]] = None
    notes: Optional[str] = None


@dataclass
class EvalResult:
    question: str
    answer: str
    citations: List[str]
    citation_precision: Optional[float]
    latency_seconds: float


@dataclass
class EvalRunConfig:
    """Optional overrides for evaluation runs."""

    use_reranker: Optional[bool] = None
    use_rm3: Optional[bool] = None
    allow_reranker_fallback: Optional[bool] = None
    enforce_provenance: Optional[bool] = None


@dataclass
class EvalSummary:
    results: List[EvalResult]

    @property
    def avg_latency(self) -> float:
        return mean(result.latency_seconds for result in self.results) if self.results else 0.0

    @property
    def avg_citation_precision(self) -> float:
        precisions = [r.citation_precision for r in self.results if r.citation_precision is not None]
        return mean(precisions) if precisions else 0.0

    def to_dict(self) -> dict:
        return {
            "avg_latency_seconds": self.avg_latency,
            "avg_citation_precision": self.avg_citation_precision,
            "results": [asdict(result) for result in self.results],
        }


class EvalHarness:
    """Thin orchestration layer for end-to-end evaluation runs."""

    def __init__(self, vector_store: VectorStore, generator: Generator) -> None:
        self.vector_store = vector_store
        self.generator = generator

    def run(self, samples: Iterable[EvalSample], config: Optional[EvalRunConfig] = None) -> EvalSummary:
        results: List[EvalResult] = []
        run_cfg = config or EvalRunConfig()
        for sample in samples:
            with self._timed() as timer:
                chunks = self.vector_store.query(
                    sample.question,
                    use_reranker=run_cfg.use_reranker,
                    use_rm3=run_cfg.use_rm3,
                    allow_reranker_fallback=run_cfg.allow_reranker_fallback,
                )
                response = self.generator.ask(
                    sample.question,
                    chunks,
                    enforce_provenance=run_cfg.enforce_provenance,
                )
            precision = self._citation_precision(response.citations, sample.expected_citations)
            results.append(
                EvalResult(
                    question=sample.question,
                    answer=response.response,
                    citations=[cite.chunk_id for cite in response.citations],
                    citation_precision=precision,
                    latency_seconds=timer.elapsed,
                )
            )
        return EvalSummary(results=results)

    def export_json(self, summary: EvalSummary, path: Path) -> None:
        path.write_text(json.dumps(summary.to_dict(), indent=2, ensure_ascii=False))

    def export_csv(self, summary: EvalSummary, path: Path) -> None:
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerow(["question", "answer", "citations", "citation_precision", "latency_seconds"])
            for result in summary.results:
                writer.writerow([
                    result.question,
                    result.answer,
                    ",".join(result.citations),
                    "" if result.citation_precision is None else f"{result.citation_precision:.2f}",
                    f"{result.latency_seconds:.3f}",
                ])

    class _Timer:
        def __enter__(self):
            import time

            self._start = time.perf_counter()
            self.elapsed = 0.0
            return self

        def __exit__(self, exc_type, exc, tb):
            import time

            self.elapsed = time.perf_counter() - self._start

    def _timed(self) -> "EvalHarness._Timer":
        return self._Timer()

    @staticmethod
    def _citation_precision(actual, expected) -> Optional[float]:
        if not expected:
            return None
        if not actual:
            return 0.0
        expected_set = {cite for cite in expected}
        actual_set = {cite for cite in actual}
        if not expected_set:
            return None
        return len(actual_set & expected_set) / len(actual_set)


__all__ = ["EvalHarness", "EvalSample", "EvalResult", "EvalSummary"]
