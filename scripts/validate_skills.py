#!/usr/bin/env python3
"""Validate all skills in the qa-skills repository.

Checks:
- SKILL.md exists in each skill directory
- YAML frontmatter is valid
- name matches directory name
- description is non-empty
- Line count is under 500
- Referenced files exist
"""

import os
import re
import sys
from pathlib import Path


def extract_frontmatter(content: str) -> dict | None:
    """Extract YAML frontmatter from SKILL.md content."""
    if not content.startswith("---"):
        return None

    end = content.find("---", 3)
    if end == -1:
        return None

    frontmatter = content[3:end].strip()
    result = {}

    for line in frontmatter.split("\n"):
        line = line.strip()
        if line.startswith("#") or not line:
            continue
        if ":" in line and not line.startswith(" ") and not line.startswith("-"):
            key, _, value = line.partition(":")
            result[key.strip()] = value.strip().strip('"').strip("'")

    return result


def find_referenced_files(content: str) -> list[str]:
    """Find references/ file paths mentioned in the content."""
    pattern = r"references/[a-z0-9-]+\.md"
    return list(set(re.findall(pattern, content)))


def validate_skill(skill_dir: Path) -> list[str]:
    """Validate a single skill directory. Returns list of errors."""
    errors = []
    skill_name = skill_dir.name
    skill_file = skill_dir / "SKILL.md"

    # Check SKILL.md exists
    if not skill_file.exists():
        errors.append(f"{skill_name}: SKILL.md not found")
        return errors

    content = skill_file.read_text()
    lines = content.split("\n")

    # Check line count
    line_count = len(lines)
    if line_count > 500:
        errors.append(f"{skill_name}: {line_count} lines (max 500)")

    # Check frontmatter
    frontmatter = extract_frontmatter(content)
    if frontmatter is None:
        errors.append(f"{skill_name}: missing or invalid YAML frontmatter")
        return errors

    # Check name matches directory
    fm_name = frontmatter.get("name", "")
    if fm_name != skill_name:
        errors.append(f"{skill_name}: name '{fm_name}' doesn't match directory")

    # Check description
    if "description" not in frontmatter and "description:" not in content[:500]:
        errors.append(f"{skill_name}: missing description")

    # Check referenced files exist
    refs = find_referenced_files(content)
    for ref in refs:
        ref_path = skill_dir / ref
        if not ref_path.exists():
            errors.append(f"{skill_name}: references {ref} but file doesn't exist")

    return errors


def main():
    # Find skills directory
    repo_root = Path(__file__).parent.parent
    skills_dir = repo_root / "skills"

    if not skills_dir.exists():
        print("ERROR: skills/ directory not found")
        sys.exit(1)

    skill_dirs = sorted(
        [d for d in skills_dir.iterdir() if d.is_dir() and not d.name.startswith(".")]
    )

    if not skill_dirs:
        print("ERROR: no skill directories found")
        sys.exit(1)

    all_errors = []
    for skill_dir in skill_dirs:
        errors = validate_skill(skill_dir)
        if errors:
            all_errors.extend(errors)
            for err in errors:
                print(f"  FAIL: {err}")
        else:
            skill_file = skill_dir / "SKILL.md"
            line_count = len(skill_file.read_text().split("\n"))
            print(f"  OK:   {skill_dir.name} ({line_count} lines)")

    print()
    print(f"Skills: {len(skill_dirs)}")
    print(f"Errors: {len(all_errors)}")

    if all_errors:
        print("\nValidation FAILED")
        sys.exit(1)
    else:
        print("\nAll skills valid")


if __name__ == "__main__":
    main()
