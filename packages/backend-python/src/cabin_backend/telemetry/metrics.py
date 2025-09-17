"""Minimal metrics emitter backed by structured logging."""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from typing import Any, Dict


class MetricsEmitter:
    """Emit structured metrics via logging for lightweight observability."""

    def __init__(self) -> None:
        self._logger = logging.getLogger("cabin.metrics")
        self._enabled = False

    def configure(self, *, enabled: bool) -> None:
        self._enabled = enabled

    def increment(self, name: str, value: float = 1.0, **labels: Any) -> None:
        if not self._enabled:
            return
        payload = {"metric": name, "value": value, "labels": labels}
        self._logger.info("metric.increment", extra={"metric_payload": payload})

    @contextmanager
    def timer(self, name: str, **labels: Any):
        start = time.perf_counter()
        try:
            yield
        finally:
            if not self._enabled:
                return
            duration = time.perf_counter() - start
            payload = {"metric": name, "duration": duration, "labels": labels}
            self._logger.info("metric.timer", extra={"metric_payload": payload})


metrics = MetricsEmitter()

__all__ = ["metrics", "MetricsEmitter"]
