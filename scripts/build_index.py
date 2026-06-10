#!/usr/bin/env python3
"""Regenerate skills_index.json from the skills/ tree.

The index is a generated artifact, not a hand-maintained file — keeping it in
sync by hand is exactly the drift that left it stranded at v2.5.0. Curated tags
are preserved: existing tags for a skill are kept; brand-new skills get tags
derived from their category plus name tokens, which a human can refine later.

    python scripts/build_index.py            # write skills_index.json
    python scripts/build_index.py --check    # exit 1 if out of date (CI)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).parent.parent
SKILLS = REPO / "skills"
INDEX = REPO / "skills_index.json"

# Order matters for readability; mirrors README category grouping.
CATEGORY_ORDER = [
    "foundation", "strategy", "automation", "specialized",
    "ai-qa", "infrastructure", "metrics", "process",
    "production", "knowledge",
]


def read_frontmatter(skill_dir: Path) -> dict:
    text = (skill_dir / "SKILL.md").read_text()
    if not text.startswith("---"):
        return {}
    end = text.find("---", 3)
    block = text[3:end]
    fm = {}
    for line in block.splitlines():
        m = re.match(r"^(\w[\w-]*):\s*(.*)$", line)
        if m:
            fm[m.group(1)] = m.group(2).strip().strip('"').strip("'")
        m2 = re.match(r"^\s+(category|version|author):\s*(.*)$", line)
        if m2:
            fm[m2.group(1)] = m2.group(2).strip().strip('"').strip("'")
    return fm


def load_existing_tags() -> dict[str, list[str]]:
    if not INDEX.exists():
        return {}
    data = json.loads(INDEX.read_text())
    return {s["name"]: s.get("tags", []) for s in data.get("skills", [])}


def derive_tags(name: str, category: str) -> list[str]:
    tokens = [t for t in name.split("-") if t not in {"testing", "test", "qa"}]
    tags = list(dict.fromkeys([category] + tokens))
    return tags[:6]


def build(version: str) -> dict:
    existing = load_existing_tags()
    skills = []
    dirs = sorted(d for d in SKILLS.iterdir() if d.is_dir() and not d.name.startswith("."))
    for d in dirs:
        fm = read_frontmatter(d)
        name = fm.get("name", d.name)
        category = fm.get("category", "uncategorized")
        tags = existing.get(name) or derive_tags(name, category)
        skills.append({
            "name": name,
            "path": f"skills/{d.name}",
            "category": category,
            "tags": tags,
        })
    skills.sort(key=lambda s: (CATEGORY_ORDER.index(s["category"])
                               if s["category"] in CATEGORY_ORDER else 99, s["name"]))
    repo = "petrkindlmann/qa-skills"
    if INDEX.exists():
        repo = json.loads(INDEX.read_text()).get("repository", repo)
    return {"repository": repo, "version": version, "skills": skills}


def current_version() -> str:
    versions = REPO / "VERSIONS.md"
    if versions.exists():
        m = re.search(r"v(\d+\.\d+\.\d+)", versions.read_text())
        if m:
            return m.group(1)
    if INDEX.exists():
        return json.loads(INDEX.read_text()).get("version", "0.0.0")
    return "0.0.0"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="exit 1 if index is stale")
    ap.add_argument("--version", help="override version string")
    args = ap.parse_args()

    version = args.version or current_version()
    built = build(version)
    serialized = json.dumps(built, indent=2) + "\n"

    if args.check:
        current = INDEX.read_text() if INDEX.exists() else ""
        # Compare skill sets/categories, not the version string (which VERSIONS drives).
        cur = json.loads(current) if current else {"skills": []}
        if [(s["name"], s["category"]) for s in cur["skills"]] != \
           [(s["name"], s["category"]) for s in built["skills"]]:
            print("skills_index.json is STALE — run scripts/build_index.py")
            sys.exit(1)
        print(f"skills_index.json in sync ({len(built['skills'])} skills)")
        return

    INDEX.write_text(serialized)
    print(f"Wrote {INDEX.name}: {len(built['skills'])} skills @ v{version}")


if __name__ == "__main__":
    main()
