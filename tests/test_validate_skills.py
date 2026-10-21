"""Regression fixtures for the validator's documented authoring contract."""

from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import validate_skills as validator
from skill_format import parse_frontmatter


FRONTMATTER = '''---
name: example
description: A useful description.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: foundation
---
'''
BODY = '''
<objective>Produce an artifact with a verified result.</objective>

## Discovery Questions
Check `.agents/qa-project-context.md` and use the existing answers.

## Core Principles
1. Verify the observable result.

## Workflow
Create the artifact and run its check.

## Anti-Patterns
Avoid trusting a check that never fails.

## Done When
- [ ] The check exits zero.

## Related Skills
- **other** — Use this for the follow-up work.
'''


class ValidatorFixtures(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.repo = Path(temporary.name)
        self.skill_dir = self.repo / "skills" / "example"
        self.skill_dir.mkdir(parents=True)
        (self.repo / "evals").mkdir()
        self.skill_file = self.skill_dir / "SKILL.md"
        self.spec_path = self.repo / "evals" / "example-evals.json"
        self.spec = {
            "skill": "example", "version": "1.0",
            "evals": [{"id": f"case-{i}", "prompt": "Create an artifact and verify it.",
                       "expected_patterns": ["artifact"], "anti_patterns": []}
                      for i in range(8)],
        }
        self.spec_path.write_text(json.dumps(self.spec), encoding="utf-8")
        self.skill_file.write_text(FRONTMATTER + BODY, encoding="utf-8")
        self.addCleanup(patch.stopall)
        patch.object(validator, "REPO", self.repo).start()
        patch.object(validator, "SKILLS_DIR", self.repo / "skills").start()

    def check(self, text=None):
        if text is not None:
            self.skill_file.write_text(text, encoding="utf-8")
        return validator.validate_skill(self.skill_dir, {"example", "other"})

    def assert_invalid(self, text, fragment):
        errors = self.check(text)
        self.assertTrue(any(fragment in error for error in errors), errors)

    def reference(self, path):
        target = self.skill_dir / "references" / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("Supporting material.\n", encoding="utf-8")

    def repo_index(self):
        (self.repo / "README.md").write_text("Skills-1-green\n1 skills across categories\n")
        (self.repo / "VERSIONS.md").write_text("# Versions\n## v1.0.0\n")
        data = {
            "repository": "petrkindlmann/qa-skills", "version": "1.0.0",
            "skills": [{"name": "example", "category": "foundation",
                        "path": "skills/example", "tags": ["curated"]}],
        }
        (self.repo / "skills_index.json").write_text(json.dumps(data))
        return data


class FrontmatterTests(ValidatorFixtures):
    def test_valid_house_template(self):
        self.assertEqual(self.check(), [])

    def test_folded_description_inline_mapping_and_inline_comments_are_yaml(self):
        header = '''---
name: example # directory name
description: >-
  A useful description with --- inside it.
  Related: other.
license: MIT
metadata: {author: kindlmann, version: "1.0", category: foundation}
---
'''
        data, body = parse_frontmatter(header + BODY)
        self.assertEqual(data["description"], "A useful description with --- inside it. Related: other.")
        self.assertEqual(body, BODY)
        self.assertEqual(self.check(header + BODY), [])

    def test_yaml_alias_and_merge_with_explicit_override_remain_valid(self):
        header = FRONTMATTER.replace(
            "metadata:\n  author: kindlmann\n  version: \"1.0\"\n  category: foundation",
            "defaults: &defaults {author: kindlmann, version: \"1.0\", category: process}\n"
            "metadata:\n  <<: *defaults\n  category: foundation",
        )
        self.assertEqual(self.check(header + BODY), [])

    def test_invalid_yaml_and_duplicate_keys_are_rejected(self):
        mutations = {
            "invalid sequence": FRONTMATTER.replace("description: A useful description.", "description: [unclosed"),
            "duplicate name": FRONTMATTER.replace("name: example", "name: wrong\nname: example"),
            "duplicate nested field": FRONTMATTER.replace("  author: kindlmann", "  author: old\n  author: kindlmann"),
            "unsafe constructor": FRONTMATTER.replace("description: A useful description.", "description: !!python/object:builtins.object {}"),
        }
        for label, header in mutations.items():
            with self.subTest(label=label):
                self.assert_invalid(header + BODY, "YAML")

    def test_missing_or_invalid_frontmatter_delimiters_fail(self):
        for header in (FRONTMATTER.replace("---\n", "----\n", 1),
                       FRONTMATTER.rsplit("---\n", 1)[0], "---\n- name: example\n---\n"):
            with self.subTest(header=header):
                self.assert_invalid(header + BODY, "frontmatter")

    def test_required_fields_have_real_types_and_values(self):
        mutations = [
            ("name: example", "name: wrong", "name"),
            ("description: A useful description.", "", "description"),
            ("description: A useful description.", "description:", "description"),
            ("description: A useful description.", "description: >-\n  ", "description"),
            ("description: A useful description.", "description: [a, list]", "description"),
            ("license: MIT", "", "license"),
            ("license: MIT", "license: Apache-2.0", "license"),
            ("  author: kindlmann", "", "metadata.author"),
            ("  version: \"1.0\"", "", "metadata.version"),
            ("  version: \"1.0\"", "  version: 1.0", "metadata.version"),
            ("  category: foundation", "", "metadata.category"),
            ("  category: foundation", "  category: invented", "whitelist"),
        ]
        for old, new, message in mutations:
            with self.subTest(replacement=new, field=message):
                self.assert_invalid(FRONTMATTER.replace(old, new) + BODY, message)

    def test_metadata_is_not_confused_with_unrelated_nested_fields(self):
        header = FRONTMATTER.replace("metadata:", "settings:")
        self.assert_invalid(header + BODY, "metadata")

    def test_exact_line_limit_counts_lines_not_trailing_newline(self):
        text = FRONTMATTER + BODY
        text += "extra\n" * (validator.MAX_LINES - len(text.splitlines()))
        self.assertEqual(self.check(text), [])
        self.assert_invalid(text + "one more\n", "651 lines")


class BodyTests(ValidatorFixtures):
    def test_objective_must_be_closed_nonempty_and_outside_code(self):
        for objective in ("<objective>", "<objective> </objective>",
                          "<objective><!-- hidden --></objective>",
                          "<objective><objective>nested</objective>",
                          "```xml\n<objective>Only an example.</objective>\n```"):
            with self.subTest(objective=objective):
                body = BODY.replace("<objective>Produce an artifact with a verified result.</objective>", objective)
                self.assert_invalid(FRONTMATTER + body, "objective")

    def test_required_headings_only_in_code_comments_or_frontmatter_do_not_count(self):
        for title in validator.REQUIRED_SECTIONS:
            for hidden in (f"```markdown\n## {title}\n```", f"~~~markdown\n## {title}\n~~~",
                           f"<!--\n## {title}\n-->", f"### {title}", f"## {title} example"):
                with self.subTest(title=title, hidden=hidden):
                    self.assert_invalid(FRONTMATTER + BODY.replace(f"## {title}", hidden),
                                        f"missing required section '## {title}'")
        header = FRONTMATTER.replace("description: A useful description.",
                                     "description: |-\n  ## Done When")
        self.assert_invalid(header + BODY.replace("## Done When", "## Completion"), "## Done When")

    def test_empty_and_duplicate_required_sections_fail(self):
        empty = BODY.replace("1. Verify the observable result.", "<!-- intentionally blank -->")
        self.assert_invalid(FRONTMATTER + empty, "empty required section '## Core Principles'")
        self.assert_invalid(FRONTMATTER + BODY + "\n## Done When\nA duplicate.\n", "duplicate required section")

    def test_literal_html_comment_opening_in_fence_does_not_hide_real_sections(self):
        self.assertEqual(self.check(FRONTMATTER + "\n```html\n<!--\n```\n" + BODY), [])

    def test_longer_fences_and_closing_hashes_are_supported(self):
        prefix = "\n````markdown\n```\n## Related Skills\n- **missing** — Example only.\n````\n"
        self.assertEqual(self.check(FRONTMATTER + prefix + BODY.replace("## Done When", "## Done When ##")), [])

    def test_minimal_starter_preserves_its_existing_section_exemptions(self):
        self.skill_dir = self.skill_dir.rename(self.skill_dir.with_name("qa-start"))
        self.skill_file = self.skill_dir / "SKILL.md"
        self.spec["skill"] = "qa-start"
        (self.repo / "evals" / "qa-start-evals.json").write_text(json.dumps(self.spec))
        text = FRONTMATTER.replace("name: example", "name: qa-start")
        text += "\n<objective>Chain the foundation skills.</objective>\n## Related Skills\n- **other** — Continue there.\n"
        self.assertEqual(self.check(text), [])


class CrossReferenceTests(ValidatorFixtures):
    def test_unknown_related_skill_is_checked_in_all_existing_formats(self):
        for label in ("**missing**", "`missing`", "**`missing`**", "[missing](../missing/SKILL.md)", "missing"):
            with self.subTest(label=label):
                self.assert_invalid(FRONTMATTER + BODY.replace("**other**", label), "unknown skill 'missing'")

    def test_multiple_related_names_and_incidental_code_in_explanation(self):
        body = BODY.replace("**other**", "**other** / **missing**")
        self.assert_invalid(FRONTMATTER + body, "unknown skill 'missing'")
        body = BODY.replace("Use this for the follow-up work.", "Run `some-command` for the follow-up work.")
        self.assertEqual(self.check(FRONTMATTER + body), [])

    def test_explicit_plugin_qualified_external_skills_are_not_local_paths(self):
        body = BODY + "- **systematic-debugging** (`superpowers:systematic-debugging`) — Debug after reproduction.\n"
        self.assertEqual(self.check(FRONTMATTER + body), [])

    def test_related_section_stops_at_a_peer_or_reference_subsection(self):
        self.assertEqual(self.check(FRONTMATTER + BODY + "\n## Notes\n- **missing** — Only an example.\n"), [])
        self.reference("setup.md")
        body = BODY + "\n### Reference Files (in `references/`)\n| `setup.md` | Useful detail |\n"
        self.assertEqual(self.check(FRONTMATTER + body), [])

    def test_missing_nested_and_executable_references_fail(self):
        for path in ("nested/setup.md", "check.mjs", "Setup_V2.md"):
            with self.subTest(path=path):
                self.assert_invalid(FRONTMATTER + BODY + f"\nSee `references/{path}`.\n", f"cites references/{path}")

    def test_existing_nested_files_and_script_command_are_citations(self):
        self.reference("nested/setup.md")
        self.reference("check.mjs")
        body = BODY + "\nSee [setup](references/nested/setup.md#details).\n```sh\nnode references/check.mjs\n```\n"
        self.assertEqual(self.check(FRONTMATTER + body), [])

    def test_bare_reference_labels_are_supported_in_lists_and_tables(self):
        self.reference("setup.md")
        self.reference("nested/check.mjs")
        body = BODY + "\n## Reference Files (in `references/`)\n- **setup.md** — Configures `unrelated.config.ts`.\n| `nested/check.mjs` | Executable check |\n"
        self.assertEqual(self.check(FRONTMATTER + body), [])

    def test_missing_bare_reference_label_is_rejected(self):
        self.assert_invalid(FRONTMATTER + BODY + "\n## Reference Files\n- **missing.md** — Setup.\n", "cites references/missing.md")

    def test_orphans_are_checked_recursively_and_for_executable_files(self):
        for path in ("root.md", "nested/orphan.md", "unused.mjs"):
            self.reference(path)
        errors = self.check()
        for path in ("root.md", "nested/orphan.md", "unused.mjs"):
            self.assertTrue(any(f"orphan reference file references/{path}" in error for error in errors), errors)

    def test_filename_substrings_and_uncited_prose_do_not_hide_orphans(self):
        self.reference("patterns.md")
        self.reference("test-patterns.md")
        self.assert_invalid(FRONTMATTER + BODY + "\nSee `references/test-patterns.md`.\n", "orphan reference file references/patterns.md")

    def test_reference_must_be_a_file_inside_references(self):
        (self.skill_dir / "outside.md").write_text("Outside the reference tree.")
        self.assert_invalid(FRONTMATTER + BODY + "\nSee `references/../outside.md`.\n", "escapes references/")
        (self.skill_dir / "references" / "directory.md").mkdir(parents=True)
        self.assert_invalid(FRONTMATTER + BODY + "\nSee `references/directory.md`.\n", "file is missing")


class EvalAndRepositoryTests(ValidatorFixtures):
    def test_malformed_eval_shapes_report_errors_instead_of_passing_or_crashing(self):
        for spec in ([], {"evals": "12345678"}, {"evals": [{}] * 8},
                     {"skill": "wrong", "evals": self.spec["evals"]}):
            with self.subTest(spec=spec):
                self.spec_path.write_text(json.dumps(spec))
                self.assertTrue(any("invalid eval spec" in error for error in self.check()))

    def test_eval_case_checks_are_validated_before_counting_them(self):
        for field, value in (("expected_patterns", []), ("prompt", ""), ("anti_patterns", "forbidden")):
            with self.subTest(field=field):
                spec = copy.deepcopy(self.spec)
                spec["evals"][0][field] = value
                self.spec_path.write_text(json.dumps(spec))
                self.assertTrue(any("invalid eval spec" in error for error in self.check()))

    def test_eval_minimum_and_missing_spec_remain_enforced(self):
        self.spec["evals"].pop()
        self.spec_path.write_text(json.dumps(self.spec))
        self.assertTrue(any("only 7 eval cases" in error for error in self.check()))
        self.spec_path.unlink()
        self.assertTrue(any("missing eval spec" in error for error in self.check()))

    def test_valid_generated_index_and_counts(self):
        self.repo_index()
        self.assertEqual(validator.validate_repo({"example"}), [])

    def test_missing_malformed_or_duplicate_index_fails_cleanly(self):
        data = self.repo_index()
        index = self.repo / "skills_index.json"
        index.unlink()
        self.assertTrue(any("missing" in e for e in validator.validate_repo({"example"})))
        for value in ([], {"skills": [1]}, {"skills": "example"},
                      {**data, "skills": data["skills"] * 2}):
            with self.subTest(value=value):
                index.write_text(json.dumps(value))
                self.assertTrue(validator.validate_repo({"example"}))
        index.write_text("{invalid")
        self.assertTrue(any("invalid JSON" in e for e in validator.validate_repo({"example"})))

    def test_index_path_category_version_and_missing_fields_are_checked(self):
        for field, value in (("path", "skills/wrong"), ("category", "process"), ("tags", None)):
            with self.subTest(field=field):
                data = self.repo_index()
                if value is None:
                    data["skills"][0].pop(field)
                else:
                    data["skills"][0][field] = value
                (self.repo / "skills_index.json").write_text(json.dumps(data))
                self.assertTrue(validator.validate_repo({"example"}))
        data = self.repo_index()
        data["version"] = "0.1.0"
        (self.repo / "skills_index.json").write_text(json.dumps(data))
        self.assertTrue(validator.validate_repo({"example"}))

    def test_readme_count_mismatch_is_reported(self):
        self.repo_index()
        (self.repo / "README.md").write_text("Skills-2-green\n2 skills across categories\n")
        errors = validator.validate_repo({"example"})
        self.assertEqual(len(errors), 2, errors)


if __name__ == "__main__":
    unittest.main()
