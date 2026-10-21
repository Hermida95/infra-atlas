"""Test doubles shared by the API tests (imported via conftest's sys.path entry)."""

import hashlib
import math
import re
from collections.abc import Sequence


class HashEmbedder:
    """Deterministic bag-of-words vectors: tests the plumbing, not the quality of a model."""

    provider = "test"
    model = "hash"
    model_version = "1"
    dimensions = 256

    def _vector(self, text: str) -> list[float]:
        vector = [0.0] * self.dimensions
        for word in re.findall(r"[a-z0-9]+", text.lower()):
            vector[int(hashlib.md5(word.encode()).hexdigest(), 16) % self.dimensions] += 1.0
        norm = math.sqrt(sum(x * x for x in vector)) or 1.0
        return [x / norm for x in vector]

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        return [self._vector(t) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._vector(text)
