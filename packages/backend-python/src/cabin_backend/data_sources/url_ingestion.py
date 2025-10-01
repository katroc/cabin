"""
URL ingestion data source implementation.
Fetches and processes web pages from URLs with content extraction and metadata.
"""

import asyncio
import logging
import uuid
from datetime import datetime
from typing import AsyncGenerator, Dict, Any, List, Optional
from urllib.parse import urlparse
import aiohttp
from bs4 import BeautifulSoup

from .base import (
    DataSource, DataSourceInfo, DataSourceType, DataSourceCapability,
    DataSourceConnection, IndexingConfig, ExtractedDocument, DocumentSource,
    IndexingProgress, data_source_registry
)

logger = logging.getLogger(__name__)


class URLIngestionDataSource(DataSource):
    """Data source for ingesting web pages from URLs."""

    # Limits
    MAX_CONTENT_SIZE = 10 * 1024 * 1024  # 10MB
    MAX_URLS_PER_BATCH = 20
    REQUEST_TIMEOUT = 30  # seconds

    def __init__(self, connection: DataSourceConnection):
        super().__init__(connection)
        self._progress: Optional[IndexingProgress] = None
        self._urls: List[str] = []

    def get_info(self) -> DataSourceInfo:
        """Return information about the URL ingestion data source."""
        return DataSourceInfo(
            type=DataSourceType.URL_INGESTION,
            name="URL Ingestion",
            description="Fetch and index web pages from URLs",
            capabilities=[
                DataSourceCapability.METADATA_EXTRACTION,
            ],
            config_schema={
                "type": "object",
                "properties": {
                    "max_urls": {
                        "type": "integer",
                        "default": self.MAX_URLS_PER_BATCH,
                        "description": f"Maximum number of URLs per batch (default: {self.MAX_URLS_PER_BATCH})"
                    },
                    "timeout": {
                        "type": "integer",
                        "default": self.REQUEST_TIMEOUT,
                        "description": f"Request timeout in seconds (default: {self.REQUEST_TIMEOUT})"
                    }
                }
            },
            connection_required=False
        )

    async def test_connection(self) -> bool:
        """Test if URL fetching is available."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get('https://www.example.com', timeout=aiohttp.ClientTimeout(total=5)) as response:
                    return response.status == 200
        except Exception as e:
            logger.error(f"URL ingestion test failed: {e}")
            return False

    async def discover_sources(self) -> List[Dict[str, Any]]:
        """Return information about added URLs."""
        sources = []
        for url in self._urls:
            sources.append({
                "id": url,
                "name": url,
                "type": "url",
                "url": url,
                "supported": True
            })
        return sources

    def add_url(self, url: str) -> bool:
        """
        Add a URL for processing.
        Returns True if URL is valid and added, False otherwise.
        """
        try:
            # Validate URL format
            parsed = urlparse(url)
            if not parsed.scheme in ['http', 'https']:
                logger.warning(f"Invalid URL scheme: {url}")
                return False

            if not parsed.netloc:
                logger.warning(f"Invalid URL (no domain): {url}")
                return False

            # Check batch limits
            if len(self._urls) >= self.MAX_URLS_PER_BATCH:
                logger.warning(f"Too many URLs in batch (max {self.MAX_URLS_PER_BATCH})")
                return False

            # Avoid duplicates
            if url in self._urls:
                logger.warning(f"URL already added: {url}")
                return False

            self._urls.append(url)
            logger.info(f"Added URL for processing: {url}")
            return True

        except Exception as e:
            logger.error(f"Failed to add URL {url}: {e}")
            return False

    async def _fetch_url_content(self, session: aiohttp.ClientSession, url: str) -> Optional[Dict[str, Any]]:
        """Fetch and parse content from a URL."""
        try:
            timeout = aiohttp.ClientTimeout(total=self.REQUEST_TIMEOUT)
            headers = {
                'User-Agent': 'Mozilla/5.0 (compatible; CabinBot/1.0; +https://github.com/cabin)'
            }

            async with session.get(url, timeout=timeout, headers=headers) as response:
                if response.status != 200:
                    logger.warning(f"Failed to fetch {url}: HTTP {response.status}")
                    return None

                content_type = response.headers.get('Content-Type', '')
                if 'text/html' not in content_type:
                    logger.warning(f"Skipping non-HTML content: {url} ({content_type})")
                    return None

                html_content = await response.text()

                if len(html_content) > self.MAX_CONTENT_SIZE:
                    logger.warning(f"Content too large for {url}, truncating")
                    html_content = html_content[:self.MAX_CONTENT_SIZE]

                # Parse HTML and extract content
                soup = BeautifulSoup(html_content, 'html.parser')

                # Remove script and style elements
                for script in soup(["script", "style", "nav", "footer", "aside"]):
                    script.decompose()

                # Extract title
                title = soup.title.string.strip() if soup.title and soup.title.string else urlparse(url).path

                # Extract meta description
                description = ""
                meta_desc = soup.find("meta", attrs={"name": "description"})
                if meta_desc and meta_desc.get("content"):
                    description = meta_desc["content"].strip()

                # Extract headings
                headings = []
                for heading in soup.find_all(['h1', 'h2', 'h3']):
                    heading_text = heading.get_text(strip=True)
                    if heading_text:
                        headings.append(heading_text)

                # Extract main text content
                # Try to find main content areas first
                main_content = soup.find('main') or soup.find('article') or soup.find('body')
                text_content = main_content.get_text(separator='\n', strip=True) if main_content else ""

                # Clean up whitespace
                text_content = '\n'.join(line.strip() for line in text_content.split('\n') if line.strip())

                return {
                    'url': url,
                    'title': title,
                    'description': description,
                    'headings': headings,
                    'content': text_content,
                    'fetched_at': datetime.now(),
                    'content_length': len(text_content)
                }

        except asyncio.TimeoutError:
            logger.error(f"Timeout fetching {url}")
            return None
        except Exception as e:
            logger.error(f"Error fetching {url}: {e}")
            return None

    async def extract_documents(
        self,
        source_ids: List[str],
        config: IndexingConfig
    ) -> AsyncGenerator[ExtractedDocument, None]:
        """Extract documents from URLs."""
        logger.info(f"Starting document extraction from {len(self._urls)} URLs")

        try:
            # Initialize progress tracking
            if self._job_id:
                self._progress = IndexingProgress(
                    job_id=self._job_id,
                    status="running",
                    started_at=datetime.now(),
                    total_items=len(self._urls)
                )

            processed_count = 0

            # Filter URLs if source_ids provided
            urls_to_process = self._urls
            if source_ids:
                urls_to_process = [url for url in self._urls if url in source_ids]
                logger.info(f"Filtered to {len(urls_to_process)} URLs based on source_ids")

            # Fetch URLs
            async with aiohttp.ClientSession() as session:
                for url in urls_to_process:
                    if processed_count >= config.max_items:
                        break

                    try:
                        # Update progress
                        if self._progress:
                            self._progress.processed_items = processed_count
                            self._progress.current_item = url

                        logger.info(f"Fetching URL: {url}")
                        url_data = await self._fetch_url_content(session, url)

                        if not url_data or not url_data.get('content'):
                            logger.warning(f"No content extracted from {url}, skipping")
                            continue

                        # Create document ID
                        document_id = f"url_{uuid.uuid4().hex[:12]}"

                        # Create document source
                        source = DocumentSource(
                            source_type=DataSourceType.URL_INGESTION,
                            source_id="url_ingestion",
                            source_url=url,
                            title=url_data['title'],
                            last_modified=url_data['fetched_at'],
                            metadata={
                                "url": url,
                                "description": url_data['description'],
                                "headings": url_data['headings'],
                                "content_length": url_data['content_length'],
                                "fetched_at": url_data['fetched_at'].isoformat()
                            }
                        )

                        # Prepare metadata
                        doc_metadata = {
                            "document_id": document_id,
                            "url": url,
                            "source_url": url,
                            "page_title": url_data['title'],
                            "title": url_data['title'],
                            "description": url_data['description'],
                            "headings": url_data['headings'],
                            "content_type": "web_page",
                            "source_type": "url_ingestion",
                            "content_length": url_data['content_length'],
                            "fetched_at": url_data['fetched_at'].isoformat(),
                            "domain": urlparse(url).netloc,
                            "is_boilerplate": False,
                        }

                        yield ExtractedDocument(
                            id=document_id,
                            title=url_data['title'],
                            content=url_data['content'],
                            source=source,
                            metadata=doc_metadata
                        )

                        processed_count += 1
                        logger.info(f"Successfully processed {url}, total processed: {processed_count}")

                    except Exception as e:
                        logger.error(f"Failed to process URL {url}: {e}")
                        if self._progress:
                            if not self._progress.error_message:
                                self._progress.error_message = f"Failed to process {url}: {e}"

            # Mark as completed
            logger.info(f"Finished processing all URLs. Total processed: {processed_count}")
            if self._progress:
                self._progress.status = "completed"
                self._progress.completed_at = datetime.now()
                self._progress.processed_items = processed_count

        except Exception as e:
            logger.error(f"URL extraction failed: {e}")
            if self._progress:
                self._progress.status = "failed"
                self._progress.error_message = str(e)
                self._progress.completed_at = datetime.now()

    def get_progress(self, job_id: str) -> Optional[IndexingProgress]:
        """Get the progress of an indexing job."""
        if job_id == self._job_id and self._progress:
            return self._progress
        return None


# Register the URL ingestion data source
data_source_registry.register(DataSourceType.URL_INGESTION, URLIngestionDataSource)
