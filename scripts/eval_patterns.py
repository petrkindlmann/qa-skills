#!/usr/bin/env python3
"""Shared pattern-matching grammar for qa-skills evals.

A single source of truth used by both the static checker (does the SKILL.md
content teach this pattern?) and the live runner (did the agent's output contain
this pattern?). Keeping the grammar in one place is what makes static and live
results comparable.

Grammar (intentionally small and deterministic):
- "A OR B OR C"  -> alternation; matches if ANY alternative matches.
- ".*"            -> wildcard inside a literal; compiled as a regex span.
- `(a|b)` / `(a OR b)` -> a group of literal alternatives.
- everything else -> case-insensitive literal substring match.

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
    """Split OR outside supported groups, preserving literal call fragments.

    An unmatched '(' in `.match( OR .exec(` is code, not an open regex group.
    Only the complete alternation groups understood by the compiler shield OR.
    Empty alternatives are retained so spec validation can reject them.
    """
    groups = list(_GROUP.finditer(pattern))
    parts, start = [], 0
    # Match only OR so adjacent separators can share their whitespace. Consuming
    # both surrounding spaces would miss the empty member in `foo OR OR bar`.
    for separator in re.finditer(r"(?<=\s)OR(?=\s)", pattern):
        if any(group.start() <= separator.start() < group.end() for group in groups):
            continue
        parts.append(pattern[start:separator.start()].strip())
        start = separator.end()
    parts.append(pattern[start:].strip())
    return parts


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
            members = [a.strip() for a in re.split(r"\||(?<=\s)OR(?=\s)", m.group(1))]
            if any(not member for member in members):
                raise ValueError(f"empty group alternative in {m.group(0)!r}")
            alts = [re.escape(member) for member in members]
            group = "(?:" + "|".join(alts) + ")"
            # A quoted argument alternative in a call retains the call's
            # parentheses: getByRole('listbox' OR 'menu'). Prose/regex groups
            # such as `assert (red|blue)` do not add literal parentheses.
            if i and re.match(r"[\w.$]", literal[i - 1]) and all(
                member.startswith(("'", '"')) for member in members
            ):
                group = r"\(" + group + r"\)"
            out.append(group)
            i = m.end()
            continue
        # consume one literal char (escaped)
        out.append(re.escape(literal[i]))
        i += 1
    return re.compile("".join(out), re.IGNORECASE | re.DOTALL)


def matches(pattern: str, text: str) -> bool:
    """Does `text` satisfy `pattern` under the grammar above?"""
    for alt in split_alternation(pattern):
        if alt and _compile_literal(alt).search(text):
            return True
    return False


def validate_case(case: object) -> None:
    """Reject malformed criteria before a model call or a reported score."""
    if not isinstance(case, dict):
        raise ValueError("each eval case must be an object")
    for field in ("id", "prompt"):
        if not isinstance(case.get(field), str) or not case[field].strip():
            raise ValueError(f"case {case.get('id', '?')!r}: {field} must be a nonblank string")
    if "static" in case and not isinstance(case["static"], bool):
        raise ValueError(f"case {case['id']!r}: static must be true or false when present")
    for field in ("expected_patterns", "anti_patterns"):
        patterns = case.get(field)
        if not isinstance(patterns, list) or (field == "expected_patterns" and not patterns):
            raise ValueError(f"case {case['id']!r}: {field} must be a list"
                             + (" with at least one pattern" if field == "expected_patterns" else ""))
        for pattern in patterns:
            if not isinstance(pattern, str) or not pattern.strip():
                raise ValueError(f"case {case['id']!r}: {field} items must be nonblank strings")
            alternatives = split_alternation(pattern)
            if any(not alt for alt in alternatives):
                raise ValueError(f"case {case['id']!r}: empty OR alternative in {pattern!r}")
            try:
                compiled = [_compile_literal(alt) for alt in alternatives]
            except ValueError as exc:
                raise ValueError(f"case {case['id']!r}: {exc} in {field}") from exc
            if any(pattern.search("") for pattern in compiled):
                raise ValueError(f"case {case['id']!r}: pattern matches empty output: {pattern!r}")


def validate_eval_spec(spec: object, expected_skill: str) -> list[dict]:
    """Return valid cases or raise ValueError with a field-specific diagnostic.

    The repository validator separately enforces its minimum case count. The
    runner permits a smaller, nonempty suite for the first RED authoring step.
    """
    if not isinstance(spec, dict):
        raise ValueError("eval spec must be an object")
    if spec.get("skill") != expected_skill:
        raise ValueError(f"eval spec skill {spec.get('skill')!r} does not match {expected_skill!r}")
    if "version" in spec and (
        not isinstance(spec["version"], str) or not spec["version"].strip()
    ):
        raise ValueError("eval spec version must be a nonblank string")
    cases = spec.get("evals")
    if not isinstance(cases, list) or not cases:
        raise ValueError("evals must be a nonempty list of cases")
    seen = set()
    for case in cases:
        validate_case(case)
        if case["id"] in seen:
            raise ValueError(f"duplicate eval case id {case['id']!r}")
        seen.add(case["id"])
    return cases


@dataclass
class CaseResult:
    case_id: str
    expected_hit: list[str]
    expected_miss: list[str]
    anti_hit: list[str]
    semantic: list[str]
    semantic_anti: list[str]
    checkable: int

    @property
    def passed(self) -> bool:
        # An eval passes when every non-semantic expected pattern is present and
        # no anti-pattern is present. Semantic patterns are deferred to a judge.
        return self.checkable > 0 and not self.expected_miss and not self.anti_hit


def check_case(case: dict, text: str) -> CaseResult:
    """Check one eval case's expected/anti patterns against `text`."""
    validate_case(case)
    expected = case["expected_patterns"]
    anti = case["anti_patterns"]

    expected_hit, expected_miss, semantic = [], [], []
    for pat in expected:
        if is_semantic(pat):
            semantic.append(pat)
            continue
        (expected_hit if matches(pat, text) else expected_miss).append(pat)

    semantic_anti = [pat for pat in anti if is_semantic(pat)]
    checkable_anti = [pat for pat in anti if not is_semantic(pat)]
    anti_hit = [pat for pat in checkable_anti if matches(pat, text)]

    return CaseResult(
        case_id=case.get("id", "?"),
        expected_hit=expected_hit,
        expected_miss=expected_miss,
        anti_hit=anti_hit,
        semantic=semantic,
        semantic_anti=semantic_anti,
        checkable=len(expected_hit) + len(expected_miss) + len(checkable_anti),
    )
