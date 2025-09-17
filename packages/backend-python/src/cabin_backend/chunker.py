import re
import uuid
from typing import Iterable, List, Optional, Tuple

from bs4 import BeautifulSoup, NavigableString, Tag

from .config import settings
from .models import ChildChunk, DocumentMetadata, IngestRequest, ParentChunk


HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
BLOCK_TAGS = {"p", "pre", "code", "blockquote", "li", "table", "tr", "td", "th", "dd", "dt"}
TOKEN_PATTERN = re.compile(r"\S+")


class SemanticChunker:
    """Converts normalized HTML into parent/child chunks with provenance metadata."""

    def __init__(self):
        ingestion_cfg = settings.app_config.ingestion
        self.chunk_size_tokens = max(int(ingestion_cfg.chunk_size_tokens), 1)
        self.chunk_stride_tokens = max(int(ingestion_cfg.chunk_stride_tokens), 1)
        self.max_html_chars = max(1_000, int(getattr(ingestion_cfg, "max_html_chars", 500_000)))

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def chunk(self, request: IngestRequest) -> List[ChildChunk]:
        document_id = self._determine_document_id(request)
        parent_chunks = self._create_parent_chunks(request, document_id)

        child_chunks: List[ChildChunk] = []
        chunk_counter = 0
        for parent in parent_chunks:
            children = self._split_parent_into_children(parent, start_index=chunk_counter)
            child_chunks.extend(children)
            chunk_counter += len(children)

        return child_chunks

    # ------------------------------------------------------------------
    # Parent chunk creation
    # ------------------------------------------------------------------

    def _create_parent_chunks(self, request: IngestRequest, document_id: str) -> List[ParentChunk]:
        root = self._prepare_root(request.text)
        parent_chunks: List[ParentChunk] = []
        heading_stack: List[Tuple[int, str]] = []
        current_path: List[str] = []
        buffer_path: List[str] = []
        buffer_parts: List[str] = []
        section_index = 0

        def flush_buffer():
            nonlocal buffer_parts, buffer_path, section_index
            text = self._join_buffer(buffer_parts)
            if not text:
                buffer_parts = []
                buffer_path = current_path.copy()
                return

            parent_id = str(uuid.uuid4())
            token_count = len(self._tokenize(text))
            metadata = self._create_metadata(
                request,
                document_id=document_id,
                parent_chunk_id=parent_id,
                chunk_id=parent_id,
                chunk_type="parent",
                heading_path=buffer_path,
                section_index=section_index,
                chunk_index=section_index,
                token_start=None,
                token_end=None,
                total_tokens=token_count,
            )

            parent_chunks.append(ParentChunk(id=parent_id, text=text, metadata=metadata))
            section_index += 1
            buffer_parts = []
            buffer_path = current_path.copy()

        buffer_path = current_path.copy()

        for block_type, text, tag in self._iter_blocks(root):
            if block_type == "heading" and isinstance(tag, Tag):
                flush_buffer()

                level = self._heading_level(tag)
                heading_text = text
                while heading_stack and heading_stack[-1][0] >= level:
                    heading_stack.pop()
                heading_stack.append((level, heading_text))
                current_path = [item[1] for item in heading_stack]
                buffer_path = current_path.copy()
                buffer_parts.append(heading_text)
            else:
                if text:
                    if not buffer_parts:
                        buffer_path = current_path.copy()
                    buffer_parts.append(text)

        flush_buffer()
        return parent_chunks

    def _iter_blocks(self, node: Tag) -> Iterable[Tuple[str, str, Optional[Tag]]]:
        for child in node.children:
            if isinstance(child, NavigableString):
                text = self._normalize_text(str(child))
                if text:
                    yield "text", text, None
                continue

            if not isinstance(child, Tag):
                continue

            tag_name = child.name.lower() if child.name else ""
            if tag_name in HEADING_TAGS:
                text = self._normalize_text(child.get_text(separator=" ", strip=True))
                if text:
                    yield "heading", text, child
                continue

            if tag_name in BLOCK_TAGS:
                text = child.get_text(separator=" ", strip=True)
                text = self._normalize_list_text(tag_name, text)
                text = self._normalize_text(text)
                if text:
                    yield "text", text, child
                continue

            # Wrapper nodes (div, span, section, etc.) recurse
            yield from self._iter_blocks(child)

    # ------------------------------------------------------------------
    # Child chunk splitting
    # ------------------------------------------------------------------

    def _split_parent_into_children(self, parent: ParentChunk, start_index: int) -> List[ChildChunk]:
        tokens = self._tokenize(parent.text)
        if not tokens:
            return []

        window = self.chunk_size_tokens
        stride = max(window - self.chunk_stride_tokens, 1)

        child_chunks: List[ChildChunk] = []
        token_index = 0
        chunk_index = start_index

        while token_index < len(tokens):
            end_index = min(token_index + window, len(tokens))
            chunk_text, char_start, char_end = self._slice_text(parent.text, tokens, token_index, end_index)
            if not chunk_text:
                break

            chunk_id = self._build_chunk_id(parent.metadata.document_id, chunk_index)
            child_metadata = parent.metadata.model_copy(update={
                "chunk_type": "child",
                "chunk_id": chunk_id,
                "chunk_index": chunk_index,
                "token_start": token_index,
                "token_end": end_index,
                "total_tokens": len(tokens),
                "char_start": char_start,
                "char_end": char_end,
            })

            child_chunks.append(
                ChildChunk(
                    id=chunk_id,
                    text=chunk_text,
                    metadata=child_metadata,
                    parent_chunk_text=parent.text,
                )
            )

            if end_index >= len(tokens):
                break

            token_index += stride
            chunk_index += 1

        return child_chunks

    # ------------------------------------------------------------------
    # Metadata helpers
    # ------------------------------------------------------------------

    def _create_metadata(
        self,
        request: IngestRequest,
        *,
        document_id: str,
        parent_chunk_id: str,
        chunk_id: str,
        chunk_type: str,
        heading_path: List[str],
        section_index: int,
        chunk_index: Optional[int],
        token_start: Optional[int],
        token_end: Optional[int],
        total_tokens: Optional[int],
    ) -> DocumentMetadata:
        meta_source = request.metadata or {}
        space_name = request.space_name or meta_source.get("space_name")
        space_key = request.space_key or meta_source.get("space_key")
        page_id = request.page_id or meta_source.get("page_id")
        page_version = request.page_version or meta_source.get("page_version")
        labels = request.labels or meta_source.get("labels", [])
        url = request.url or request.source_url or meta_source.get("url")
        content_type = meta_source.get("content_type")
        is_boilerplate = bool(meta_source.get("is_boilerplate", False))
        anchor_id = self._anchor_from_path(heading_path)

        return DocumentMetadata(
            page_title=request.page_title,
            space_name=space_name,
            space_key=space_key,
            source_url=request.source_url or meta_source.get("source_url"),
            url=url,
            page_id=page_id,
            page_version=page_version,
            headings=heading_path.copy(),
            heading_path=heading_path.copy(),
            anchor_id=anchor_id,
            labels=labels,
            content_type=content_type,
            is_boilerplate=is_boilerplate,
            last_modified=request.last_modified or meta_source.get("last_modified"),
            updated_at=meta_source.get("updated_at"),
            document_id=document_id,
            parent_chunk_id=parent_chunk_id,
            chunk_id=chunk_id,
            chunk_type=chunk_type,
            chunk_index=chunk_index,
            token_start=token_start,
            token_end=token_end,
            total_tokens=total_tokens,
            section_index=section_index,
        )

    def _determine_document_id(self, request: IngestRequest) -> str:
        if request.document_id:
            return request.document_id
        meta_source = request.metadata or {}
        if meta_source.get("document_id"):
            return meta_source["document_id"]
        if request.page_id and request.page_version is not None:
            return f"{request.page_id}:{request.page_version}"
        if request.source_url:
            return request.source_url
        return request.page_title

    # ------------------------------------------------------------------
    # Utility helpers
    # ------------------------------------------------------------------

    def _prepare_root(self, html: str) -> Tag:
        trimmed = (html or "")[: self.max_html_chars]
        soup = BeautifulSoup(trimmed, "html.parser")
        for tag in soup.find_all(["script", "style", "noscript", "iframe"]):
            tag.decompose()
        return soup.body or soup

    def _normalize_text(self, text: str) -> str:
        if not text:
            return ""
        return re.sub(r"\s+", " ", text).strip()

    def _normalize_list_text(self, tag_name: str, text: str) -> str:
        if tag_name == "li" and text:
            return f"- {text}"
        return text

    def _heading_level(self, tag: Tag) -> int:
        try:
            return int(tag.name[1])
        except (TypeError, ValueError, IndexError):
            return 1

    def _join_buffer(self, parts: List[str]) -> str:
        return "\n\n".join(part for part in parts if part).strip()

    def _anchor_from_path(self, path: List[str]) -> Optional[str]:
        if not path:
            return None
        slugs = [self._slugify(heading) for heading in path]
        return "-".join(filter(None, slugs)) or None

    def _slugify(self, text: str) -> str:
        if not text:
            return ""
        return re.sub(r"[^a-z0-9]+", "-", text.strip().lower()).strip("-")

    def _tokenize(self, text: str) -> List[Tuple[str, int, int]]:
        return [(match.group(0), match.start(), match.end()) for match in TOKEN_PATTERN.finditer(text)]

    def _slice_text(
        self,
        original_text: str,
        tokens: List[Tuple[str, int, int]],
        start_index: int,
        end_index: int,
    ) -> Tuple[str, int, int]:
        if start_index >= len(tokens) or start_index >= end_index:
            return "", 0, 0

        start_char = tokens[start_index][1]
        end_char = tokens[end_index - 1][2]
        if end_index < len(tokens):
            end_char = tokens[end_index - 1][2]
        else:
            end_char = len(original_text)

        chunk_text = original_text[start_char:end_char].strip()
        return chunk_text, start_char, end_char

    def _build_chunk_id(self, document_id: Optional[str], chunk_index: int) -> str:
        base = document_id or "doc"
        return f"{base}:{chunk_index:03d}"
