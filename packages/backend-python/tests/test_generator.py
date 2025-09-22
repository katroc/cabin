import unittest

from cabin_backend.generator import Generator
from cabin_backend.models import ParentChunk, DocumentMetadata, ChatResponse, Citation
from cabin_backend.citations.verify import QuoteVerifier


class GeneratorPostProcessTests(unittest.TestCase):
    def setUp(self):
        # Bypass __init__ to avoid network dependencies
        self.generator = Generator.__new__(Generator)
        self.generator.quote_verifier = QuoteVerifier(threshold=90)

        metadata = DocumentMetadata(
            page_title="Test Page",
            chunk_id="page:1",
            anchor_id="section",
            headings=["Section"],
            heading_path=["Section"],
        )
        self.chunk = ParentChunk(
            id="page:1",
            text="The rain in Spain stays mainly in the plain.",
            metadata=metadata,
        )
        self.provenance = {
            "1": {
                "chunk_id": self.chunk.id,
                "chunk": self.chunk,
                "page_title": metadata.page_title,
                "space_name": metadata.space_name,
                "space_key": metadata.space_key,
                "url": metadata.url,
                "page_version": metadata.page_version,
                "section": "Section",
                "last_modified": metadata.last_modified,
            }
        }

    def test_valid_citation_passes(self):
        response = self.generator._post_process('"rain stays" [1]', self.provenance, "test question")
        self.assertIsInstance(response, ChatResponse)
        self.assertEqual(len(response.citations), 1)
        self.assertIsInstance(response.citations[0], Citation)
        self.assertIn("rain stays", response.citations[0].quote)

    def test_provenance_mismatch_returns_fallback(self):
        response = self.generator._post_process('"rain" [2]', self.provenance, "test question")
        self.assertEqual(response.response, "I couldn't find reliable citations for this information in the available documentation. Please try rephrasing your question or checking if the topic is covered in the docs.")
        self.assertEqual(len(response.citations), 0)


if __name__ == "__main__":
    unittest.main()
