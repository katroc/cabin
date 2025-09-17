"""RM3 query expansion implementation."""

from __future__ import annotations

from collections import Counter
from typing import Iterable, List, Sequence


class RM3Expander:
    """Implements RM3 pseudo-relevance feedback for lexical expansion."""

    def __init__(
        self,
        *,
        top_docs: int = 10,
        expansion_terms: int = 10,
        alpha: float = 0.4,
    ) -> None:
        self.top_docs = max(1, top_docs)
        self.expansion_terms = max(1, expansion_terms)
        self.alpha = max(0.0, min(alpha, 1.0))

    def expand(self, query_tokens: List[str], top_documents: Iterable[Sequence[str]]) -> List[str]:
        """Return expanded query tokens using pseudo-relevance feedback."""

        base = list(query_tokens)
        documents = [list(doc) for doc in top_documents][: self.top_docs]
        if not documents:
            return base

        query_tf = Counter(token for token in query_tokens if token)
        doc_term_scores: Counter[str] = Counter()

        for doc in documents:
            if not doc:
                continue
            doc_tf = Counter(token for token in doc if token)
            doc_len = sum(doc_tf.values())
            if doc_len == 0:
                continue
            for term, freq in doc_tf.items():
                doc_term_scores[term] += freq / doc_len

        if not doc_term_scores:
            return base

        # Normalize doc term scores
        total_doc_score = sum(doc_term_scores.values()) or 1.0
        for term in list(doc_term_scores):
            doc_term_scores[term] /= total_doc_score

        # Combine with original query weights
        query_len = sum(query_tf.values()) or 1.0
        combined_scores: Counter[str] = Counter()

        for term in set(query_tf) | set(doc_term_scores):
            original_weight = query_tf.get(term, 0.0) / query_len
            feedback_weight = doc_term_scores.get(term, 0.0)
            combined_scores[term] = (1 - self.alpha) * original_weight + self.alpha * feedback_weight

        expansions = [term for term, _ in combined_scores.most_common(self.expansion_terms)]
        # Ensure original tokens remain at front while appending new unique tokens
        seen = set(base)
        expanded_query = list(base)
        for term in expansions:
            if term and term not in seen:
                expanded_query.append(term)
                seen.add(term)

        return expanded_query
