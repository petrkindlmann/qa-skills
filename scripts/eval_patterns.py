#!/usr/bin/env python3
"""Shared pattern-matching grammar for qa-skills evals.

A single source of truth used by both the static checker (does the SKILL.md
content teach this pattern?) and the live runner (did the agent's output contain
this pattern?). Keeping the grammar in one place is what makes static and live
results comparable.

Grammar (intentionally small and deterministic):
- "A OR B OR C"  -> alternation; matches if ANY alternative matches.
- ".*"            -> wildcard inside a literal; compiled as a regex span.
- everything else -> case-insensitive substring / loose regex match.

A pattern is classified as SEMANTIC (needs an LLM judge, cannot be checked by
substring) when it reads like prose rather than a token: it has no code-ish
characters (no (){}[]._=/<>:) and is longer than four words. Semantic patterns
are reported separately so they are never silently "passed" by a dumb match.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_CODEISH = re.compile(r"[(){}\[\].=/<>:_\"'`|$@#]")


def is_semantic(pattern: str) -> bool:
    """True when a pattern is prose that substring-matching cannot fairly judge."""
    p = pattern.strip()
    if " OR " in p:
        return all(is_semantic(alt) for alt in split_alternation(p))
    if _CODEISH.search(p):
        return False
    return len(p.split()) > 4


def split_alternation(pattern: str) -> list[str]:
    return [alt.strip() for alt in pattern.split(" OR ") if alt.strip()]


def _compile_literal(literal: str) -> re.Pattern:
    """Compile one alternative into a case-insensitive regex.

    `.*` is honoured as a wildcard; every other char is escaped so that regex
    metacharacters in tool names (e.g. `page.$$(`) match literally.
    """
    parts = literal.split(".*")
    escaped = ".*".join(re.escape(part) for part in parts)
    return re.compile(escaped, re.IGNORECASE | re.DOTALL)


def matches(pattern: str, text: str) -> bool:
    """Does `text` satisfy `pattern` under the grammar above?"""
    for alt in split_alternation(pattern):
        if _compile_literal(alt).search(text):
            return True
    return False


@dataclass
class CaseResult:
    case_id: str
    expected_hit: list[str]
    expected_miss: list[str]
    anti_hit: list[str]
    semantic: list[str]

    @property
    def passed(self) -> bool:
        # An eval passes when every non-semantic expected pattern is present and
        # no anti-pattern is present. Semantic patterns are deferred to a judge.
        return not self.expected_miss and not self.anti_hit


def check_case(case: dict, text: str) -> CaseResult:
    """Check one eval case's expected/anti patterns against `text`."""
    expected = case.get("expected_patterns", [])
    anti = case.get("anti_patterns", [])

    expected_hit, expected_miss, semantic = [], [], []
    for pat in expected:
        if is_semantic(pat):
            semantic.append(pat)
            continue
        (expected_hit if matches(pat, text) else expected_miss).append(pat)

    anti_hit = [pat for pat in anti if not is_semantic(pat) and matches(pat, text)]

    return CaseResult(
        case_id=case.get("id", "?"),
        expected_hit=expected_hit,
        expected_miss=expected_miss,
        anti_hit=anti_hit,
        semantic=semantic,
    )
