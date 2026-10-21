#!/usr/bin/env python3
"""Validate all skills in the qa-skills repository (v3 extended checks).

Per-skill checks:
- SKILL.md exists; valid YAML frontmatter; name matches directory.
- Nonempty description; MIT license; author/version/category metadata.
- Line count under MAX_LINES.
- Required sections present (template compliance).
- Referenced references/ files exist; no orphan reference files.
- Related Skills entries name real skills.
- Eval spec is well-formed at evals/<skill>-evals.json with >= MIN_EVALS cases.

Repo-level checks:
- README "Skills-N" badge and "N skills" count match the directory count.
- skills_index.json matches generated names, paths, categories, order, and version.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

if __package__:
    from .build_index import build, current_version, load_existing_index
    from .eval_patterns import validate_eval_spec
    from .skill_format import (VALID_CATEGORIES, frontmatter_errors, markdown_sections,
                               parse_frontmatter, without_fenced_code)
else:
    from build_index import build, current_version, load_existing_index
    from eval_patterns import validate_eval_spec
    from skill_format import (VALID_CATEGORIES, frontmatter_errors, markdown_sections,
                              parse_frontmatter, without_fenced_code)

MAX_LINES = 650
MIN_EVALS = 8
REQUIRED_SECTIONS = [
    "Discovery Questions", "Core Principles", "Anti-Patterns", "Done When", "Related Skills",
]
# Discovery Questions and Done When are required for every skill except the two
# intentionally-minimal router/starter skills, which have no discovery flow.
MINIMAL_EXEMPT = {"qa-do", "qa-start"}
# qa-start only chains other skills; its principles and anti-patterns live there.
SECTION_EXEMPTIONS = {
    "qa-do": {"Discovery Questions", "Done When"},
    "qa-start": {"Discovery Questions", "Done When", "Core Principles", "Anti-Patterns"},
}

REPO = Path(__file__).parent.parent
SKILLS_DIR = REPO / "skills"


def extract_frontmatter(content: str) -> dict | None:
    """Compatibility helper; validation itself reports parse_frontmatter's cause."""
    try:
        return parse_frontmatter(content)[0]
    except ValueError:
        return None


def _entry_head(line: str) -> str:
    """Return the label before a bullet's boundary explanation or a table cell."""
    bullet = re.match(r"^ {0,3}(?:[-+*]|\d+[.)])[ \t]+(.+)", line)
    if bullet:
        return re.split(r"\s+(?:—|–|--|-)\s+", bullet[1], maxsplit=1)[0]
    if line.lstrip().startswith("|"):
        return line.split("|", 2)[1].strip()
    return ""


def _entry_labels(head: str) -> list[str]:
    """Read bold, code, and Markdown-link labels used in the repository tables."""
    # Link destinations are handled by explicit references/ path detection. Only
    # their labels belong to Related Skills and bare reference-file lists.
    head = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", head)
    labels = re.findall(r"\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`", head)
    if labels:
        return [next(value for value in match if value).strip("` ") for match in labels]
    first = head.split(maxsplit=1)
    return [first[0]] if first else []


def find_referenced_files(content: str) -> set[str]:
    """Find concrete reference paths, including nested files and executable code.

    Bare file labels are supported inside Reference Files sections, as in the
    existing skills. A coincidental filename substring elsewhere is not a cite.
    References inside runnable code examples still count.
    """
    refs = set(re.findall(
        r"(?<![\w/])references/(?:[A-Za-z0-9_.-]+/)*"
        r"[A-Za-z0-9_.-]+\.[A-Za-z0-9]+", content,
    ))
    visible = without_fenced_code(content)
    for section in markdown_sections(content):
        if not re.match(r"reference files\b", section.title, re.IGNORECASE):
            continue
        for line in visible[section.start:section.end].splitlines():
            for label in _entry_labels(_entry_head(line)):
                if re.fullmatch(r"(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+\.[A-Za-z0-9]+", label):
                    refs.add(label if label.startswith("references/") else f"references/{label}")
    return refs


def related_skill_names(content: str) -> list[str]:
    """Read the entry names, not incidental code in a boundary explanation."""
    names = []
    visible = without_fenced_code(content)
    for section in markdown_sections(content):
        if section.level != 2 or section.title != "Related Skills":
            continue
        # A subsection (such as Playwright's Reference Files table) is no longer
        # a list of related skills, even though it is inside this H2 section.
        text = visible[section.start:section.end]
        text = re.split(r"(?m)^ {0,3}#{1,6}[ \t]+", text, maxsplit=1)[0]
        for line in text.splitlines():
            labels = _entry_labels(_entry_head(line))
            # Explicit plugin:skill references describe external dependencies;
            # only repository-local names can be checked against skills/.
            external = {label.split(":", 1)[1] for label in labels
                        if re.fullmatch(r"[a-z][a-z0-9-]*:[a-z][a-z0-9-]*", label)}
            for label in labels:
                if re.fullmatch(r"[a-z][a-z0-9-]*", label) and label not in external:
                    names.append(label)
    return names


def validate_skill(skill_dir: Path, all_skill_names: set[str]) -> list[str]:
    errors: list[str] = []
    name = skill_dir.name
    skill_file = skill_dir / "SKILL.md"

    if not skill_file.is_file():
        return [f"{name}: SKILL.md not found"]

    try:
        content = skill_file.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        return [f"{name}: cannot read SKILL.md ({exc})"]
    lines = content.splitlines()

    if len(lines) > MAX_LINES:
        errors.append(f"{name}: {len(lines)} lines (max {MAX_LINES})")

    try:
        fm, body = parse_frontmatter(content)
    except ValueError as exc:
        return errors + [f"{name}: {exc}"]
    errors.extend(f"{name}: {error}" for error in frontmatter_errors(fm, name))

    visible = without_fenced_code(body)
    objectives = re.findall(r"(?ms)^ {0,3}<objective>(.*?)</objective>[ \t]*(?=\n|$)", visible)
    if (len(objectives) != 1 or not objectives[0].strip()
            or visible.count("<objective>") != 1 or visible.count("</objective>") != 1):
        errors.append(f"{name}: expected one closed, nonempty <objective> block")
    sections = markdown_sections(body)
    for title in REQUIRED_SECTIONS:
        if title in SECTION_EXEMPTIONS.get(name, set()):
            continue
        matches = [s for s in sections if s.level == 2 and s.title == title]
        if not matches:
            errors.append(f"{name}: missing required section '## {title}'")
        elif len(matches) > 1:
            errors.append(f"{name}: duplicate required section '## {title}'")
        elif not re.sub(r"<!--[\s\S]*?-->", "", body[matches[0].start:matches[0].end]).strip():
            errors.append(f"{name}: empty required section '## {title}'")

    # references/: every cited file exists; every file on disk is cited.
    refs_cited = find_referenced_files(body)
    ref_dir = skill_dir / "references"
    for ref in sorted(refs_cited):
        target = skill_dir / ref
        if not target.resolve().is_relative_to(ref_dir.resolve()):
            errors.append(f"{name}: reference path {ref} escapes references/")
        elif not target.is_file():
            errors.append(f"{name}: cites {ref} but file is missing")
    if ref_dir.exists():
        for f in sorted(ref_dir.rglob("*")):
            if not f.is_file() or any(part.startswith(".") or part == "__pycache__"
                                      for part in f.relative_to(ref_dir).parts):
                continue
            relative = f.relative_to(skill_dir).as_posix()
            if relative not in refs_cited:
                errors.append(f"{name}: orphan reference file {relative} (never cited)")

    # Related Skills name real skills.
    for rel in related_skill_names(body):
        if rel not in all_skill_names:
            errors.append(f"{name}: Related Skills references unknown skill '{rel}'")

    # Eval spec exists and has enough cases.
    spec = REPO / "evals" / f"{name}-evals.json"
    if not spec.is_file():
        errors.append(f"{name}: missing eval spec evals/{name}-evals.json")
    else:
        try:
            cases = validate_eval_spec(json.loads(spec.read_text(encoding="utf-8")), name)
            if len(cases) < MIN_EVALS:
                errors.append(f"{name}: only {len(cases)} eval cases (min {MIN_EVALS})")
        except (OSError, ValueError) as exc:
            errors.append(f"{name}: invalid eval spec ({exc})")

    return errors


def validate_repo(skill_names: set[str]) -> list[str]:
    errors = []
    n = len(skill_names)

    try:
        readme = (REPO / "README.md").read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        errors.append(f"README: cannot read README.md ({exc})")
        readme = ""
    badge = re.search(r"Skills-(\d+)-", readme)
    if badge and int(badge.group(1)) != n:
        errors.append(f"README: Skills badge says {badge.group(1)}, found {n} skills")
    count_claim = re.search(r"(\d+) skills across", readme)
    if count_claim and int(count_claim.group(1)) != n:
        errors.append(f"README: '{count_claim.group(1)} skills across' but found {n}")

    index = REPO / "skills_index.json"
    if not index.is_file():
        errors.append("skills_index.json is missing — run scripts/build_index.py")
    else:
        try:
            data = load_existing_index(index)
        except (OSError, ValueError) as exc:
            return errors + [str(exc)]
        indexed = {s["name"] for s in data["skills"]}
        missing = skill_names - indexed
        extra = indexed - skill_names
        if missing:
            errors.append(f"skills_index.json missing: {sorted(missing)}")
        if extra:
            errors.append(f"skills_index.json has phantom skills: {sorted(extra)}")
        try:
            expected = build(current_version(REPO, index), skills_dir=REPO / "skills", index_path=index)
            if data != expected:
                errors.append("skills_index.json is stale — run scripts/build_index.py")
        except (OSError, ValueError) as exc:
            errors.append(f"skills_index.json cannot be checked: {exc}")
    return errors


def main() -> None:
    if not SKILLS_DIR.exists():
        print("ERROR: skills/ directory not found")
        sys.exit(1)

    skill_dirs = sorted(d for d in SKILLS_DIR.iterdir()
                        if d.is_dir() and not d.name.startswith("."))
    if not skill_dirs:
        print("ERROR: no skill directories found")
        sys.exit(1)

    skill_names = {d.name for d in skill_dirs}
    all_errors = []

    for d in skill_dirs:
        errs = validate_skill(d, skill_names)
        if errs:
            all_errors.extend(errs)
            for e in errs:
                print(f"  FAIL: {e}")
        else:
            lc = len((d / "SKILL.md").read_text(encoding="utf-8").splitlines())
            print(f"  OK:   {d.name} ({lc} lines)")

    repo_errs = validate_repo(skill_names)
    for e in repo_errs:
        print(f"  FAIL: {e}")
    all_errors.extend(repo_errs)

    print(f"\nSkills: {len(skill_dirs)}\nErrors: {len(all_errors)}")
    if all_errors:
        print("\nValidation FAILED")
        sys.exit(1)
    print("\nAll skills valid")


if __name__ == "__main__":
    main()
