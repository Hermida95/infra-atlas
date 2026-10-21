import os
import sys
from pathlib import Path

# Tests import shared doubles from api_fakes.py next to this file (pytest runs in importlib
# mode, so the tests directory is not on sys.path by itself).
sys.path.insert(0, str(Path(__file__).parent))

# Before api.main is imported: the shared `app` must not warm up a real model or count the
# suite's requests against the rate limit. Tests that need either build their own app.
os.environ.setdefault("WARMUP", "0")
os.environ.setdefault("RATE_LIMIT_PER_MINUTE", "0")
os.environ.setdefault("LOG_FORMAT", "text")
