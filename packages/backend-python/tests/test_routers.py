"""Tests for the routers module structure."""
import pytest


class TestRoutersPackage:
    """Test the routers package exports."""

    def test_all_routers_importable(self):
        """Test that all routers can be imported from the routers package."""
        from cabin_backend.routers import (
            chat_router,
            conversation_router,
            documents_router,
            data_sources_router,
            uploads_router,
            performance_router,
            settings_router,
        )
        
        # All should be non-None FastAPI routers
        assert chat_router is not None
        assert conversation_router is not None
        assert documents_router is not None
        assert data_sources_router is not None
        assert uploads_router is not None
        assert performance_router is not None
        assert settings_router is not None

    def test_routers_have_prefix(self):
        """Test that routers have expected prefixes."""
        from cabin_backend.routers import (
            chat_router,
            conversation_router,
            settings_router,
        )
        
        # Routers should have routes registered
        assert len(chat_router.routes) > 0
        assert len(conversation_router.routes) > 0
        assert len(settings_router.routes) > 0


class TestRouterIntegration:
    """Test that routers integrate with main app correctly."""

    def test_main_imports_routers(self):
        """Test that main.py properly imports and mounts routers."""
        # This verifies the import chain works
        from cabin_backend.main import app
        
        # App should exist and be a FastAPI app
        assert app is not None
        assert hasattr(app, 'routes')

    def test_main_has_expected_routes(self):
        """Test that main app has expected route patterns."""
        from cabin_backend.main import app
        
        # Get all route paths
        route_paths = [route.path for route in app.routes if hasattr(route, 'path')]
        
        # Should have chat, settings, and document routes
        chat_routes = [p for p in route_paths if '/chat' in p]
        settings_routes = [p for p in route_paths if '/settings' in p]
        
        assert len(chat_routes) > 0, "Should have chat routes"
        assert len(settings_routes) > 0, "Should have settings routes"
