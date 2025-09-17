"""Lightweight logging configuration helpers."""

from __future__ import annotations

import logging
import re
from typing import Optional

_DEFAULT_FORMAT = "%(asctime)s | %(levelname)s | %(name)s | %(message)s"

EMAIL_RE = re.compile(r"[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}")
DIGIT_RE = re.compile(r"\b\d{4,}\b")


def sanitize_text(value: Optional[str]) -> str:
    """Mask common PII patterns (emails, long numbers) for logging."""

    if not value:
        return ""
    masked = EMAIL_RE.sub("<email>", value)
    masked = DIGIT_RE.sub("<num>", masked)
    return masked


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
