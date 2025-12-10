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
    
    def scan_for_changes(
        self,
        share_id: str,
        root_path: str,
        recursive: bool = True,
        max_depth: int = 10,
        file_extensions: Optional[Set[str]] = None,
        exclude_patterns: Optional[List[str]] = None,
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
        
        Returns:
            ChangeSet with added, modified, and deleted files
        """
        import fnmatch
        
        scan_time = datetime.now()
        
        # Load existing state
        old_state = self.load_state(share_id)
        old_paths = set(old_state.keys())
        
        # Scan current files
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
