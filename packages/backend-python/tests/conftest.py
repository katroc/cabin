"""Tests for the router modules - shared fixtures."""
import pytest
from unittest.mock import Mock, patch, MagicMock
from fastapi.testclient import TestClient


@pytest.fixture
def mock_vector_store():
    """Create a mock VectorStore for testing."""
    store = Mock()
    store.health_check.return_value = True
    store.query_async.return_value = []
    store.query.return_value = []
    return store


@pytest.fixture
def mock_embedding_client():
    """Create a mock EmbeddingClient for testing."""
    client = Mock()
    client.health_check.return_value = True
    client.embed.return_value = [[0.1] * 256]
    return client


@pytest.fixture
def mock_rag_pipeline():
    """Create a mock RAGPipelineService for testing."""
    pipeline = Mock()
    pipeline.answer.return_value = Mock(
        answer="Test answer",
        citations=[],
        thinking=None
    )
    return pipeline
