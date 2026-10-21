"""Shared parsing for the repository's YAML frontmatter and Markdown structure.

YAML is parsed with SafeLoader, with duplicate mapping keys rejected instead of
silently keeping the last value. Markdown helpers only identify the structures
used by the house template; they do not treat examples inside fences as headings.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import yaml
from yaml.constructor import ConstructorError
from yaml.nodes import MappingNode

CATEGORY_ORDER = [
    "foundation", "strategy", "automation", "specialized", "ai-qa",
    "infrastructure", "metrics", "process", "production", "knowledge",
]
VALID_CATEGORIES = set(CATEGORY_ORDER)


class UniqueKeySafeLoader(yaml.SafeLoader):
    """Safe YAML loader that rejects repeated keys at every mapping depth."""

    def construct_mapping(self, node: MappingNode, deep: bool = False) -> dict:
        if isinstance(node, MappingNode):
            seen = set()
            # Check explicit keys before SafeLoader expands YAML merge keys.
            # A merge followed by an explicit override is valid YAML.
            for key_node, _ in node.value:
                if key_node.tag == "tag:yaml.org,2002:merge":
                    key = "<<"
                else:
                    key = self.construct_object(key_node, deep=deep)
                try:
                    duplicate = key in seen
                    seen.add(key)
                except TypeError as exc:
                    raise ConstructorError(
                        "while constructing a mapping", node.start_mark,
                        "found an unhashable mapping key", key_node.start_mark,
                    ) from exc
                if duplicate:
                    raise ConstructorError(
                        "while constructing a mapping", node.start_mark,
                        f"duplicate key {key!r}", key_node.start_mark,
                    )
        return super().construct_mapping(node, deep=deep)


def parse_frontmatter(content: str) -> tuple[dict, str]:
    """Return the YAML mapping and body, or raise ValueError with a useful cause.

    Delimiters must occupy their own lines. A quoted value containing ``---``
    therefore cannot accidentally terminate the frontmatter.
    """
    lines = content.splitlines(keepends=True)
    if not lines or lines[0].rstrip("\r\n \t") != "---":
        raise ValueError("missing opening YAML frontmatter delimiter '---'")
    end = next((i for i in range(1, len(lines))
                if lines[i].rstrip("\r\n \t") == "---"), None)
    if end is None:
        raise ValueError("missing closing YAML frontmatter delimiter '---'")
    try:
        data = yaml.load("".join(lines[1:end]), Loader=UniqueKeySafeLoader)
    except yaml.YAMLError as exc:
        raise ValueError(f"invalid YAML frontmatter: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("YAML frontmatter must be a mapping")
    return data, "".join(lines[end + 1:])


def frontmatter_errors(data: dict, directory_name: str) -> list[str]:
    """Validate required fields from docs/SKILL_TEMPLATE.md, without style rules."""
    errors = []
    if data.get("name") != directory_name:
        errors.append(f"frontmatter name {data.get('name')!r} != directory")
    if not isinstance(data.get("description"), str) or not data["description"].strip():
        errors.append("description must be a nonempty string")
    if data.get("license") != "MIT":
        errors.append("license must be MIT")
    metadata = data.get("metadata")
    if not isinstance(metadata, dict):
        return errors + ["metadata must be a mapping with author, version, and category"]
    for field in ("author", "version", "category"):
        value = metadata.get(field)
        if not isinstance(value, str) or not value.strip():
            errors.append(f"metadata.{field} must be a nonempty string")
        elif field == "category" and value not in VALID_CATEGORIES:
            errors.append(f"metadata.category {value!r} not in whitelist")
    return errors


def without_fenced_code(content: str) -> str:
    """Mask fenced code and HTML comments, preserving offsets and newlines."""
    result = []
    fence_char = ""
    fence_length = 0
    in_comment = False
    for line in content.splitlines(keepends=True):
        if fence_char:
            marker = re.match(r"^ {0,3}(`{3,}|~{3,})(.*?)[\r\n]*$", line)
            result.append(re.sub(r"[^\r\n]", " ", line))
            if (marker and marker[1][0] == fence_char
                    and len(marker[1]) >= fence_length and not marker[2].strip()):
                fence_char = ""
            continue
        # HTML-looking text inside a code example is literal. Process comments
        # only outside fences so an example's '<!--' cannot hide later sections.
        pieces = []
        cursor = 0
        while cursor < len(line):
            if in_comment:
                end = line.find("-->", cursor)
                stop = end + 3 if end >= 0 else len(line)
                pieces.append(re.sub(r"[^\r\n]", " ", line[cursor:stop]))
                cursor = stop
                in_comment = end < 0
            else:
                start = line.find("<!--", cursor)
                if start < 0:
                    pieces.append(line[cursor:])
                    break
                pieces.append(line[cursor:start])
                cursor = start
                in_comment = True
        visible = "".join(pieces)
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})(.*?)[\r\n]*$", visible)
        if marker and not (marker[1][0] == "`" and "`" in marker[2]):
            fence_char, fence_length = marker[1][0], len(marker[1])
            result.append(re.sub(r"[^\r\n]", " ", line))
        else:
            result.append(visible)
    return "".join(result)


@dataclass(frozen=True)
class Section:
    title: str
    level: int
    start: int
    end: int


def markdown_sections(content: str) -> list[Section]:
    """Find ATX sections outside examples, ending at the next peer or parent."""
    visible = without_fenced_code(content)
    headings = list(re.finditer(
        r"(?m)^ {0,3}(#{1,6})[ \t]+([^\r\n]+?)[ \t]*$", visible,
    ))
    result = []
    for i, heading in enumerate(headings):
        level = len(heading[1])
        title = re.sub(r"[ \t]+#+$", "", heading[2]).strip()
        end = next((nxt.start() for nxt in headings[i + 1:]
                    if len(nxt[1]) <= level), len(content))
        result.append(Section(title, level, heading.end(), end))
    return result
