"""Lightweight logging configuration helpers."""

from __future__ import annotations

import logging
from typing import Optional

_DEFAULT_FORMAT = "%(asctime)s | %(levelname)s | %(name)s | %(message)s"


def setup_logging(level: Optional[str] = None, *, fmt: str = _DEFAULT_FORMAT) -> None:
    """Configure root logger level/format if not already configured.

    Parameters
    ----------
    level: Optional[str]
        Desired logging level (case-insensitive). Defaults to INFO when unavailable.
    fmt: str
        Log record format to apply when handlers are created.
    """

    desired_level = getattr(logging, (level or "INFO").upper(), logging.INFO)
    root_logger = logging.getLogger()

    # If handlers already exist, update their levels/formats.
    if root_logger.handlers:
        for handler in root_logger.handlers:
            handler.setLevel(desired_level)
            if hasattr(handler, "setFormatter"):
                handler.setFormatter(logging.Formatter(fmt))
        root_logger.setLevel(desired_level)
        return

    logging.basicConfig(level=desired_level, format=fmt)
