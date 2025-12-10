"""
Google Drive data source implementation.
Integrates with Google Drive API to extract and index documents using OAuth2 authentication.
"""

import asyncio
import io
import logging
import os
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, List, Optional

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

from .base import (
    DataSource,
    DataSourceCapability,
    DataSourceConnection,
    DataSourceInfo,
    DataSourceType,
    DocumentSource,
    ExtractedDocument,
    IndexingConfig,
    IndexingProgress,
    data_source_registry,
)
from .document_parsers import document_parser_registry

logger = logging.getLogger(__name__)

# OAuth2 scopes - readonly access to Drive
SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

# Supported MIME types and their export formats
GOOGLE_WORKSPACE_EXPORTS = {
    "application/vnd.google-apps.document": ("text/plain", ".txt"),      # Google Docs -> Plain text
    "application/vnd.google-apps.spreadsheet": ("text/csv", ".csv"),     # Google Sheets -> CSV
    "application/vnd.google-apps.presentation": ("text/plain", ".txt"),  # Google Slides -> Plain text
}

# Binary file types we can download directly
DOWNLOADABLE_TYPES = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "text/plain": ".txt",
    "text/markdown": ".md",
    "text/html": ".html",
    "text/csv": ".csv",
}


class GoogleDriveDataSource(DataSource):
    """Google Drive data source for extracting documents using OAuth2."""

    def __init__(self, connection: DataSourceConnection):
        super().__init__(connection)
        self._credentials: Optional[Credentials] = None
        self._service = None
        self._progress: Dict[str, IndexingProgress] = {}
        
        # OAuth credentials from connection config
        self._client_id = connection.additional_config.get("client_id")
        self._client_secret = connection.additional_config.get("client_secret")
        self._refresh_token = connection.additional_config.get("refresh_token")
        self._access_token = connection.additional_config.get("access_token")

    def get_info(self) -> DataSourceInfo:
        """Return information about the Google Drive data source."""
        return DataSourceInfo(
            type=DataSourceType.GOOGLE_DRIVE,
            name="Google Drive",
            description="Import and index documents from Google Drive folders",
            capabilities=[
                DataSourceCapability.SPACE_DISCOVERY,
                DataSourceCapability.ATTACHMENT_SUPPORT,
                DataSourceCapability.METADATA_EXTRACTION,
            ],
            config_schema={
                "type": "object",
                "properties": {
                    "client_id": {
                        "type": "string",
                        "description": "OAuth2 Client ID from Google Cloud Console"
                    },
                    "client_secret": {
                        "type": "string", 
                        "description": "OAuth2 Client Secret"
                    },
                    "refresh_token": {
                        "type": "string",
                        "description": "OAuth2 refresh token (obtained after user consent)"
                    },
                    "folder_id": {
                        "type": "string",
                        "description": "Specific folder ID to index (optional, defaults to root)"
                    },
                    "include_shared": {
                        "type": "boolean",
                        "description": "Include files shared with the user",
                        "default": True
                    }
                },
                "required": ["client_id", "client_secret"]
            },
            connection_required=True
        )

    def _get_credentials(self) -> Optional[Credentials]:
        """Build OAuth2 credentials from stored tokens."""
        if self._credentials and self._credentials.valid:
            return self._credentials
            
        # Try to build credentials from refresh token
        if self._refresh_token and self._client_id and self._client_secret:
            try:
                self._credentials = Credentials(
                    token=self._access_token,
                    refresh_token=self._refresh_token,
                    token_uri="https://oauth2.googleapis.com/token",
                    client_id=self._client_id,
                    client_secret=self._client_secret,
                    scopes=SCOPES
                )
                
                # Refresh if expired
                if self._credentials.expired:
                    self._credentials.refresh(Request())
                    
                return self._credentials
            except Exception as e:
                logger.error(f"Failed to build credentials: {e}")
                return None
                
        return None

    def _get_service(self):
        """Get or create the Google Drive service."""
        if self._service:
            return self._service
            
        credentials = self._get_credentials()
        if not credentials:
            raise ValueError("No valid credentials available")
            
        self._service = build("drive", "v3", credentials=credentials)
        return self._service

    async def test_connection(self) -> bool:
        """Test if the connection to Google Drive is valid."""
        try:
            service = self._get_service()
            
            # Try to get user info to verify connection
            about = service.about().get(fields="user").execute()
            user_email = about.get("user", {}).get("emailAddress", "Unknown")
            logger.info(f"Google Drive connection successful for: {user_email}")
            return True
            
        except Exception as e:
            logger.error(f"Google Drive connection test failed: {e}")
            return False

    async def discover_sources(self) -> List[Dict[str, Any]]:
        """Discover available folders and shared drives."""
        try:
            service = self._get_service()
            sources = []
            
            # Get root folder info
            root = service.files().get(
                fileId="root",
                fields="id,name"
            ).execute()
            
            sources.append({
                "id": root["id"],
                "name": "My Drive (Root)",
                "type": "folder",
                "description": "Your entire Google Drive"
            })
            
            # List top-level folders
            results = service.files().list(
                q="'root' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false",
                pageSize=50,
                fields="files(id, name, mimeType)"
            ).execute()
            
            for folder in results.get("files", []):
                sources.append({
                    "id": folder["id"],
                    "name": folder["name"],
                    "type": "folder",
                    "description": f"Folder: {folder['name']}"
                })
            
            # List shared drives if available
            try:
                shared_drives = service.drives().list(pageSize=20).execute()
                for drive in shared_drives.get("drives", []):
                    sources.append({
                        "id": drive["id"],
                        "name": drive["name"],
                        "type": "shared_drive",
                        "description": f"Shared Drive: {drive['name']}"
                    })
            except Exception as e:
                logger.debug(f"Could not list shared drives (may not have access): {e}")
            
            logger.info(f"Discovered {len(sources)} sources from Google Drive")
            return sources
            
        except Exception as e:
            logger.error(f"Failed to discover Google Drive sources: {e}")
            raise

    async def extract_documents(
        self,
        source_ids: List[str],
        config: IndexingConfig
    ) -> AsyncGenerator[ExtractedDocument, None]:
        """Extract documents from specified Google Drive folders."""
        try:
            service = self._get_service()
            processed_count = 0
            
            for source_id in source_ids:
                async for doc in self._extract_folder_documents(
                    service, source_id, config, processed_count
                ):
                    yield doc
                    processed_count += 1
                    
                    if config.max_items and processed_count >= config.max_items:
                        logger.info(f"Reached max items limit: {config.max_items}")
                        return
                        
        except Exception as e:
            logger.error(f"Error extracting documents: {e}")
            raise

    async def _extract_folder_documents(
        self,
        service,
        folder_id: str,
        config: IndexingConfig,
        start_count: int
    ) -> AsyncGenerator[ExtractedDocument, None]:
        """Extract all documents from a folder recursively."""
        page_token = None
        
        while True:
            # Query for files in this folder
            query = f"'{folder_id}' in parents and trashed=false"
            
            try:
                results = service.files().list(
                    q=query,
                    pageSize=100,
                    pageToken=page_token,
                    fields="nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink, parents, size)"
                ).execute()
                
                files = results.get("files", [])
                
                for file_info in files:
                    mime_type = file_info.get("mimeType", "")
                    
                    # Handle folders recursively
                    if mime_type == "application/vnd.google-apps.folder":
                        async for doc in self._extract_folder_documents(
                            service, file_info["id"], config, start_count
                        ):
                            yield doc
                        continue
                    
                    # Try to extract document
                    try:
                        doc = await self._extract_single_document(service, file_info)
                        if doc:
                            yield doc
                    except Exception as e:
                        logger.warning(f"Failed to extract {file_info.get('name')}: {e}")
                        continue
                
                page_token = results.get("nextPageToken")
                if not page_token:
                    break
                    
                # Small delay to avoid rate limiting
                await asyncio.sleep(0.1)
                
            except Exception as e:
                logger.error(f"Error listing folder {folder_id}: {e}")
                break

    async def _extract_single_document(
        self,
        service,
        file_info: Dict[str, Any]
    ) -> Optional[ExtractedDocument]:
        """Extract content from a single file."""
        file_id = file_info["id"]
        file_name = file_info.get("name", "Untitled")
        mime_type = file_info.get("mimeType", "")
        
        logger.debug(f"Extracting: {file_name} ({mime_type})")
        
        content = ""
        
        # Handle Google Workspace documents (need export)
        if mime_type in GOOGLE_WORKSPACE_EXPORTS:
            export_mime, ext = GOOGLE_WORKSPACE_EXPORTS[mime_type]
            try:
                request = service.files().export_media(
                    fileId=file_id,
                    mimeType=export_mime
                )
                content = request.execute().decode("utf-8")
            except Exception as e:
                logger.warning(f"Failed to export {file_name}: {e}")
                return None
                
        # Handle downloadable binary files
        elif mime_type in DOWNLOADABLE_TYPES:
            ext = DOWNLOADABLE_TYPES[mime_type]
            try:
                request = service.files().get_media(fileId=file_id)
                file_data = io.BytesIO()
                downloader = MediaIoBaseDownload(file_data, request)
                
                done = False
                while not done:
                    _, done = downloader.next_chunk()
                
                file_data.seek(0)
                
                # Write to temp file and use document parser
                with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
                    tmp.write(file_data.read())
                    tmp_path = Path(tmp.name)
                
                try:
                    content, metadata = document_parser_registry.parse_document(tmp_path)
                finally:
                    os.unlink(tmp_path)
                    
            except Exception as e:
                logger.warning(f"Failed to download {file_name}: {e}")
                return None
        else:
            # Unsupported file type
            logger.debug(f"Skipping unsupported type: {mime_type}")
            return None
        
        if not content or not content.strip():
            logger.debug(f"No content extracted from {file_name}")
            return None
        
        # Parse modified time
        modified_time = None
        if file_info.get("modifiedTime"):
            try:
                modified_time = datetime.fromisoformat(
                    file_info["modifiedTime"].replace("Z", "+00:00")
                )
            except Exception:
                pass
        
        return ExtractedDocument(
            id=file_id,
            title=file_name,
            content=content,
            source=DocumentSource(
                source_type=DataSourceType.GOOGLE_DRIVE,
                source_id=file_info.get("parents", ["root"])[0],
                source_url=file_info.get("webViewLink", ""),
                title=file_name,
                last_modified=modified_time,
                metadata={
                    "mime_type": mime_type,
                    "file_id": file_id,
                    "size": file_info.get("size"),
                }
            ),
            metadata={
                "source_type": "google_drive",
                "mime_type": mime_type,
                "web_view_link": file_info.get("webViewLink", ""),
            }
        )

    def get_progress(self, job_id: str) -> Optional[IndexingProgress]:
        """Get the progress of an indexing job."""
        return self._progress.get(job_id)


# Register the Google Drive data source
data_source_registry.register(DataSourceType.GOOGLE_DRIVE, GoogleDriveDataSource)
