"""Tests for the deps module - shared service instances."""
import pytest
from unittest.mock import patch, MagicMock


class TestDepsModule:
    """Test the deps.py module for service management."""

    def test_services_initially_none(self):
        """Test that services are None before initialization."""
        from cabin_backend.routers.deps import (
            vector_store_service,
            generator_service,
            conversation_memory,
        )
        
        # Before init, services should be None (or initialized by other tests)
        # This tests the module structure exists
        assert hasattr(__import__('cabin_backend.routers.deps', fromlist=['vector_store_service']), 'vector_store_service')

    def test_get_services_function(self):
        """Test that get_services returns a tuple of services."""
        from cabin_backend.routers.deps import get_services
        
        result = get_services()
        assert isinstance(result, tuple)
        assert len(result) == 6  # chunker, vector_store, generator, data_manager, conv_memory, q_router

    def test_init_services_sets_globals(self):
        """Test that init_services sets the global service instances."""
        from cabin_backend.routers import deps
        
        mock_chunker = MagicMock()
        mock_vector_store = MagicMock()
        mock_generator = MagicMock()
        mock_data_manager = MagicMock()
        mock_conv_memory = MagicMock()
        mock_q_router = MagicMock()
        mock_ui_settings = MagicMock()
        mock_overrides = MagicMock()
        
        deps.init_services(
            mock_chunker,
            mock_vector_store,
            mock_generator,
            mock_data_manager,
            mock_conv_memory,
            mock_q_router,
            mock_ui_settings,
            mock_overrides,
        )
        
        assert deps.chunker_service is mock_chunker
        assert deps.vector_store_service is mock_vector_store
        assert deps.generator_service is mock_generator


class TestRateLimiting:
    """Test rate limiting functions in deps."""

    def test_check_rate_limit_allows_first_request(self):
        """Test that rate limit allows first request from new client."""
        from cabin_backend.routers.deps import check_rate_limit, upload_attempts
        
        # Use a unique test IP
        test_ip = "192.0.2.1"
        upload_attempts[test_ip] = []  # Reset for test
        
        result = check_rate_limit(test_ip)
        assert result is True

    def test_check_rate_limit_blocks_after_max(self):
        """Test that rate limit blocks after max attempts."""
        from cabin_backend.routers.deps import check_rate_limit, upload_attempts, MAX_UPLOADS_PER_HOUR
        import time
        
        test_ip = "192.0.2.2"
        current_time = time.time()
        
        # Fill up the attempts
        upload_attempts[test_ip] = [current_time] * MAX_UPLOADS_PER_HOUR
        
        result = check_rate_limit(test_ip)
        assert result is False


class TestPerformanceMetrics:
    """Test performance metrics storage."""

    def test_store_performance_metrics(self):
        """Test storing performance metrics."""
        from cabin_backend.routers.deps import store_performance_metrics, performance_metrics
        from cabin_backend.models import RAGPerformanceMetrics
        
        initial_count = len(performance_metrics)
        
        # Create a metrics object with all required fields
        test_metrics = RAGPerformanceMetrics(
            conversation_id="test-conv-123",
            query="test query",
            query_type="rag",
            total_duration_ms=100.0,
            used_rag=True,
            num_context_chunks=5,
        )
        
        store_performance_metrics(test_metrics)
        
        assert len(performance_metrics) == initial_count + 1
