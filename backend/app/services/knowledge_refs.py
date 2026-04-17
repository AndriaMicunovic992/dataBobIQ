"""Knowledge entry @-mention resolution.

Mention token format (must match frontend/src/utils/mentions.js):
    @[Title](knowledge:entry-id)

The display title is informational; the id is canonical.
"""

from __future__ import annotations

import re
from typing import Any, Iterable

MENTION_RE = re.compile(r"@\[([^\]]+)\]\(knowledge:([^)]+)\)")


def extract_ids(text: str | None) -> list[str]:
    if not text:
        return []
    seen: set[str] = set()
    ids: list[str] = []
    for match in MENTION_RE.finditer(text):
        entry_id = match.group(2)
        if entry_id not in seen:
            seen.add(entry_id)
            ids.append(entry_id)
    return ids


def extract_ids_from_content(content: Any) -> list[str]:
    """Pull mention ids from whatever shape `content` is stored as."""
    if isinstance(content, str):
        return extract_ids(content)
    if isinstance(content, dict):
        desc = content.get("description")
        if isinstance(desc, str):
            return extract_ids(desc)
    return []


def collect_reference_ids(entries: Iterable[Any]) -> list[str]:
    """Collect unique referenced ids across a batch of entries."""
    seen: set[str] = set()
    out: list[str] = []
    for e in entries:
        for rid in extract_ids_from_content(getattr(e, "content", None)):
            if rid not in seen:
                seen.add(rid)
                out.append(rid)
    return out
