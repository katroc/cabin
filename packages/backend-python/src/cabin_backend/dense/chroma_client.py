"""ChromaDB client wrapper with connection management and retries."""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, Iterable, List, Optional

import chromadb
from chromadb.api.models.Collection import Collection


logger = logging.getLogger(__name__)


class ChromaCollectionManager:
    """Thin wrapper around ChromaDB collection operations with resilience hooks."""

    def __init__(
        self,
        *,
        host: str,
        port: int,
        collection_name: str,
        max_retries: int = 3,
        retry_delay: float = 1.0,
    ) -> None:
        self._host = host
        self._port = port
        self._collection_name = collection_name
        self._max_retries = max_retries
        self._retry_delay = retry_delay

        self._client: Optional[chromadb.HttpClient] = None
        self._collection: Optional[Collection] = None
        self._connect()

    # ------------------------------------------------------------------
    # Public operations
    # ------------------------------------------------------------------

    @property
    def collection(self) -> Collection:
        if not self._collection:
            raise RuntimeError("Chroma collection not initialised")
        return self._collection

    def ensure_connection(self) -> None:
        """Make sure the client/collection are alive and reconnect when needed."""
        try:
            if self._client and self._collection:
                self._client.heartbeat()
                self._collection.count()
                return
        except Exception as exc:  # pragma: no cover - network path
            logger.warning("Chroma heartbeat failed (%s); reconnecting", exc)

        self._connect()

    def add(
        self,
        *,
        ids: Iterable[str],
        embeddings: Iterable[List[float]],
        documents: Iterable[str],
        metadatas: Iterable[Dict[str, Any]],
    ) -> None:
        self.ensure_connection()
        try:
            self.collection.add(
                ids=list(ids),
                embeddings=list(embeddings),
                documents=list(documents),
                metadatas=list(metadatas),
            )
        except Exception as exc:
            logger.error("Failed to add documents to ChromaDB: %s", exc)
            self.ensure_connection()
            self.collection.add(
                ids=list(ids),
                embeddings=list(embeddings),
                documents=list(documents),
                metadatas=list(metadatas),
            )

    def query(
        self,
        *,
        query_embeddings: Iterable[List[float]],
        n_results: int,
        where: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        self.ensure_connection()
        query_args: Dict[str, Any] = {
            "query_embeddings": list(query_embeddings),
            "n_results": n_results,
        }
        if where:
            query_args["where"] = where
        try:
            return self.collection.query(**query_args)
        except Exception as exc:
            logger.error("Chroma query failed: %s", exc)
            self.ensure_connection()
            return self.collection.query(**query_args)

    def count(self) -> int:
        self.ensure_connection()
        return self.collection.count()

    def reset(self) -> None:
        """Drop and recreate the managed collection."""
        self.ensure_connection()
        assert self._client is not None  # for type checkers
        try:
            self._client.delete_collection(name=self._collection_name)
        except Exception as exc:  # pragma: no cover - chroma behaviour
            logger.warning("Failed to delete collection %s: %s", self._collection_name, exc)
        finally:
            self._collection = self._client.get_or_create_collection(name=self._collection_name)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _connect(self) -> None:
        delay = self._retry_delay
        for attempt in range(1, self._max_retries + 1):
            try:
                self._client = chromadb.HttpClient(host=self._host, port=self._port)
                self._client.heartbeat()
                self._collection = self._client.get_or_create_collection(name=self._collection_name)
                logger.info(
                    "ChromaDB collection '%s' connected on attempt %d/%d",
                    self._collection_name,
                    attempt,
                    self._max_retries,
                )
                return
            except Exception as exc:  # pragma: no cover - network path
                logger.warning(
                    "Chroma connection attempt %d/%d failed: %s",
                    attempt,
                    self._max_retries,
                    exc,
                )
                if attempt == self._max_retries:
                    logger.error("Unable to connect to ChromaDB after %d attempts", attempt)
                    raise
                time.sleep(delay)
                delay *= 2
