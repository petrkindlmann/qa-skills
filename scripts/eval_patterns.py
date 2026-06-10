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
    """True when a pattern is prose that substring-matching cannot fairly judge.

    A pattern is semantic (judge-deferred) when, after stripping the regex-ish
    scaffolding (`.*` wildcards and `(a|b)` / `(a OR b)` alternation groups), what
    remains is natural-language prose: >4 words with no code-ish tokens. This keeps
    `getByRole OR getByTestId` checkable while deferring
    `covers same lines but (asserts OR checks) different` to a human/LLM judge —
    a sentence no skill text contains verbatim.
    """
    p = pattern.strip()
    alts = split_alternation(p)
    if len(alts) > 1:  # genuine top-level alternation (not ' OR ' inside a group)
        return all(is_semantic(alt) for alt in alts)
    # Strip scaffolding before judging prose-ness.
    bare = _GROUP.sub(" ", p).replace(".*", " ").replace(".?", " ").strip()
    if _CODEISH.search(bare):
        return False
    return len(bare.split()) > 4


def split_alternation(pattern: str) -> list[str]:
    """Split top-level ' OR ' alternatives, but NOT ' OR ' inside (a OR b) groups."""
    parts, depth, buf = [], 0, []
    tokens = re.split(r"(\(|\)|\sOR\s)", pattern)
    for tok in tokens:
        if tok == "(":
            depth += 1
            buf.append(tok)
        elif tok == ")":
            depth = max(0, depth - 1)
            buf.append(tok)
        elif tok.strip() == "OR" and depth == 0:
            parts.append("".join(buf).strip())
            buf = []
        else:
            buf.append(tok)
    if buf:
        parts.append("".join(buf).strip())
    return [p for p in parts if p]


# (a|b|c) or (a OR b OR c) regex-style alternation group.
_GROUP = re.compile(r"\(([^()]*(?:\||\sOR\s)[^()]*)\)")


def _compile_literal(literal: str) -> re.Pattern:
    """Compile one alternative into a case-insensitive regex.

    Supported regex-ish syntax (everything else is matched literally):
    - `.*`           wildcard span
    - `(a|b|c)`      alternation group — any of the pipe-separated literals
    Tool names with regex metachars (e.g. `page.$$(`) still match literally
    because we escape each literal chunk before reassembling.
    """
    # Tokenize into literal chunks, ".*" wildcards, and "(a|b)" groups.
    out = []
    i = 0
    while i < len(literal):
        if literal.startswith(".*", i):
            out.append(".*")
            i += 2
            continue
        m = _GROUP.match(literal, i)
        if m:
            alts = [re.escape(a.strip())
                    for a in re.split(r"\||\sOR\s", m.group(1)) if a.strip()]
            out.append("(?:" + "|".join(alts) + ")")
            i = m.end()
            continue
        # consume one literal char (escaped)
        out.append(re.escape(literal[i]))
        i += 1
    return re.compile("".join(out), re.IGNORECASE | re.DOTALL)


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
