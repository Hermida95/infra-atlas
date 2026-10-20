from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
import yaml

DOMAINS = [
    {"id": "local", "name": "Local", "order": 0, "position": [-1.0, 0.0, 0.0], "hue": 200},
    {
        "id": "containers",
        "name": "Containers",
        "order": 1,
        "position": [-0.5, -0.5, 0.3],
        "hue": 192,
    },
]

WriteNode = Callable[..., Path]


def node_frontmatter(node_id: str, domain: str = "containers", **overrides: Any) -> dict[str, Any]:
    data: dict[str, Any] = {
        "id": node_id,
        "title": node_id.title(),
        "type": "concept",
        "domain": domain,
        "summary": f"Summary of {node_id}.",
        "reviewed": "2026-10-20",
    }
    data.update(overrides)
    return data


@pytest.fixture
def content_dir(tmp_path: Path) -> Path:
    root = tmp_path / "content"
    (root / "nodes").mkdir(parents=True)
    (root / "domains.yaml").write_text(yaml.safe_dump(DOMAINS))
    return root


@pytest.fixture
def write_node(content_dir: Path) -> WriteNode:
    def _write(
        node_id: str, domain: str = "containers", *, filename: str | None = None, **fields: Any
    ) -> Path:
        meta = node_frontmatter(node_id, domain, **fields)
        path = content_dir / "nodes" / domain / f"{filename or node_id}.mdx"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"---\n{yaml.safe_dump(meta, sort_keys=False)}---\n\nBody of {node_id}.\n")
        return path

    return _write
