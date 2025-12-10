"""
Folder Share data source implementation.
Supports local folders and SMB/CIFS network shares with change monitoring.
"""

import asyncio
import fnmatch
import hashlib
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, List, Optional, Set
import uuid

from .base import (
    DataSource, DataSourceType, DataSourceCapability, DataSourceInfo,
    DataSourceConnection, IndexingConfig, ExtractedDocument, DocumentSource,
    IndexingProgress, data_source_registry
)
from .document_parsers import document_parser_registry

logger = logging.getLogger(__name__)


# Supported file extensions (reuse from FileUploadDataSource)
SUPPORTED_EXTENSIONS = {
    '.pdf', '.docx', '.doc', '.txt', '.md', '.markdown',
    '.html', '.htm', '.json', '.csv', '.xml', '.rtf',
    '.pptx', '.ppt', '.xlsx', '.xls', '.odt', '.ods', '.odp'
}


class FolderShareConfig:
    """Configuration for a folder share."""
    
    def __init__(
        self,
        path: str,
        name: Optional[str] = None,
        recursive: bool = True,
        max_depth: int = 10,
        file_extensions: Optional[List[str]] = None,
        exclude_patterns: Optional[List[str]] = None,
        max_file_size_mb: int = 50,
        smb_username: Optional[str] = None,
        smb_password: Optional[str] = None,
        smb_domain: Optional[str] = None,
    ):
        self.path = path
        self.name = name or Path(path).name or path
        self.recursive = recursive
        self.max_depth = max_depth
        self.file_extensions = set(file_extensions) if file_extensions else SUPPORTED_EXTENSIONS
        self.exclude_patterns = exclude_patterns or ['.*', '__pycache__', 'node_modules', '.git']
        self.max_file_size_bytes = max_file_size_mb * 1024 * 1024
        self.smb_username = smb_username
        self.smb_password = smb_password
        self.smb_domain = smb_domain
    
    def is_smb_path(self) -> bool:
        """Check if this is an SMB path."""
        return self.path.startswith('smb://') or self.path.startswith('//')
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary (excluding sensitive data)."""
        return {
            "path": self.path,
            "name": self.name,
            "recursive": self.recursive,
            "max_depth": self.max_depth,
            "file_extensions": list(self.file_extensions),
            "exclude_patterns": self.exclude_patterns,
            "max_file_size_mb": self.max_file_size_bytes // (1024 * 1024),
            "is_smb": self.is_smb_path(),
        }


class FolderShareDataSource(DataSource):
    """Data source for local folders and SMB/CIFS network shares."""
    
    def __init__(self, connection: DataSourceConnection):
        super().__init__(connection)
        self._job_id: Optional[str] = None
        self._progress: Optional[IndexingProgress] = None
        self._smb_client = None  # Lazy-loaded SMB client
        
        # Extract config from connection
        config = connection.additional_config or {}
        self.config = FolderShareConfig(
            path=config.get('path', ''),
            name=config.get('name'),
            recursive=config.get('recursive', True),
            max_depth=config.get('max_depth', 10),
            file_extensions=config.get('file_extensions'),
            exclude_patterns=config.get('exclude_patterns'),
            max_file_size_mb=config.get('max_file_size_mb', 50),
            smb_username=config.get('smb_username'),
            smb_password=config.get('smb_password'),
            smb_domain=config.get('smb_domain'),
        )
    
    def get_info(self) -> DataSourceInfo:
        """Return information about the folder share data source."""
        return DataSourceInfo(
            type=DataSourceType.FOLDER_SHARE,
            name="Folder/Share",
            description="Index documents from local folders or SMB/CIFS network shares with automatic change monitoring.",
            capabilities=[
                DataSourceCapability.SPACE_DISCOVERY,
                DataSourceCapability.INCREMENTAL_SYNC,
                DataSourceCapability.ATTACHMENT_SUPPORT,
                DataSourceCapability.METADATA_EXTRACTION,
                DataSourceCapability.CHANGE_MONITORING,
            ],
            config_schema={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Local folder path or SMB URL (e.g., /path/to/folder or smb://server/share)"
                    },
                    "name": {
                        "type": "string",
                        "description": "Display name for this share"
                    },
                    "recursive": {
                        "type": "boolean",
                        "default": True,
                        "description": "Whether to traverse subdirectories"
                    },
                    "max_depth": {
                        "type": "integer",
                        "default": 10,
                        "description": "Maximum directory depth to traverse"
                    },
                    "file_extensions": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "File extensions to include (e.g., ['.pdf', '.docx'])"
                    },
                    "exclude_patterns": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Glob patterns to exclude (e.g., ['.*', 'node_modules'])"
                    },
                    "max_file_size_mb": {
                        "type": "integer",
                        "default": 50,
                        "description": "Maximum file size in MB"
                    },
                    "smb_username": {
                        "type": "string",
                        "description": "SMB username (optional, for direct SMB connections)"
                    },
                    "smb_password": {
                        "type": "string",
                        "description": "SMB password (optional)"
                    },
                    "smb_domain": {
                        "type": "string",
                        "description": "SMB domain/workgroup (optional)"
                    }
                },
                "required": ["path"]
            },
            connection_required=False  # Local paths don't require credentials
        )
    
    async def test_connection(self) -> bool:
        """Test if the folder/share is accessible."""
        try:
            if self.config.is_smb_path():
                return await self._test_smb_connection()
            else:
                return await self._test_local_connection()
        except Exception as e:
            logger.error(f"Connection test failed for {self.config.path}: {e}")
            return False
    
    async def _test_local_connection(self) -> bool:
        """Test local folder accessibility."""
        path = Path(self.config.path)
        if not path.exists():
            logger.warning(f"Path does not exist: {self.config.path}")
            return False
        if not path.is_dir():
            logger.warning(f"Path is not a directory: {self.config.path}")
            return False
        if not os.access(path, os.R_OK):
            logger.warning(f"Path is not readable: {self.config.path}")
            return False
        return True
    
    async def _test_smb_connection(self) -> bool:
        """Test SMB share accessibility."""
        # TODO: Implement SMB connection test using smbprotocol
        # For now, if it's a mounted path, test as local
        smb_path = self.config.path
        
        # Convert smb:// URL to potential mount point for initial testing
        if smb_path.startswith('smb://'):
            # Try to check if smbprotocol is available
            try:
                from smbclient import listdir
                # Parse SMB URL
                parts = smb_path.replace('smb://', '').split('/')
                server = parts[0]
                share = parts[1] if len(parts) > 1 else ''
                path_in_share = '/'.join(parts[2:]) if len(parts) > 2 else ''
                
                smb_full_path = f"\\\\{server}\\{share}"
                if path_in_share:
                    smb_full_path += f"\\{path_in_share}"
                
                # Test by listing directory
                listdir(
                    smb_full_path,
                    username=self.config.smb_username,
                    password=self.config.smb_password,
                )
                return True
            except ImportError:
                logger.warning("smbprotocol not installed. Install with: pip install smbprotocol")
                return False
            except Exception as e:
                logger.error(f"SMB connection failed: {e}")
                return False
        
        # For // style paths, try as local (mounted share)
        return await self._test_local_connection()
    
    async def discover_sources(self) -> List[Dict[str, Any]]:
        """Discover subdirectories as indexable sources."""
        sources = []
        
        try:
            if self.config.is_smb_path() and self.config.path.startswith('smb://'):
                # SMB discovery - list top-level directories
                sources = await self._discover_smb_sources()
            else:
                # Local discovery
                sources = await self._discover_local_sources()
        except Exception as e:
            logger.error(f"Failed to discover sources in {self.config.path}: {e}")
        
        return sources
    
    async def _discover_local_sources(self) -> List[Dict[str, Any]]:
        """Discover local subdirectories."""
        sources = []
        root_path = Path(self.config.path)
        
        if not root_path.exists():
            return sources
        
        # Add the root folder itself
        sources.append({
            "id": str(root_path.resolve()),
            "name": root_path.name or str(root_path),
            "type": "folder",
            "description": f"Root folder: {root_path}",
            "file_count": self._count_files(root_path, depth=0),
        })
        
        # Add immediate subdirectories
        try:
            for item in root_path.iterdir():
                if item.is_dir() and not self._should_exclude(item.name):
                    sources.append({
                        "id": str(item.resolve()),
                        "name": item.name,
                        "type": "folder",
                        "description": f"Subfolder: {item.relative_to(root_path)}",
                        "file_count": self._count_files(item, depth=0),
                    })
        except PermissionError as e:
            logger.warning(f"Permission denied listing {root_path}: {e}")
        
        return sources
    
    async def _discover_smb_sources(self) -> List[Dict[str, Any]]:
        """Discover SMB share directories using smbprotocol."""
        try:
            from smbclient import listdir, stat as smb_stat
            import smbclient
            
            # Register SMB session if credentials provided
            if self.config.smb_username:
                smb_path = self.config.path
                parts = smb_path.replace('smb://', '').split('/')
                server = parts[0]
                
                smbclient.register_session(
                    server,
                    username=self.config.smb_username,
                    password=self.config.smb_password,
                )
            
            # Convert smb:// URL to UNC path
            unc_path = self._smb_url_to_unc(self.config.path)
            
            sources = []
            
            # Add root share
            sources.append({
                "id": self.config.path,
                "name": self.config.name,
                "type": "smb_share",
                "description": f"SMB Share: {self.config.path}",
            })
            
            # List subdirectories
            try:
                for entry in listdir(unc_path):
                    if self._should_exclude(entry):
                        continue
                    
                    entry_path = f"{unc_path}\\{entry}"
                    try:
                        entry_stat = smb_stat(entry_path)
                        # Check if it's a directory (S_IFDIR = 0o040000)
                        import stat as stat_module
                        if stat_module.S_ISDIR(entry_stat.st_mode):
                            sources.append({
                                "id": f"{self.config.path}/{entry}",
                                "name": entry,
                                "type": "smb_folder",
                                "description": f"SMB Folder: {entry}",
                            })
                    except Exception as e:
                        logger.debug(f"Could not stat {entry_path}: {e}")
            except Exception as e:
                logger.warning(f"Could not list SMB directory: {e}")
            
            return sources
            
        except ImportError:
            logger.warning("smbprotocol not installed. Using fallback discovery.")
            return [{
                "id": self.config.path,
                "name": self.config.name,
                "type": "smb_share",
                "description": f"SMB Share: {self.config.path}",
            }]
        except Exception as e:
            logger.error(f"SMB discovery failed: {e}")
            return [{
                "id": self.config.path,
                "name": self.config.name,
                "type": "smb_share",
                "description": f"SMB Share: {self.config.path} (discovery failed)",
            }]
    
    def _smb_url_to_unc(self, smb_url: str) -> str:
        """Convert smb://server/share/path to UNC path \\\\server\\share\\path."""
        if smb_url.startswith('smb://'):
            path = smb_url.replace('smb://', '')
            parts = path.split('/')
            # Build UNC path
            unc = '\\\\' + '\\'.join(parts)
            return unc
        elif smb_url.startswith('//'):
            return smb_url.replace('/', '\\')
        return smb_url
    
    def _count_files(self, path: Path, depth: int = 0) -> int:
        """Count indexable files in a directory (non-recursive for speed)."""
        count = 0
        try:
            for item in path.iterdir():
                if item.is_file() and item.suffix.lower() in self.config.file_extensions:
                    count += 1
        except PermissionError:
            pass
        return count
    
    def _should_exclude(self, name: str) -> bool:
        """Check if a file/folder should be excluded."""
        for pattern in self.config.exclude_patterns:
            if fnmatch.fnmatch(name, pattern):
                return True
        return False
    
    async def extract_documents(
        self,
        source_ids: List[str],
        config: IndexingConfig
    ) -> AsyncGenerator[ExtractedDocument, None]:
        """Extract documents from specified folders."""
        self._job_id = str(uuid.uuid4())
        self._progress = IndexingProgress(
            job_id=self._job_id,
            status="running",
            started_at=datetime.now()
        )
        
        files_to_process: List[str] = []  # Now storing strings, not Path objects
        
        # Collect all files from source paths
        for source_id in source_ids:
            if source_id.startswith('smb://') or source_id.startswith('//'):
                # SMB path - collect files via smbprotocol
                smb_files = await self._collect_smb_files(
                    source_id, depth=0, max_depth=self.config.max_depth
                )
                files_to_process.extend(smb_files)
            else:
                # Local path
                path = Path(source_id)
                if path.exists() and path.is_dir():
                    local_files = self._collect_files(path, depth=0, max_depth=self.config.max_depth)
                    files_to_process.extend([str(f) for f in local_files])
                elif path.exists() and path.is_file():
                    files_to_process.append(str(path))
        
        self._progress.total_items = min(len(files_to_process), config.max_items)
        processed = 0
        
        for file_path_str in files_to_process:
            if processed >= config.max_items:
                break
            
            self._progress.current_item = file_path_str
            
            try:
                # Handle SMB vs local files differently
                if file_path_str.startswith('smb://') or file_path_str.startswith('\\\\'):
                    doc = await self._extract_smb_file(file_path_str)
                else:
                    file_path = Path(file_path_str)
                    
                    # Check file size
                    try:
                        if file_path.stat().st_size > self.config.max_file_size_bytes:
                            logger.warning(f"Skipping large file: {file_path}")
                            continue
                    except OSError:
                        continue
                    
                    # Check modification time for incremental sync
                    if config.incremental and config.modified_since:
                        try:
                            mtime = datetime.fromtimestamp(file_path.stat().st_mtime)
                            if mtime < config.modified_since:
                                continue
                        except OSError:
                            continue
                    
                    doc = await self._extract_single_file(file_path)
                
                if doc:
                    processed += 1
                    self._progress.processed_items = processed
                    yield doc
            except Exception as e:
                logger.error(f"Failed to extract {file_path_str}: {e}")
                continue
            
            # Small delay to prevent CPU overload
            await asyncio.sleep(0.01)
        
        self._progress.status = "completed"
        self._progress.completed_at = datetime.now()
    
    async def _collect_smb_files(
        self,
        smb_path: str,
        depth: int,
        max_depth: int
    ) -> List[str]:
        """Collect files from SMB share recursively."""
        files = []
        
        if depth > max_depth:
            return files
        
        try:
            from smbclient import listdir, stat as smb_stat
            import smbclient
            import stat as stat_module
            
            # Register session if needed
            if self.config.smb_username and not hasattr(self, '_smb_session_registered'):
                parts = smb_path.replace('smb://', '').split('/')
                server = parts[0]
                smbclient.register_session(
                    server,
                    username=self.config.smb_username,
                    password=self.config.smb_password,
                )
                self._smb_session_registered = True
            
            unc_path = self._smb_url_to_unc(smb_path)
            
            for entry in listdir(unc_path):
                if self._should_exclude(entry):
                    continue
                
                entry_unc = f"{unc_path}\\{entry}"
                entry_smb = f"{smb_path}/{entry}"
                
                try:
                    entry_stat = smb_stat(entry_unc)
                    
                    if stat_module.S_ISDIR(entry_stat.st_mode):
                        # Directory - recurse if enabled
                        if self.config.recursive:
                            files.extend(await self._collect_smb_files(
                                entry_smb, depth + 1, max_depth
                            ))
                    elif stat_module.S_ISREG(entry_stat.st_mode):
                        # Regular file - check extension
                        ext = Path(entry).suffix.lower()
                        if ext in self.config.file_extensions:
                            # Check file size
                            if entry_stat.st_size <= self.config.max_file_size_bytes:
                                files.append(entry_unc)  # Store UNC path for reading
                except Exception as e:
                    logger.debug(f"Could not process {entry_unc}: {e}")
        
        except ImportError:
            logger.warning("smbprotocol not installed, cannot collect SMB files")
        except Exception as e:
            logger.error(f"Error collecting SMB files from {smb_path}: {e}")
        
        return files
    
    async def _extract_smb_file(self, unc_path: str) -> Optional[ExtractedDocument]:
        """Extract content from a file on an SMB share."""
        import tempfile
        
        try:
            from smbclient import open_file, stat as smb_stat
            
            # Get file info
            file_stat = smb_stat(unc_path)
            file_name = Path(unc_path).name
            file_ext = Path(unc_path).suffix.lower()
            
            # Download to temp file for parsing
            with tempfile.NamedTemporaryFile(suffix=file_ext, delete=False) as tmp:
                tmp_path = Path(tmp.name)
                with open_file(unc_path, mode='rb') as smb_file:
                    tmp.write(smb_file.read())
            
            try:
                # Parse using existing parser
                parser = document_parser_registry.get_parser(tmp_path)
                if not parser:
                    logger.debug(f"No parser available for {unc_path}")
                    return None
                
                content, metadata = parser.parse(tmp_path)
                
                if not content or len(content.strip()) < 10:
                    logger.debug(f"Skipping empty/minimal content: {unc_path}")
                    return None
                
                # Generate document ID from path
                doc_id = hashlib.sha256(unc_path.encode()).hexdigest()[:16]
                
                # Convert UNC back to smb:// for display
                smb_url = self._unc_to_smb_url(unc_path)
                
                return ExtractedDocument(
                    id=doc_id,
                    title=metadata.title or Path(unc_path).stem,
                    content=content,
                    source=DocumentSource(
                        source_type=DataSourceType.FOLDER_SHARE,
                        source_id=str(Path(unc_path).parent),
                        source_url=smb_url,
                        title=file_name,
                        last_modified=datetime.fromtimestamp(file_stat.st_mtime),
                        metadata={
                            "file_path": unc_path,
                            "smb_url": smb_url,
                            "file_size": file_stat.st_size,
                            "file_extension": file_ext,
                        }
                    ),
                    metadata={
                        **metadata.to_dict(),
                        "document_id": doc_id,
                        "source_type": "folder_share",
                        "file_path": smb_url,
                        "folder_name": Path(unc_path).parent.name,
                        "is_smb": True,
                    }
                )
            finally:
                # Clean up temp file
                try:
                    tmp_path.unlink()
                except Exception:
                    pass
        
        except ImportError:
            logger.error("smbprotocol not installed")
            return None
        except Exception as e:
            logger.error(f"Failed to extract SMB file {unc_path}: {e}")
            return None
    
    def _unc_to_smb_url(self, unc_path: str) -> str:
        """Convert UNC path \\\\server\\share\\path to smb://server/share/path."""
        if unc_path.startswith('\\\\'):
            path = unc_path[2:]  # Remove leading \\
            parts = path.split('\\')
            return 'smb://' + '/'.join(parts)
        return unc_path

    
    def _collect_files(
        self,
        path: Path,
        depth: int,
        max_depth: int
    ) -> List[Path]:
        """Recursively collect indexable files."""
        files = []
        
        if depth > max_depth:
            return files
        
        try:
            for item in path.iterdir():
                if self._should_exclude(item.name):
                    continue
                
                if item.is_file():
                    if item.suffix.lower() in self.config.file_extensions:
                        files.append(item)
                elif item.is_dir() and self.config.recursive:
                    files.extend(self._collect_files(item, depth + 1, max_depth))
        except PermissionError as e:
            logger.warning(f"Permission denied: {path}")
        except Exception as e:
            logger.error(f"Error collecting files from {path}: {e}")
        
        return files
    
    async def _extract_single_file(self, file_path: Path) -> Optional[ExtractedDocument]:
        """Extract content from a single file."""
        parser = document_parser_registry.get_parser(file_path)
        if not parser:
            logger.debug(f"No parser available for {file_path}")
            return None
        
        try:
            content, metadata = parser.parse(file_path)
            
            if not content or len(content.strip()) < 10:
                logger.debug(f"Skipping empty/minimal content: {file_path}")
                return None
            
            # Generate document ID from path
            doc_id = hashlib.sha256(str(file_path.resolve()).encode()).hexdigest()[:16]
            
            # Get file stats
            stat = file_path.stat()
            
            return ExtractedDocument(
                id=doc_id,
                title=metadata.title or file_path.stem,
                content=content,
                source=DocumentSource(
                    source_type=DataSourceType.FOLDER_SHARE,
                    source_id=str(file_path.parent),
                    source_url=f"file://{file_path.resolve()}",
                    title=file_path.name,
                    last_modified=datetime.fromtimestamp(stat.st_mtime),
                    metadata={
                        "file_path": str(file_path.resolve()),
                        "file_size": stat.st_size,
                        "file_extension": file_path.suffix.lower(),
                    }
                ),
                metadata={
                    **metadata.to_dict(),
                    "document_id": doc_id,
                    "source_type": "folder_share",
                    "file_path": str(file_path.resolve()),
                    "folder_name": file_path.parent.name,
                }
            )
        except Exception as e:
            logger.error(f"Failed to parse {file_path}: {e}")
            return None
    
    def get_progress(self, job_id: str) -> Optional[IndexingProgress]:
        """Get the progress of an indexing job."""
        if self._progress and self._progress.job_id == job_id:
            return self._progress
        return None


# Register the folder share data source
data_source_registry.register(DataSourceType.FOLDER_SHARE, FolderShareDataSource)
