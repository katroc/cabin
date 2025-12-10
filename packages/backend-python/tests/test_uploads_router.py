"""Tests for the uploads router module."""
import pytest
from unittest.mock import Mock, patch, AsyncMock, MagicMock
from fastapi.testclient import TestClient
from fastapi import FastAPI


@pytest.fixture
def app_with_uploads_router():
    """Create a FastAPI app with the uploads router."""
    from cabin_backend.routers.uploads import router
    
    app = FastAPI()
    app.include_router(router)
    return app


@pytest.fixture
def uploads_client(app_with_uploads_router):
    """Create a test client for the uploads router."""
    return TestClient(app_with_uploads_router)


class TestUploadsRouterEndpoints:
    """Test uploads router endpoint registration."""

    def test_upload_endpoint_path(self, uploads_client):
        """Test that /api/files/upload endpoint is registered."""
        # We need to mock deps to avoid 503
        with patch('cabin_backend.routers.uploads.deps') as mock_deps:
            mock_deps.data_source_manager = MagicMock()
            mock_deps.check_rate_limit.return_value = True
            
            # Use a dummy file
            files = {'files': ('test.txt', b'test content', 'text/plain')}
            response = uploads_client.post("/api/files/upload", files=files)
            
            # Should not be 404
            assert response.status_code != 404

    def test_index_endpoint_path(self, uploads_client):
        """Test that /api/files/index endpoint is registered."""
        with patch('cabin_backend.routers.uploads.deps') as mock_deps:
            mock_deps.data_source_manager = MagicMock()
            
            response = uploads_client.post("/api/files/index", json={
                "upload_path": "/tmp/test",
                "config": {}
            })
            
            # Should not be 404
            assert response.status_code != 404
