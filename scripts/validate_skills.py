#!/usr/bin/env python3
"""Validate all skills in the qa-skills repository (v3 extended checks).

Per-skill checks:
- SKILL.md exists; valid YAML frontmatter; name matches directory.
- description present; category in whitelist.
- Line count under MAX_LINES.
- Required sections present (template compliance).
- Referenced references/ files exist; no orphan reference files.
- Related Skills entries name real skills.
- Eval spec exists at evals/<skill>-evals.json with >= MIN_EVALS cases.

Repo-level checks:
- README "Skills-N" badge and "N skills" count match the directory count.
- skills_index.json lists exactly the skills on disk.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

MAX_LINES = 650
MIN_EVALS = 8
VALID_CATEGORIES = {
    "foundation", "strategy", "automation", "specialized", "ai-qa",
    "infrastructure", "metrics", "process", "production", "knowledge",
}
REQUIRED_SECTIONS = ["## Related Skills"]
# Discovery Questions and Done When are required for every skill except the two
# intentionally-minimal router/starter skills, which have no discovery flow.
MINIMAL_EXEMPT = {"qa-do", "qa-start"}

REPO = Path(__file__).parent.parent
SKILLS_DIR = REPO / "skills"


def extract_frontmatter(content: str) -> dict | None:
    if not content.startswith("---"):
        return None
    end = content.find("---", 3)
    if end == -1:
        return None
    fm = content[3:end].strip()
    result = {}
    for line in fm.split("\n"):
        s = line.strip()
        if s.startswith("#") or not s:
            continue
        if ":" in line and not line.startswith(" ") and not line.startswith("-"):
            key, _, value = line.partition(":")
            result[key.strip()] = value.strip().strip('"').strip("'")
        m = re.match(r"^\s+category:\s*(.*)$", line)
        if m:
            result["category"] = m.group(1).strip().strip('"').strip("'")
    return result


def find_referenced_files(content: str) -> set[str]:
    return set(re.findall(r"references/[a-z0-9-]+\.md", content))


def related_skill_names(content: str) -> list[str]:
    """Pull skill names out of the Related Skills section bullets."""
    idx = content.find("## Related Skills")
    if idx == -1:
        return []
    section = content[idx:]
    nxt = section.find("\n## ", 3)
    if nxt != -1:
        section = section[:nxt]
    return re.findall(r"`([a-z][a-z0-9-]+)`", section)


def validate_skill(skill_dir: Path, all_skill_names: set[str]) -> list[str]:
    errors: list[str] = []
    name = skill_dir.name
    skill_file = skill_dir / "SKILL.md"

    if not skill_file.exists():
        return [f"{name}: SKILL.md not found"]

    content = skill_file.read_text()
    lines = content.split("\n")

    if len(lines) > MAX_LINES:
        errors.append(f"{name}: {len(lines)} lines (max {MAX_LINES})")

    fm = extract_frontmatter(content)
    if fm is None:
        return errors + [f"{name}: missing or invalid YAML frontmatter"]

    if fm.get("name", "") != name:
        errors.append(f"{name}: frontmatter name '{fm.get('name')}' != directory")
    if "description" not in fm and "description:" not in content[:600]:
        errors.append(f"{name}: missing description")

    category = fm.get("category")
    if category and category not in VALID_CATEGORIES:
        errors.append(f"{name}: category '{category}' not in whitelist")
    elif not category:
        errors.append(f"{name}: missing metadata.category")

    if "<objective>" not in content:
        errors.append(f"{name}: missing <objective> block")
    for section in REQUIRED_SECTIONS:
        if section not in content:
            errors.append(f"{name}: missing required section '{section}'")
    if name not in MINIMAL_EXEMPT:
        if "## Discovery Questions" not in content:
            errors.append(f"{name}: missing '## Discovery Questions' section")
        if "## Done When" not in content:
            errors.append(f"{name}: missing '## Done When' section")

    # references/: every cited file exists; every file on disk is cited.
    refs_cited = find_referenced_files(content)
    for ref in refs_cited:
        if not (skill_dir / ref).exists():
            errors.append(f"{name}: cites {ref} but file is missing")
    ref_dir = skill_dir / "references"
    if ref_dir.exists():
        for f in ref_dir.glob("*.md"):
            # Cited either as references/<name>.md (inline) or as a bare <name>.md
            # bullet in the "Reference Files" list. Both count.
            if f"references/{f.name}" not in content and f.name not in content:
                errors.append(f"{name}: orphan reference file references/{f.name} (never cited)")

    # Related Skills name real skills.
    for rel in related_skill_names(content):
        if rel != name and rel not in all_skill_names and rel != "qa-project-context":
            if rel in all_skill_names or rel in {s for s in all_skill_names}:
                continue
            errors.append(f"{name}: Related Skills references unknown skill '{rel}'")

    # Eval spec exists and has enough cases.
    spec = REPO / "evals" / f"{name}-evals.json"
    if not spec.exists():
        errors.append(f"{name}: missing eval spec evals/{name}-evals.json")
    else:
        try:
            cases = json.loads(spec.read_text()).get("evals", [])
            if len(cases) < MIN_EVALS:
                errors.append(f"{name}: only {len(cases)} eval cases (min {MIN_EVALS})")
        except json.JSONDecodeError as e:
            errors.append(f"{name}: eval spec is invalid JSON ({e})")

    return errors


def validate_repo(skill_names: set[str]) -> list[str]:
    errors = []
    n = len(skill_names)

    readme = (REPO / "README.md").read_text()
    badge = re.search(r"Skills-(\d+)-", readme)
    if badge and int(badge.group(1)) != n:
        errors.append(f"README: Skills badge says {badge.group(1)}, found {n} skills")
    count_claim = re.search(r"(\d+) skills across", readme)
    if count_claim and int(count_claim.group(1)) != n:
        errors.append(f"README: '{count_claim.group(1)} skills across' but found {n}")

    index = REPO / "skills_index.json"
    if index.exists():
        indexed = {s["name"] for s in json.loads(index.read_text()).get("skills", [])}
        missing = skill_names - indexed
        extra = indexed - skill_names
        if missing:
            errors.append(f"skills_index.json missing: {sorted(missing)}")
        if extra:
            errors.append(f"skills_index.json has phantom skills: {sorted(extra)}")
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
            lc = len((d / "SKILL.md").read_text().split("\n"))
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
