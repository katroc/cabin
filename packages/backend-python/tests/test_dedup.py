import unittest
from datetime import datetime

from cabin_backend.ingest.dedup import Deduplicator
from cabin_backend.models import ChildChunk, DocumentMetadata


class DeduplicationTests(unittest.TestCase):
    def test_deduplicator_removes_similar_chunks(self):
        meta = DocumentMetadata(page_title="Doc", chunk_id="doc:1", updated_at=datetime.utcnow().isoformat())
        base_chunk = ChildChunk(id="doc:1", text="alpha beta gamma delta", metadata=meta, parent_chunk_text="alpha beta gamma delta")

        dup_meta = meta.model_copy(update={"chunk_id": "doc:2", "updated_at": datetime.utcnow().isoformat()})
        duplicate = ChildChunk(id="doc:2", text="alpha beta gamma delta", metadata=dup_meta, parent_chunk_text="alpha beta gamma delta")

        deduper = Deduplicator(threshold=0.8, shingle_size=3)
        result = deduper.deduplicate([base_chunk, duplicate])
        self.assertEqual(len(result.kept), 1)
        self.assertEqual(len(result.dropped), 1)
        dropped_chunk, kept_chunk, score = result.dropped[0]
        self.assertGreaterEqual(score, 0.8)
        self.assertEqual(kept_chunk.id, result.kept[0].id)


if __name__ == "__main__":
    unittest.main()
