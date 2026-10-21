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

if __package__:
    from .skill_format import CATEGORY_ORDER, frontmatter_errors, parse_frontmatter
else:
    from skill_format import CATEGORY_ORDER, frontmatter_errors, parse_frontmatter

REPO = Path(__file__).parent.parent
SKILLS = REPO / "skills"
INDEX = REPO / "skills_index.json"


def read_frontmatter(skill_dir: Path) -> dict:
    skill_file = skill_dir / "SKILL.md"
    try:
        fm, _ = parse_frontmatter(skill_file.read_text(encoding="utf-8"))
    except ValueError as exc:
        raise ValueError(f"{skill_file}: {exc}") from exc
    errors = frontmatter_errors(fm, skill_dir.name)
    if errors:
        raise ValueError(f"{skill_file}: {'; '.join(errors)}")
    return fm


def load_existing_index(index_path: Path | None = None) -> dict:
    """Read recoverable curated metadata; never silently overwrite malformed data.

    Generated fields (paths, categories, ordering, and missing tags) may be stale
    and are repaired by build(). Ambiguous names or invalid tag data need an
    explicit fix before we can safely preserve the author's curated tags.
    """
    index_path = INDEX if index_path is None else index_path
    if not index_path.exists():
        return {"skills": []}
    try:
        data = json.loads(index_path.read_text(encoding="utf-8"))
    except (ValueError, UnicodeError) as exc:
        raise ValueError(f"{index_path.name}: invalid JSON ({exc})") from exc
    if not isinstance(data, dict) or not isinstance(data.get("skills"), list):
        raise ValueError(f"{index_path.name}: expected an object with a skills list")
    for field in ("repository", "version"):
        if field in data and (not isinstance(data[field], str) or not data[field].strip()):
            raise ValueError(f"{index_path.name}: {field} must be a nonempty string")
    seen = set()
    for i, skill in enumerate(data["skills"]):
        if (not isinstance(skill, dict) or not isinstance(skill.get("name"), str)
                or not skill["name"].strip()):
            raise ValueError(f"{index_path.name}: skills[{i}] needs a nonempty name")
        name = skill["name"]
        if name in seen:
            raise ValueError(f"{index_path.name}: duplicate skill {name!r}")
        seen.add(name)
        if "tags" in skill and (not isinstance(skill["tags"], list) or any(
                not isinstance(tag, str) or not tag.strip() for tag in skill["tags"])):
            raise ValueError(f"{index_path.name}: tags for {name!r} must be a list of nonempty strings")
    return data


def load_existing_tags(index_path: Path | None = None) -> dict[str, list[str]]:
    data = load_existing_index(index_path)
    return {s["name"]: s["tags"] for s in data["skills"] if "tags" in s}


def derive_tags(name: str, category: str) -> list[str]:
    tokens = [t for t in name.split("-") if t not in {"testing", "test", "qa"}]
    tags = list(dict.fromkeys([category] + tokens))
    return tags[:6]


def build(version: str, *, skills_dir: Path | None = None,
          index_path: Path | None = None) -> dict:
    if not isinstance(version, str) or not version.strip():
        raise ValueError("version must be a nonempty string")
    skills_dir = SKILLS if skills_dir is None else skills_dir
    current = load_existing_index(index_path)
    existing = {s["name"]: s["tags"] for s in current["skills"] if "tags" in s}
    skills = []
    dirs = sorted(d for d in skills_dir.iterdir() if d.is_dir() and not d.name.startswith("."))
    if not dirs:
        raise ValueError(f"{skills_dir}: no skill directories found")
    for d in dirs:
        fm = read_frontmatter(d)
        name = fm["name"]
        category = fm["metadata"]["category"]
        tags = existing[name] if name in existing else derive_tags(name, category)
        skills.append({
            "name": name,
            "path": f"skills/{d.name}",
            "category": category,
            "tags": tags,
        })
    skills.sort(key=lambda s: (CATEGORY_ORDER.index(s["category"])
                               if s["category"] in CATEGORY_ORDER else 99, s["name"]))
    repo = current.get("repository", "petrkindlmann/qa-skills")
    return {"repository": repo, "version": version, "skills": skills}


def current_version(repo: Path | None = None, index_path: Path | None = None) -> str:
    versions = (REPO if repo is None else repo) / "VERSIONS.md"
    if versions.exists():
        m = re.search(r"v(\d+\.\d+\.\d+)", versions.read_text(encoding="utf-8"))
        if m:
            return m.group(1)
    return load_existing_index(index_path).get("version", "0.0.0")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="exit 1 if index is stale")
    ap.add_argument("--version", help="override version string")
    args = ap.parse_args()

    try:
        version = args.version if args.version is not None else current_version()
        built = build(version)
        if args.check:
            # Compare all generated data, including paths, order, and the version
            # driven by VERSIONS.md. JSON whitespace is intentionally irrelevant.
            if load_existing_index() != built:
                print("skills_index.json is STALE — run scripts/build_index.py")
                return 1
            print(f"skills_index.json in sync ({len(built['skills'])} skills)")
            return 0

        INDEX.write_text(json.dumps(built, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {INDEX.name}: {len(built['skills'])} skills @ v{version}")
        return 0
    except (OSError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
