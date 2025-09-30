"""
Confluence data source implementation.
Integrates with Confluence REST API to extract and index documentation.
"""

import asyncio
import base64
import logging
import re
from datetime import datetime
from typing import AsyncGenerator, Dict, Any, List, Optional, Tuple

import aiohttp
from aiohttp import ClientResponseError
from bs4 import BeautifulSoup, Comment

from .base import (
    DataSource, DataSourceInfo, DataSourceType, DataSourceCapability,
    DataSourceConnection, IndexingConfig, ExtractedDocument, DocumentSource,
    IndexingProgress, data_source_registry
)

logger = logging.getLogger(__name__)


MACRO_DROP_NAMES = {
    "children",
    "children-display",
    "pagetree",
    "pagetree2",
    "pageproperties",
    "pageproperty",
    "pagepropertyreport",
    "contentbylabel",
    "recently-updated",
    "toc",
    "toc-zone",
    "sidebar",
    "navigation",
    "blogposts",
}

DROP_CLASS_TOKENS = {
    "sidebar",
    "navigation",
    "nav",
    "breadcrumbs",
    "page-metadata",
    "metadata",
    "footer",
    "ia-secondary-content",
    "ia-splitter",
}

DROP_ID_TOKENS = {"sidebar", "navigation", "breadcrumbs", "footer"}

class ConfluenceDataSource(DataSource):
    """Confluence data source for extracting wiki pages and documentation."""

    def __init__(self, connection: DataSourceConnection):
        super().__init__(connection)
        self._session: Optional[aiohttp.ClientSession] = None
        self._progress: Optional[IndexingProgress] = None

    # ------------------------------------------------------------------
    # Normalization helpers
    # ------------------------------------------------------------------

    def _normalize_content(self, html: str) -> Tuple[str, Dict[str, Any]]:
        if not html:
            return "", {
                "removed_macros": 0,
                "removed_elements": 0,
                "word_count": 0,
                "text_preview": "",
                "headings": [],
            }

        soup = BeautifulSoup(html, "html.parser")

        removed_macros = 0
        removed_elements = 0

        # Extract headings before cleanup
        headings = []
        for heading_tag in soup.find_all(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']):
            heading_text = heading_tag.get_text(strip=True)
            if heading_text:
                headings.append(heading_text)

        for macro in list(soup.find_all(lambda tag: tag.name in {"ac:structured-macro", "ac:macro"})):
            macro_name = (macro.get("ac:name") or macro.get("data-macro-name") or "").lower()
            if macro_name in MACRO_DROP_NAMES:
                macro.decompose()
                removed_macros += 1

        for layout_tag in list(soup.find_all(lambda tag: tag.name in {"ac:layout", "ac:layout-section", "ac:layout-cell"})):
            layout_tag.unwrap()

        for tag in soup.find_all(["script", "style"]):
            tag.decompose()
            removed_elements += 1

        for comment in soup.find_all(string=lambda text: isinstance(text, Comment)):
            comment.extract()

        for tag in list(soup.find_all(True)):
            tag_name = tag.name or ""
            if tag_name in {"nav", "footer", "aside"}:
                tag.decompose()
                removed_elements += 1
                continue

            classes = " ".join(tag.get("class", [])).lower()
            identifier = (tag.get("id") or "").lower()
            if any(token in classes for token in DROP_CLASS_TOKENS) or any(token in identifier for token in DROP_ID_TOKENS):
                tag.decompose()
                removed_elements += 1
                continue

        for empty_tag in soup.find_all(lambda t: t.name in {"p", "span", "div"} and not t.get_text(strip=True)):
            empty_tag.decompose()

        normalized_html = str(soup)
        normalized_html = re.sub(r"\n{3,}", "\n\n", normalized_html)

        plain_text = soup.get_text(separator=" ", strip=True)
        word_count = len(plain_text.split()) if plain_text else 0
        preview = plain_text[:200]

        return normalized_html, {
            "removed_macros": removed_macros,
            "removed_elements": removed_elements,
            "word_count": word_count,
            "text_preview": preview,
            "headings": headings,
        }

    def _slugify_title(self, title: str) -> str:
        slug = re.sub(r"[^\w\-]+", "-", title.strip()).strip("-").lower()
        return slug or "page"

    def _build_page_url(self, space_key: str, page_id: str, title: str) -> str:
        base_url = self.connection.base_url.rstrip("/") if self.connection.base_url else ""
        slug = self._slugify_title(title)
        return f"{base_url}/spaces/{space_key}/pages/{page_id}/{slug}"

    def _parse_datetime(self, value: Optional[str]) -> Optional[datetime]:
        if not value:
            return None
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            logger.debug("Failed to parse datetime value '%s'", value)
            return None

    async def _get_json_with_retry(
        self,
        session: aiohttp.ClientSession,
        url: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        max_retries: int = 3,
        backoff_base: float = 0.5,
    ) -> Tuple[int, Optional[Dict[str, Any]]]:
        attempt = 0
        delay = backoff_base
        last_error: Optional[Exception] = None

        while attempt < max_retries:
            try:
                async with session.get(url, params=params) as response:
                    status = response.status
                    content_type = response.headers.get("Content-Type", "")

                    if status >= 500 or status == 429:
                        raise ClientResponseError(
                            response.request_info,
                            response.history,
                            status=status,
                            message=f"Upstream error {status}",
                            headers=response.headers,
                        )

                    if "application/json" in content_type.lower():
                        data = await response.json()
                    else:
                        body = await response.text()
                        data = {"body": body}

                    return status, data

            except Exception as exc:  # pragma: no cover - network error path
                last_error = exc
                attempt += 1
                if attempt >= max_retries:
                    break
                logger.warning(
                    "Retrying Confluence request %s (attempt %d/%d) due to %s",
                    url,
                    attempt,
                    max_retries,
                    exc,
                )
                await asyncio.sleep(delay)
                delay *= 2

        if last_error:
            raise last_error
        raise RuntimeError(f"Failed to fetch {url}")

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
                        "limit": 1,
                    }
                    status, data = await self._get_json_with_retry(session, url, params=params)
                    if status == 200 and isinstance(data, dict):
                        total_pages += min(data.get("size", 0), config.max_items)
                    else:
                        logger.warning(
                            "Unexpected status while counting pages in space %s: HTTP %s",
                            space_key,
                            status,
                        )
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
            url = f"{self.connection.base_url}/rest/api/content"
            params = {
                "spaceKey": space_key,
                "type": "page",
                "status": "current",
                "start": start,
                "limit": limit,
                "expand": "body.storage,version,space,metadata.labels",
            }

            try:
                status, data = await self._get_json_with_retry(session, url, params=params)
            except Exception as exc:
                logger.error(f"Failed to fetch pages from space {space_key}: {exc}")
                break

            if status != 200 or not isinstance(data, dict):
                logger.warning(
                    "Failed to fetch pages from space %s: HTTP %s",
                    space_key,
                    status,
                )
                break

            results = data.get("results", [])
            if not results:
                break

            for page in results:
                try:
                    body = page.get("body", {}).get("storage", {})
                    raw_content = body.get("value", "") if body else ""
                    normalized_content, normalization_stats = self._normalize_content(raw_content)

                    if not normalized_content.strip():
                        logger.debug(
                            "Skipping page %s because normalized content is empty",
                            page.get("id"),
                        )
                        continue

                    space_info = page.get("space", {})
                    version_info = page.get("version", {})
                    labels = page.get("metadata", {}).get("labels", {}).get("results", [])
                    version_number = version_info.get("number", 1)
                    updated_at_raw = version_info.get("when", "")
                    updated_at = self._parse_datetime(updated_at_raw)

                    page_url = self._build_page_url(space_key, page["id"], page["title"])

                    # Extract label names for keywords
                    label_names = [label.get("name", "") for label in labels if label.get("name")]

                    metadata = {
                        "page_id": page["id"],
                        "page_version": version_number,
                        "space_key": space_key,
                        "space_name": space_info.get("name", ""),
                        "page_title": page["title"],  # Used by metadata enrichment
                        "title": page["title"],
                        "slug": self._slugify_title(page["title"]),
                        "url": page_url,
                        "source_url": page_url,
                        "labels": label_names,
                        "keywords": label_names,  # Map labels to keywords for metadata enrichment
                        "content_type": page.get("type", "page"),
                        "author": version_info.get("by", {}).get("displayName", ""),  # Map created_by to author
                        "created_by": version_info.get("by", {}).get("displayName", ""),
                        "last_modified": updated_at_raw,
                        "updated_at": updated_at_raw,
                        "headings": normalization_stats.get("headings", []),  # For metadata enrichment
                        "word_count": normalization_stats.get("word_count", 0),
                        "removed_macros": normalization_stats.get("removed_macros", 0),
                        "removed_elements": normalization_stats.get("removed_elements", 0),
                        "text_preview": normalization_stats.get("text_preview", ""),
                        "raw_bytes": len(raw_content.encode("utf-8")) if raw_content else 0,
                        "normalized_bytes": len(normalized_content.encode("utf-8")),
                        "is_archived": page.get("status") == "archived",
                        "is_boilerplate": False,
                        "document_id": f"{page['id']}:{version_number}",
                    }

                    document_id = metadata["document_id"]

                    source = DocumentSource(
                        source_type=DataSourceType.CONFLUENCE,
                        source_id=space_key,
                        source_url=page_url,
                        title=page["title"],
                        last_modified=updated_at,
                        metadata=metadata,
                    )

                    document = ExtractedDocument(
                        id=document_id,
                        title=page["title"],
                        content=normalized_content,
                        source=source,
                        metadata=metadata,
                    )

                    logger.debug(
                        "Confluence page %s (v%s) normalized: %s words, %s macros removed, %s containers removed",
                        page["id"],
                        version_number,
                        metadata.get("word_count"),
                        normalization_stats.get("removed_macros"),
                        normalization_stats.get("removed_elements"),
                    )

                    yield document

                except Exception as e:
                    logger.error(f"Failed to process page {page.get('id', 'unknown')}: {e}")

            if len(results) < limit:
                break

            start += limit

    def get_progress(self, job_id: str) -> Optional[IndexingProgress]:
        """Get the progress of an indexing job."""
        if job_id == self._job_id and self._progress:
            return self._progress
        return None

# Register the Confluence data source
data_source_registry.register(DataSourceType.CONFLUENCE, ConfluenceDataSource)
