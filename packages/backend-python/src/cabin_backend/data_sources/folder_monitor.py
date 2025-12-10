"""
Folder change monitor implementation.
Provides polling-based change detection for local folders and SMB shares.
"""

import hashlib
import json
import logging
import os
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

logger = logging.getLogger(__name__)


@dataclass
class FileState:
    """State information for a tracked file."""
    path: str
    mtime: float  # Modification time
    size: int
    content_hash: Optional[str] = None  # Optional hash for detecting content changes


@dataclass
class ChangeSet:
    """Result of a change scan."""
    added: List[str]  # New files
    modified: List[str]  # Changed files
    deleted: List[str]  # Removed files
    scan_time: datetime
    
    @property
    def has_changes(self) -> bool:
        return bool(self.added or self.modified or self.deleted)
    
    @property
    def total_changes(self) -> int:
        return len(self.added) + len(self.modified) + len(self.deleted)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "added": self.added,
            "modified": self.modified,
            "deleted": self.deleted,
            "scan_time": self.scan_time.isoformat(),
            "has_changes": self.has_changes,
            "total_changes": self.total_changes,
        }


class FolderChangeMonitor:
    """
    Monitors folders for changes using polling.
    
    Uses file modification times and sizes to detect changes.
    State is persisted to disk to survive restarts.
    """
    
    def __init__(self, state_dir: Optional[Path] = None):
        """
        Initialize the change monitor.
        
        Args:
            state_dir: Directory to store state files. Defaults to ~/.cabin/monitor_state
        """
        self.state_dir = state_dir or Path.home() / ".cabin" / "monitor_state"
        self.state_dir.mkdir(parents=True, exist_ok=True)
        
        # In-memory cache of file states keyed by share_id
        self._states: Dict[str, Dict[str, FileState]] = {}
    
    def _get_state_file(self, share_id: str) -> Path:
        """Get the state file path for a share."""
        return self.state_dir / f"{share_id}.json"
    
    def load_state(self, share_id: str) -> Dict[str, FileState]:
        """Load state for a share from disk."""
        if share_id in self._states:
            return self._states[share_id]
        
        state_file = self._get_state_file(share_id)
        if not state_file.exists():
            self._states[share_id] = {}
            return self._states[share_id]
        
        try:
            with open(state_file, 'r') as f:
                data = json.load(f)
            
            self._states[share_id] = {
                path: FileState(**state)
                for path, state in data.items()
            }
            logger.debug(f"Loaded {len(self._states[share_id])} file states for {share_id}")
            return self._states[share_id]
        except Exception as e:
            logger.error(f"Failed to load state for {share_id}: {e}")
            self._states[share_id] = {}
            return self._states[share_id]
    
    def save_state(self, share_id: str) -> bool:
        """Save state for a share to disk."""
        if share_id not in self._states:
            return False
        
        state_file = self._get_state_file(share_id)
        try:
            data = {
                path: asdict(state)
                for path, state in self._states[share_id].items()
            }
            with open(state_file, 'w') as f:
                json.dump(data, f, indent=2)
            logger.debug(f"Saved {len(data)} file states for {share_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to save state for {share_id}: {e}")
            return False
    
    def clear_state(self, share_id: str) -> bool:
        """Clear state for a share."""
        if share_id in self._states:
            del self._states[share_id]
        
        state_file = self._get_state_file(share_id)
        try:
            if state_file.exists():
                state_file.unlink()
            return True
        except Exception as e:
            logger.error(f"Failed to clear state for {share_id}: {e}")
            return False
    
    def _is_smb_path(self, path: str) -> bool:
        """Check if path is an SMB URL."""
        return path.startswith('smb://') or path.startswith('//')
    
    def _smb_url_to_unc(self, smb_url: str) -> str:
        """Convert smb://server/share/path to UNC path \\\\server\\share\\path."""
        if smb_url.startswith('smb://'):
            path = smb_url.replace('smb://', '')
            parts = path.split('/')
            unc = '\\\\' + '\\'.join(parts)
            return unc
        elif smb_url.startswith('//'):
            return smb_url.replace('/', '\\')
        return smb_url

    def scan_for_changes(
        self,
        share_id: str,
        root_path: str,
        recursive: bool = True,
        max_depth: int = 10,
        file_extensions: Optional[Set[str]] = None,
        exclude_patterns: Optional[List[str]] = None,
        smb_username: Optional[str] = None,
        smb_password: Optional[str] = None,
    ) -> ChangeSet:
        """
        Scan a folder for changes compared to stored state.
        
        Args:
            share_id: Unique identifier for this share
            root_path: Root path to scan
            recursive: Whether to scan subdirectories
            max_depth: Maximum directory depth
            file_extensions: File extensions to include
            exclude_patterns: Glob patterns to exclude
            smb_username: Optional SMB username for authentication
            smb_password: Optional SMB password for authentication
        
        Returns:
            ChangeSet with added, modified, and deleted files
        """
        import fnmatch
        
        scan_time = datetime.now()
        
        # Load existing state
        old_state = self.load_state(share_id)
        old_paths = set(old_state.keys())
        
        # Check if this is an SMB path
        if self._is_smb_path(root_path):
            return self._scan_smb_for_changes(
                share_id, root_path, old_state, old_paths, scan_time,
                recursive, max_depth, file_extensions, exclude_patterns,
                smb_username, smb_password
            )
        
        # Local path scanning
        current_files: Dict[str, FileState] = {}
        root = Path(root_path)
        
        if not root.exists():
            logger.warning(f"Root path does not exist: {root_path}")
            return ChangeSet(
                added=[],
                modified=[],
                deleted=list(old_paths),
                scan_time=scan_time
            )
        
        def should_exclude(name: str) -> bool:
            if not exclude_patterns:
                return False
            for pattern in exclude_patterns:
                if fnmatch.fnmatch(name, pattern):
                    return True
            return False
        
        def scan_directory(path: Path, depth: int):
            if depth > max_depth:
                return
            
            try:
                for item in path.iterdir():
                    if should_exclude(item.name):
                        continue
                    
                    if item.is_file():
                        # Check extension filter
                        if file_extensions and item.suffix.lower() not in file_extensions:
                            continue
                        
                        try:
                            stat = item.stat()
                            file_path = str(item.resolve())
                            current_files[file_path] = FileState(
                                path=file_path,
                                mtime=stat.st_mtime,
                                size=stat.st_size,
                            )
                        except OSError as e:
                            logger.debug(f"Cannot stat {item}: {e}")
                    
                    elif item.is_dir() and recursive:
                        scan_directory(item, depth + 1)
            
            except PermissionError:
                logger.warning(f"Permission denied: {path}")
            except Exception as e:
                logger.error(f"Error scanning {path}: {e}")
        
        scan_directory(root, 0)
        current_paths = set(current_files.keys())
        
        # Determine changes
        added = list(current_paths - old_paths)
        deleted = list(old_paths - current_paths)
        
        # Check for modifications
        modified = []
        for path in current_paths & old_paths:
            old_file = old_state[path]
            new_file = current_files[path]
            
            # Check if mtime or size changed
            if old_file.mtime != new_file.mtime or old_file.size != new_file.size:
                modified.append(path)
        
        # Update state with current files
        self._states[share_id] = current_files
        self.save_state(share_id)
        
        change_set = ChangeSet(
            added=added,
            modified=modified,
            deleted=deleted,
            scan_time=scan_time
        )
        
        if change_set.has_changes:
            logger.info(
                f"Change scan for {share_id}: "
                f"+{len(added)} added, ~{len(modified)} modified, -{len(deleted)} deleted"
            )
        else:
            logger.debug(f"Change scan for {share_id}: no changes detected")
        
        return change_set
    
    def _scan_smb_for_changes(
        self,
        share_id: str,
        root_path: str,
        old_state: Dict[str, FileState],
        old_paths: Set[str],
        scan_time: datetime,
        recursive: bool,
        max_depth: int,
        file_extensions: Optional[Set[str]],
        exclude_patterns: Optional[List[str]],
        smb_username: Optional[str],
        smb_password: Optional[str],
    ) -> ChangeSet:
        """Scan SMB share for changes using pysmb (supports guest access)."""
        import fnmatch
        import socket
        
        try:
            from smb.SMBConnection import SMBConnection
        except ImportError:
            logger.error("pysmb not installed, cannot scan SMB share. Install with: pip install pysmb")
            return ChangeSet(added=[], modified=[], deleted=[], scan_time=scan_time)
        
        # Parse SMB URL
        # smb://server/share/path or //server/share/path
        if root_path.startswith('smb://'):
            path_part = root_path[6:]  # Remove smb://
        elif root_path.startswith('//'):
            path_part = root_path[2:]  # Remove //
        else:
            path_part = root_path
        
        parts = path_part.split('/')
        server = parts[0]
        share_name = parts[1] if len(parts) > 1 else ''
        sub_path = '/'.join(parts[2:]) if len(parts) > 2 else ''
        
        if not share_name:
            logger.error(f"Invalid SMB path, no share specified: {root_path}")
            return ChangeSet(added=[], modified=[], deleted=[], scan_time=scan_time)
        
        def should_exclude(name: str) -> bool:
            if not exclude_patterns:
                return False
            for pattern in exclude_patterns:
                if fnmatch.fnmatch(name, pattern):
                    return True
            return False
        
        current_files: Dict[str, FileState] = {}
        
        try:
            # Create SMB connection (use empty strings for guest access)
            username = smb_username or ''
            password = smb_password or ''
            client_name = socket.gethostname()[:15]  # NetBIOS name limit
            
            conn = SMBConnection(
                username, password, 
                client_name, server,
                use_ntlm_v2=True, 
                is_direct_tcp=True
            )
            
            if not conn.connect(server, 445, timeout=30):
                logger.error(f"Failed to connect to SMB server: {server}")
                return ChangeSet(added=[], modified=[], deleted=[], scan_time=scan_time)
            
            logger.info(f"Connected to SMB server {server}, scanning share '{share_name}'")
            
            def scan_smb_directory(smb_sub_path: str, depth: int):
                if depth > max_depth:
                    return
                
                try:
                    # List files in directory
                    path_to_list = f"/{smb_sub_path}" if smb_sub_path else "/"
                    files = conn.listPath(share_name, path_to_list)
                    
                    for f in files:
                        # Skip . and ..
                        if f.filename in ['.', '..']:
                            continue
                        
                        if should_exclude(f.filename):
                            continue
                        
                        # Build path for this entry
                        entry_path = f"{smb_sub_path}/{f.filename}" if smb_sub_path else f.filename
                        
                        if f.isDirectory:
                            if recursive:
                                scan_smb_directory(entry_path, depth + 1)
                        else:
                            # Check extension filter
                            ext = Path(f.filename).suffix.lower()
                            if file_extensions and ext not in file_extensions:
                                continue
                            
                            # Create unique path identifier
                            file_key = f"//{server}/{share_name}/{entry_path}"
                            
                            current_files[file_key] = FileState(
                                path=file_key,
                                mtime=f.last_write_time,
                                size=f.file_size,
                            )
                
                except Exception as e:
                    logger.error(f"Error scanning SMB directory {smb_sub_path}: {e}")
            
            # Start scanning from sub_path or root
            scan_smb_directory(sub_path, 0)
            conn.close()
            
        except Exception as e:
            logger.error(f"SMB scan failed for {root_path}: {e}")
            return ChangeSet(added=[], modified=[], deleted=[], scan_time=scan_time)
        
        current_paths = set(current_files.keys())
        
        # Determine changes
        added = list(current_paths - old_paths)
        deleted = list(old_paths - current_paths)
        
        # Check for modifications
        modified = []
        for path in current_paths & old_paths:
            old_file = old_state[path]
            new_file = current_files[path]
            if old_file.mtime != new_file.mtime or old_file.size != new_file.size:
                modified.append(path)
        
        # Update state
        self._states[share_id] = current_files
        self.save_state(share_id)
        
        change_set = ChangeSet(
            added=added,
            modified=modified,
            deleted=deleted,
            scan_time=scan_time
        )
        
        if change_set.has_changes:
            logger.info(
                f"SMB change scan for {share_id}: "
                f"+{len(added)} added, ~{len(modified)} modified, -{len(deleted)} deleted"
            )
        else:
            logger.debug(f"SMB change scan for {share_id}: no changes detected")
        
        return change_set
    
    def get_incremental_files(
        self,
        share_id: str,
        root_path: str,
        since: Optional[datetime] = None,
        **scan_kwargs
    ) -> List[str]:
        """
        Get files that have changed since a specific time.
        
        This is useful for incremental indexing after a full scan has been done.
        
        Args:
            share_id: Share identifier
            root_path: Root path to scan
            since: Only return files modified since this time
            **scan_kwargs: Additional arguments passed to scan_for_changes
        
        Returns:
            List of file paths that need to be (re-)indexed
        """
        change_set = self.scan_for_changes(share_id, root_path, **scan_kwargs)
        
        # Return all added and modified files
        files_to_index = change_set.added + change_set.modified
        
        # If since is provided, also filter by modification time
        if since:
            since_timestamp = since.timestamp()
            filtered = []
            for path in files_to_index:
                try:
                    if Path(path).stat().st_mtime >= since_timestamp:
                        filtered.append(path)
                except OSError:
                    pass
            files_to_index = filtered
        
        return files_to_index
    
    def get_deleted_files(self, share_id: str, root_path: str, **scan_kwargs) -> List[str]:
        """
        Get files that have been deleted since last scan.
        
        Returns:
            List of file paths that no longer exist
        """
        change_set = self.scan_for_changes(share_id, root_path, **scan_kwargs)
        return change_set.deleted


# Global instance
folder_change_monitor = FolderChangeMonitor()
