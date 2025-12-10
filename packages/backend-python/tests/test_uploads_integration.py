"""Integration tests for file upload and indexing."""
import pytest
import shutil
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch, AsyncMock, MagicMock
from fastapi.testclient import TestClient
from fastapi import FastAPI

# Import the actual router and deps
from cabin_backend.routers.uploads import router
from cabin_backend.routers import deps
from cabin_backend.data_sources.manager import DataSourceManager
from cabin_backend.data_sources.file_upload import FileUploadDataSource
from cabin_backend.data_sources.base import DataSourceType

@pytest.fixture
def mock_deps():
    """Mock dependencies for the router."""
    mock_manager = MagicMock(spec=DataSourceManager)
    mock_manager.start_file_indexing = AsyncMock(return_value="job-123")
    mock_manager.get_job_progress = Mock(return_value={"status": "completed"})
    
    # We need to patch the deps module in the router
    with patch('cabin_backend.routers.uploads.deps') as mock_deps_module:
        mock_deps_module.data_source_manager = mock_manager
        mock_deps_module.check_rate_limit.return_value = True
        yield mock_deps_module

@pytest.fixture
def client(mock_deps):
    """Create a test client."""
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)

class TestUploadIndexingFlow:
    """Test the full upload and indexing flow."""

    def test_upload_and_index_flow(self, client, mock_deps):
        """Test uploading a file and then triggering indexing."""
        # 1. Upload a file
        files = {'files': ('test.txt', b'test content', 'text/plain')}
        upload_response = client.post("/api/files/upload", files=files)
        assert upload_response.status_code == 200
        upload_data = upload_response.json()
        assert upload_data["success"] is True
        upload_path = upload_data["upload_path"]
        
        # 2. Trigger indexing
        index_response = client.post("/api/files/index", json={
            "upload_path": upload_path,
            "config": {"max_items": 10}
        })
        assert index_response.status_code == 200
        index_data = index_response.json()
        assert index_data["success"] is True
        assert index_data["job_id"] == "job-123"
        
        # 3. Verify manager was called correctly
        mock_deps.data_source_manager.start_file_indexing.assert_called_once()
        call_args = mock_deps.data_source_manager.start_file_indexing.call_args
        assert call_args[0][0] == upload_path
        assert call_args[0][1] == {"max_items": 10}

class TestDataSourceManagerIndexing:
    """Test the DataSourceManager logic for file indexing."""
    
    @pytest.mark.anyio
    async def test_start_file_indexing_calls_start_indexing(self):
        """Test that start_file_indexing calls start_indexing with correct args."""
        # Setup mock manager with mocked start_indexing
        chunker = Mock()
        vector_store = Mock()
        manager = DataSourceManager(chunker, vector_store)
        manager.start_indexing = AsyncMock(return_value="job-456")
        
        # Call start_file_indexing
        upload_path = "/tmp/test-upload"
        config = {"max_items": 5}
        job_id = await manager.start_file_indexing(upload_path, config)
        
        # Verify result
        assert job_id == "job-456"
        
        # Verify call arguments
        manager.start_indexing.assert_called_once()
        call_kwargs = manager.start_indexing.call_args.kwargs
        assert call_kwargs["source_type"] == "file_upload"
        assert call_kwargs["connection_config"] == {"additional_config": {"upload_path": upload_path}}
        assert call_kwargs["source_ids"] == []
        assert call_kwargs["indexing_config"] == config

    @pytest.mark.anyio
    async def test_file_upload_data_source_initialization(self):
        """Test that FileUploadDataSource initializes correctly with upload_path."""
        from cabin_backend.data_sources.base import DataSourceConnection
        
        upload_path = "/tmp/test-upload-dir"
        connection = DataSourceConnection(additional_config={"upload_path": upload_path})
        
        # Create data source
        with patch('cabin_backend.data_sources.file_upload.Path') as mock_path:
            mock_path_obj = MagicMock()
            mock_path.return_value = mock_path_obj
            mock_path_obj.exists.return_value = True
            
            source = FileUploadDataSource(connection)
            
            # Verify it tried to set upload directory
            assert source._upload_dir == mock_path_obj

    @pytest.mark.anyio
    async def test_file_upload_source_finds_files(self):
        """Test that FileUploadDataSource finds files in the upload directory."""
        from cabin_backend.data_sources.file_upload import FileUploadDataSource
        from cabin_backend.data_sources.base import DataSourceConnection
        
        with tempfile.TemporaryDirectory() as temp_dir:
            # Create a dummy file
            test_file = Path(temp_dir) / "test.txt"
            test_file.write_text("Hello world")
            
            # Initialize source
            connection = DataSourceConnection(additional_config={"upload_path": temp_dir})
            source = FileUploadDataSource(connection)
            
            # Check if it found the file
            assert len(source._uploaded_files) == 1
            assert source._uploaded_files[0].name == "test.txt"
            
            # Try to extract
            config = MagicMock()
            config.max_items = 10
            
            docs = []
            async for doc in source.extract_documents([], config):
                docs.append(doc)
                
            assert len(docs) == 1
            assert docs[0].content == "Hello world"

    @pytest.mark.anyio
    async def test_run_indexing_job_execution(self):
        """Test that _run_indexing_job correctly processes files and adds to vector store."""
        from cabin_backend.data_sources.file_upload import FileUploadDataSource
        from cabin_backend.data_sources.base import DataSourceConnection
        from cabin_backend.data_sources.manager import DataSourceManager
        
        # Setup mocks
        mock_chunker = MagicMock()
        mock_chunker.chunk.return_value = [MagicMock(id="chunk1")] # Mock chunks
        
        mock_vector_store = MagicMock()
        mock_vector_store.add_documents = MagicMock(return_value=1)
        mock_vector_store.delete_document = MagicMock()
        
        manager = DataSourceManager(mock_chunker, mock_vector_store)
        
        with tempfile.TemporaryDirectory() as temp_dir:
            # Create a dummy file
            test_file = Path(temp_dir) / "test.txt"
            test_file.write_text("Hello world content")
            
            # Setup source
            connection = DataSourceConnection(additional_config={"upload_path": temp_dir})
            source = FileUploadDataSource(connection)
            
            # Run job
            # We need to mock data_source_registry to return our source because start_indexing creates a new one
            with patch('cabin_backend.data_sources.manager.data_source_registry') as mock_registry:
                mock_registry.create_source.return_value = source
                
                job_id = await manager.start_file_indexing(temp_dir, {"max_items": 10})
                
                # Wait for the background task
                task = manager._running_tasks[job_id]
                await task
                
                # Verify vector store was called
                assert mock_vector_store.add_documents.called
                assert mock_vector_store.add_documents.call_count >= 1
                
                # Verify job status
                job = manager.get_job_progress(job_id)
                assert job.status == "completed"
                assert job.processed_items == 1
