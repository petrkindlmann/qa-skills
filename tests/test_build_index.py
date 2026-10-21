"""Index regeneration preserves curation while rejecting stale generated data."""

from __future__ import annotations

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import build_index as indexer


class IndexTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.repo = Path(temporary.name)
        self.skills = self.repo / "skills"
        self.skills.mkdir()
        self.index = self.repo / "skills_index.json"
        (self.repo / "VERSIONS.md").write_text("# Versions\n## v1.2.3\n")
        self.addCleanup(patch.stopall)
        patch.object(indexer, "REPO", self.repo).start()
        patch.object(indexer, "SKILLS", self.skills).start()
        patch.object(indexer, "INDEX", self.index).start()
        self.add_skill("example", "foundation")

    def add_skill(self, name, category):
        directory = self.skills / name
        directory.mkdir()
        (directory / "SKILL.md").write_text(
            f'---\nname: {name}\ndescription: >-\n  Do useful work.\n  Use when asked.\n'
            f'license: MIT\nmetadata: {{author: kindlmann, version: "1.0", category: {category}}}\n'
            '---\n\n<objective>Do useful work.</objective>\n', encoding="utf-8",
        )

    def write_current(self):
        data = indexer.build(indexer.current_version())
        self.index.write_text(json.dumps(data), encoding="utf-8")
        return data

    def run_cli(self, *args):
        output = io.StringIO()
        with patch.object(sys, "argv", ["build_index.py", *args]), \
                contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            status = indexer.main()
        return status, output.getvalue()

    def test_valid_inline_yaml_generates_real_metadata(self):
        built = indexer.build("1.2.3")
        self.assertEqual(built["skills"][0], {
            "name": "example", "path": "skills/example", "category": "foundation",
            "tags": ["foundation", "example"],
        })
        fm = indexer.read_frontmatter(self.skills / "example")
        self.assertEqual(fm["description"], "Do useful work. Use when asked.")

    def test_build_write_check_round_trip_ignores_json_whitespace(self):
        status, output = self.run_cli()
        self.assertEqual(status, 0, output)
        data = json.loads(self.index.read_text())
        self.index.write_text(json.dumps(data, separators=(",", ":")))
        status, output = self.run_cli("--check")
        self.assertEqual(status, 0, output)

    def test_curated_tags_including_empty_list_are_preserved_and_new_tags_derived(self):
        data = self.write_current()
        data["skills"][0]["tags"] = ["hand-authored", "domain-specific"]
        data["repository"] = "example/custom-fork"
        self.index.write_text(json.dumps(data))
        self.add_skill("new-testing", "automation")
        built = indexer.build("1.2.3")
        self.assertEqual(built["repository"], "example/custom-fork")
        self.assertEqual(built["skills"][0]["tags"], ["hand-authored", "domain-specific"])
        self.assertEqual(built["skills"][1]["tags"], ["automation", "new"])
        data["skills"][0]["tags"] = []
        self.index.write_text(json.dumps(data))
        self.assertEqual(indexer.build("1.2.3")["skills"][0]["tags"], [])

    def test_check_rejects_wrong_or_missing_path_and_preserves_file(self):
        data = self.write_current()
        for path in ("skills/WRONG", None):
            with self.subTest(path=path):
                if path is None:
                    data["skills"][0].pop("path")
                else:
                    data["skills"][0]["path"] = path
                self.index.write_text(json.dumps(data))
                before = self.index.read_bytes()
                status, output = self.run_cli("--check")
                self.assertEqual(status, 1, output)
                self.assertIn("STALE", output)
                self.assertEqual(self.index.read_bytes(), before)

    def test_check_rejects_version_drift_and_honors_explicit_override(self):
        data = self.write_current()
        data["version"] = "0.1.0"
        self.index.write_text(json.dumps(data))
        self.assertEqual(self.run_cli("--check")[0], 1)
        self.assertEqual(self.run_cli("--check", "--version", "0.1.0")[0], 0)

    def test_blank_version_override_cannot_create_or_overwrite_an_index(self):
        for existing in (False, True):
            if existing:
                self.write_current()
            before = self.index.read_bytes() if existing else None
            for version in ("", "   ", "\t\n"):
                with self.subTest(existing=existing, version=version):
                    status, output = self.run_cli("--version", version)
                    self.assertEqual(status, 1, output)
                    self.assertIn("version must be a nonempty string", output)
                    if existing:
                        self.assertEqual(self.index.read_bytes(), before)
                    else:
                        self.assertFalse(self.index.exists())

    def test_regeneration_repairs_paths_and_categories(self):
        data = self.write_current()
        data["skills"][0].update(path="skills/old", category="process", tags=["keep-me"])
        self.index.write_text(json.dumps(data))
        status, output = self.run_cli()
        self.assertEqual(status, 0, output)
        self.assertEqual(json.loads(self.index.read_text())["skills"][0], {
            "name": "example", "path": "skills/example", "category": "foundation", "tags": ["keep-me"],
        })

    def test_order_missing_and_phantom_skills_are_stale(self):
        self.add_skill("zebra", "process")
        data = self.write_current()
        for rows in (list(reversed(data["skills"])), data["skills"][:1],
                     data["skills"] + [{"name": "phantom", "path": "skills/phantom", "category": "process", "tags": []}]):
            with self.subTest(rows=rows):
                self.index.write_text(json.dumps({**data, "skills": rows}))
                self.assertEqual(self.run_cli("--check")[0], 1)

    def test_missing_index_is_stale_and_can_be_generated(self):
        self.assertEqual(self.run_cli("--check")[0], 1)
        self.assertFalse(self.index.exists())
        self.assertEqual(self.run_cli()[0], 0)
        self.assertEqual(self.run_cli("--check")[0], 0)

    def test_duplicate_names_invalid_shapes_and_tags_fail_without_overwriting(self):
        data = self.write_current()
        invalid = [[], {"skills": {}}, {"skills": [None]},
                   {**data, "skills": data["skills"] * 2},
                   {**data, "skills": [{**data["skills"][0], "tags": "not a list"}]},
                   {**data, "skills": [{**data["skills"][0], "tags": [None]}]},
                   {**data, "repository": []}]
        for value in invalid:
            with self.subTest(value=value):
                self.index.write_text(json.dumps(value))
                before = self.index.read_bytes()
                for args in ((), ("--check",)):
                    status, output = self.run_cli(*args)
                    self.assertEqual(status, 1, output)
                    self.assertIn("ERROR:", output)
                    self.assertNotIn("Traceback", output)
                    self.assertEqual(self.index.read_bytes(), before)

    def test_invalid_json_fails_with_an_actionable_error(self):
        self.index.write_text("{bad json")
        status, output = self.run_cli("--check")
        self.assertEqual(status, 1, output)
        self.assertIn("invalid JSON", output)
        self.assertNotIn("Traceback", output)

    def test_invalid_skill_metadata_does_not_generate_fallback_entries(self):
        data = self.write_current()
        skill = self.skills / "example" / "SKILL.md"
        original = skill.read_text()
        mutations = (original.replace("name: example", "name: another"),
                     original.replace("name: example", "name: wrong\nname: example"),
                     original.replace("description: >-\n  Do useful work.\n  Use when asked.", "description: [unclosed"),
                     original.replace("category: foundation", "category: unknown"),
                     original.replace('version: "1.0", ', ""),
                     "No frontmatter at all.")
        for text in mutations:
            with self.subTest(text=text):
                skill.write_text(text)
                status, output = self.run_cli()
                self.assertEqual(status, 1, output)
                self.assertIn("SKILL.md", output)
                self.assertEqual(json.loads(self.index.read_text()), data)

    def test_missing_skill_file_or_empty_tree_is_not_written_as_success(self):
        skill = self.skills / "example" / "SKILL.md"
        skill.unlink()
        status, output = self.run_cli()
        self.assertEqual(status, 1, output)
        self.assertFalse(self.index.exists())
        skill.parent.rmdir()
        status, output = self.run_cli()
        self.assertEqual(status, 1, output)
        self.assertIn("no skill directories", output)


if __name__ == "__main__":
    unittest.main()
