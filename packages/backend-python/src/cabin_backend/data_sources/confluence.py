"""
Confluence data source implementation.
Integrates with Confluence REST API to extract and index documentation.
"""

import asyncio
import aiohttp
import base64
from typing import Dict, Any, List, Optional, AsyncGenerator
from datetime import datetime
import logging

from .base import (
    DataSource, DataSourceInfo, DataSourceType, DataSourceCapability,
    DataSourceConnection, IndexingConfig, ExtractedDocument, DocumentSource,
    IndexingProgress, data_source_registry
)

logger = logging.getLogger(__name__)

class ConfluenceDataSource(DataSource):
    """Confluence data source for extracting wiki pages and documentation."""

    def __init__(self, connection: DataSourceConnection):
        super().__init__(connection)
        self._session: Optional[aiohttp.ClientSession] = None
        self._progress: Optional[IndexingProgress] = None

    def get_info(self) -> DataSourceInfo:
        """Return information about the Confluence data source."""
        return DataSourceInfo(
            type=DataSourceType.CONFLUENCE,
            name="Confluence Wiki",
            description="Extract and index pages from Confluence wiki spaces",
            capabilities=[
                DataSourceCapability.SPACE_DISCOVERY,
                DataSourceCapability.INCREMENTAL_SYNC,
                DataSourceCapability.ATTACHMENT_SUPPORT,
                DataSourceCapability.METADATA_EXTRACTION,
                DataSourceCapability.SEARCH_FILTERING
            ],
            config_schema={
                "type": "object",
                "properties": {
                    "base_url": {
                        "type": "string",
                        "description": "Confluence base URL (e.g., https://company.atlassian.net/wiki)",
                        "required": True
                    },
                    "username": {
                        "type": "string",
                        "description": "Confluence username or email"
                    },
                    "password": {
                        "type": "string",
                        "description": "Confluence password or API token",
                        "format": "password"
                    },
                    "spaces": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of space keys to index (leave empty for all spaces)"
                    },
                    "max_items": {
                        "type": "integer",
                        "default": 1000,
                        "description": "Maximum number of pages to index"
                    },
                    "include_attachments": {
                        "type": "boolean",
                        "default": False,
                        "description": "Whether to index page attachments"
                    }
                }
            },
            connection_required=True
        )

    async def _get_session(self) -> aiohttp.ClientSession:
        """Get or create an HTTP session with authentication."""
        if self._session is None:
            auth_header = None
            if self.connection.username and self.connection.password:
                # Basic authentication
                credentials = f"{self.connection.username}:{self.connection.password}"
                auth_header = base64.b64encode(credentials.encode()).decode()
            elif self.connection.api_token:
                # Bearer token authentication
                auth_header = f"Bearer {self.connection.api_token}"

            headers = {
                "Content-Type": "application/json",
                "Accept": "application/json"
            }
            if auth_header:
                if self.connection.api_token:
                    headers["Authorization"] = auth_header
                else:
                    headers["Authorization"] = f"Basic {auth_header}"

            self._session = aiohttp.ClientSession(headers=headers)

        return self._session

    async def test_connection(self) -> bool:
        """Test if the connection to Confluence is valid."""
        try:
            session = await self._get_session()
            url = f"{self.connection.base_url}/rest/api/user/current"
            async with session.get(url) as response:
                return response.status == 200
        except Exception as e:
            logger.error(f"Connection test failed: {e}")
            return False

    async def discover_sources(self) -> List[Dict[str, Any]]:
        """Discover all available Confluence spaces."""
        try:
            session = await self._get_session()
            url = f"{self.connection.base_url}/rest/api/space"

            spaces = []
            start = 0
            limit = 50

            while True:
                params = {"start": start, "limit": limit}
                async with session.get(url, params=params) as response:
                    if response.status != 200:
                        break

                    data = await response.json()
                    results = data.get("results", [])

                    for space in results:
                        spaces.append({
                            "id": space["key"],
                            "name": space["name"],
                            "type": space.get("type", "global"),
                            "description": space.get("description", {}).get("plain", {}).get("value", ""),
                            "url": f"{self.connection.base_url}/spaces/{space['key']}"
                        })

                    # Check if there are more results
                    if len(results) < limit:
                        break
                    start += limit

            return spaces

        except Exception as e:
            logger.error(f"Failed to discover spaces: {e}")
            return []

    async def extract_documents(
        self,
        source_ids: List[str],
        config: IndexingConfig
    ) -> AsyncGenerator[ExtractedDocument, None]:
        """Extract documents from specified Confluence spaces."""
        try:
            session = await self._get_session()

            # Initialize progress tracking
            if self._job_id:
                self._progress = IndexingProgress(
                    job_id=self._job_id,
                    status="running",
                    started_at=datetime.now()
                )

            total_pages = 0
            processed_pages = 0

            # If no source_ids provided, get all spaces
            if not source_ids:
                spaces = await self.discover_sources()
                source_ids = [space["id"] for space in spaces]

            # First pass: count total pages for progress tracking
            for space_key in source_ids:
                try:
                    url = f"{self.connection.base_url}/rest/api/content"
                    params = {
                        "spaceKey": space_key,
                        "type": "page",
                        "status": "current",
                        "limit": 1  # Just to get the total count
                    }
                    async with session.get(url, params=params) as response:
                        if response.status == 200:
                            data = await response.json()
                            total_pages += min(data.get("size", 0), config.max_items)
                except Exception as e:
                    logger.warning(f"Failed to count pages in space {space_key}: {e}")

            # Update progress with total
            if self._progress:
                self._progress.total_items = total_pages

            # Second pass: actually extract documents
            for space_key in source_ids:
                if processed_pages >= config.max_items:
                    break

                try:
                    # Get pages from this space
                    async for document in self._extract_space_pages(session, space_key, config, processed_pages):
                        processed_pages += 1

                        # Update progress
                        if self._progress:
                            self._progress.processed_items = processed_pages
                            self._progress.current_item = document.title

                        yield document

                        if processed_pages >= config.max_items:
                            break

                except Exception as e:
                    logger.error(f"Failed to extract from space {space_key}: {e}")

            # Mark as completed
            if self._progress:
                self._progress.status = "completed"
                self._progress.completed_at = datetime.now()

        except Exception as e:
            logger.error(f"Document extraction failed: {e}")
            if self._progress:
                self._progress.status = "failed"
                self._progress.error_message = str(e)
                self._progress.completed_at = datetime.now()
        finally:
            if self._session:
                await self._session.close()
                self._session = None

    async def _extract_space_pages(
        self,
        session: aiohttp.ClientSession,
        space_key: str,
        config: IndexingConfig,
        start_count: int
    ) -> AsyncGenerator[ExtractedDocument, None]:
        """Extract all pages from a specific space."""
        start = 0
        limit = 25

        while True:
            try:
                url = f"{self.connection.base_url}/rest/api/content"
                params = {
                    "spaceKey": space_key,
                    "type": "page",
                    "status": "current",
                    "start": start,
                    "limit": limit,
                    "expand": "body.storage,version,space,metadata.labels"
                }

                async with session.get(url, params=params) as response:
                    if response.status != 200:
                        logger.warning(f"Failed to fetch pages from space {space_key}: HTTP {response.status}")
                        break

                    data = await response.json()
                    results = data.get("results", [])

                    if not results:
                        break

                    for page in results:
                        try:
                            # Extract page content
                            content = ""
                            body = page.get("body", {}).get("storage", {})
                            if body:
                                content = body.get("value", "")

                            # Extract metadata
                            space_info = page.get("space", {})
                            version_info = page.get("version", {})
                            labels = page.get("metadata", {}).get("labels", {}).get("results", [])

                            metadata = {
                                "page_id": page["id"],
                                "space_key": space_key,
                                "space_name": space_info.get("name", ""),
                                "version": version_info.get("number", 1),
                                "created_by": version_info.get("by", {}).get("displayName", ""),
                                "last_modified": version_info.get("when", ""),
                                "labels": [label.get("name", "") for label in labels],
                                "page_type": page.get("type", "page")
                            }

                            # Create document source
                            source = DocumentSource(
                                source_type=DataSourceType.CONFLUENCE,
                                source_id=space_key,
                                source_url=f"{self.connection.base_url}/spaces/{space_key}/pages/{page['id']}",
                                title=page["title"],
                                last_modified=datetime.fromisoformat(
                                    version_info.get("when", "").replace("Z", "+00:00")
                                ) if version_info.get("when") else None,
                                metadata=metadata
                            )

                            # Create extracted document
                            document = ExtractedDocument(
                                id=f"confluence_{space_key}_{page['id']}",
                                title=page["title"],
                                content=content,
                                source=source,
                                metadata=metadata
                            )

                            yield document

                        except Exception as e:
                            logger.error(f"Failed to process page {page.get('id', 'unknown')}: {e}")

                    # Check if we've reached the limit or there are no more pages
                    if len(results) < limit:
                        break

                    start += limit

            except Exception as e:
                logger.error(f"Failed to fetch pages from space {space_key}: {e}")
                break

    def get_progress(self, job_id: str) -> Optional[IndexingProgress]:
        """Get the progress of an indexing job."""
        if job_id == self._job_id and self._progress:
            return self._progress
        return None

# Register the Confluence data source
data_source_registry.register(DataSourceType.CONFLUENCE, ConfluenceDataSource)