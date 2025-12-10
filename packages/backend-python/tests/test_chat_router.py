"""Tests for the chat router module."""
import pytest
from unittest.mock import Mock, patch, AsyncMock, MagicMock


class TestChatRouterStructure:
    """Test chat router module structure."""

    def test_chat_router_importable(self):
        """Test that chat router can be imported."""
        with patch.dict('sys.modules', {
            'cabin_backend.routers.deps': MagicMock()
        }):
            from cabin_backend.routers.chat import router
            assert router is not None

    def test_chat_router_has_routes(self):
        """Test that chat router has registered routes."""
        from cabin_backend.routers.chat import router
        
        # Router should have routes
        assert len(router.routes) > 0
        
        # Check for expected route paths
        route_paths = [route.path for route in router.routes if hasattr(route, 'path')]
        assert any('chat' in path.lower() or path == '/' for path in route_paths)


class TestChatModels:
    """Test chat-related Pydantic models."""

    def test_chat_request_model(self):
        """Test that ChatRequest model validates correctly."""
        from cabin_backend.models import ChatRequest
        
        # Valid request with required field only
        request = ChatRequest(message="Hello, world!")
        assert request.message == "Hello, world!"
        assert request.conversation_id is None
        assert request.filters is None

    def test_chat_request_optional_fields(self):
        """Test ChatRequest with optional fields."""
        from cabin_backend.models import ChatRequest
        
        request = ChatRequest(
            message="Test",
            conversation_id="test-conv-123",
            filters={"type": "code"}
        )
        assert request.conversation_id == "test-conv-123"
        assert request.filters == {"type": "code"}


class TestChatEndpointRegistration:
    """Test that chat endpoints are properly registered."""

    def test_chat_endpoint_registered(self):
        """Test that /chat endpoint is in router."""
        from cabin_backend.routers.chat import router
        
        # Find POST routes
        post_routes = [r for r in router.routes if hasattr(r, 'methods') and 'POST' in r.methods]
        
        # Should have at least one POST endpoint
        assert len(post_routes) >= 1

    def test_stream_endpoint_registered(self):
        """Test that /chat/stream endpoint is in router."""
        from cabin_backend.routers.chat import router
        
        # Find routes with 'stream' in path
        route_paths = [r.path for r in router.routes if hasattr(r, 'path')]
        stream_routes = [p for p in route_paths if 'stream' in p.lower()]
        
        # Should have stream endpoint
        assert len(stream_routes) >= 1


class TestChatResponse:
    """Test chat response model."""

    def test_chat_response_model(self):
        """Test ChatResponse model structure."""
        from cabin_backend.models import ChatResponse
        
        response = ChatResponse(
            response="Test response",
            citations=[],
            conversation_id="test-123"
        )
        assert response.response == "Test response"
        assert response.citations == []
        assert response.conversation_id == "test-123"
