"""Regression tests for trustworthy eval scores; no model service is contacted.

Run with: python3 -m unittest discover -s tests -p 'test_run_evals.py' -v
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import eval_patterns  # noqa: E402
import run_evals  # noqa: E402


def case(**changes):
    value = {
        "id": "sample-001",
        "prompt": "Write a deterministic test for checkout.",
        "expected_patterns": ["toHaveURL"],
        "anti_patterns": ["waitForTimeout"],
    }
    value.update(changes)
    return value


class PatternTests(unittest.TestCase):
    def test_literal_metacharacters_and_multiline_wildcard(self):
        self.assertTrue(eval_patterns.matches("page.$$(", "const nodes = page.$$('a');"))
        self.assertFalse(eval_patterns.matches("page.$$(", "pageXYZ"))
        self.assertTrue(eval_patterns.matches("expect.*toHaveURL", "expect(page)\n.toHaveURL('/paid')"))

    def test_alternatives_may_contain_unclosed_function_calls(self):
        examples = [
            (".match( OR .exec( OR matchAll", "url.match(/token/)"),
            ("for (const OR forEach", "items.forEach(check)"),
            ("it.each([ OR test.each", "test.each(rows)"),
            ("page.goto(.*resetUrl OR page.goto(.*link OR goto(reset", "page.goto(resetUrl)"),
        ]
        for pattern, output in examples:
            with self.subTest(pattern=pattern):
                self.assertTrue(eval_patterns.matches(pattern, output))

    def test_group_alternation_and_function_arguments(self):
        self.assertEqual(eval_patterns.split_alternation("assert (red OR blue) OR green"),
                         ["assert (red OR blue)", "green"])
        self.assertTrue(eval_patterns.matches("assert (red|blue)", "assert blue"))
        self.assertFalse(eval_patterns.matches("assert (red|blue)", "assert green"))
        self.assertTrue(eval_patterns.matches("getByRole('listbox' OR 'menu')", "getByRole('menu')"))
        self.assertFalse(eval_patterns.matches("getByRole('listbox' OR 'menu')", "getByRole('button')"))

    def test_valid_groups_and_call_fragments_pass_spec_validation(self):
        for pattern in ("assert (red OR blue) OR green", "assert (red|blue)",
                        "getByRole('listbox' OR 'menu')", ".match( OR .exec(",
                        "foo\tOR\nbar"):
            with self.subTest(pattern=pattern):
                eval_patterns.validate_case(case(expected_patterns=[pattern]))

    def test_pipe_group_can_keep_a_leading_sql_or_literal(self):
        pattern = "(DROP TABLE|UNION SELECT|OR '1'='1)"
        eval_patterns.validate_case(case(expected_patterns=[pattern]))
        for output in ("DROP TABLE users", "UNION SELECT secret", "OR '1'='1"):
            with self.subTest(output=output):
                self.assertTrue(eval_patterns.matches(pattern, output))
        self.assertFalse(eval_patterns.matches(pattern, "SELECT 1"))

    def test_empty_alternatives_are_rejected_in_both_criteria_lists(self):
        for pattern in ("(foo|)", "(|foo)", "(foo||bar)", "( OR foo)",
                        "(foo OR )", "(foo OR OR bar)", "foo OR OR bar",
                        "foo OR OR ", "getByRole('listbox' OR )"):
            for field in ("expected_patterns", "anti_patterns"):
                with self.subTest(pattern=pattern, field=field):
                    with self.assertRaisesRegex(ValueError, "empty .*alternative"):
                        eval_patterns.validate_case(case(**{field: [pattern]}))

    def test_semantic_only_case_cannot_pass_empty_output(self):
        result = eval_patterns.check_case(case(
            expected_patterns=["explains every important design tradeoff clearly"],
            anti_patterns=["recommends deleting all failing tests immediately"],
        ), "")
        self.assertFalse(result.passed)
        self.assertIn("recommends deleting all failing tests immediately", result.semantic_anti)

    def test_absent_semantic_antipattern_is_still_deferred(self):
        result = eval_patterns.check_case(case(
            anti_patterns=["recommends deleting all failing tests immediately"],
        ), "expect(page).toHaveURL('/paid')")
        self.assertTrue(result.passed)
        self.assertEqual(result.semantic_anti, ["recommends deleting all failing tests immediately"])


class RepoFixture(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="qa-eval-test-")
        self.addCleanup(self.temporary.cleanup)
        self.repo = Path(self.temporary.name)
        (self.repo / "scripts").mkdir()
        (self.repo / "evals").mkdir()
        (self.repo / "skills" / "sample").mkdir(parents=True)
        for name in ("run_evals.py", "eval_patterns.py"):
            shutil.copy2(SCRIPTS / name, self.repo / "scripts" / name)
        self.skill = self.repo / "skills" / "sample" / "SKILL.md"
        self.skill.write_text("Use expect(page).toHaveURL('/paid').\n", encoding="utf-8")
        self.spec = self.repo / "evals" / "sample-evals.json"
        self.write_spec([case()])

    def write_spec(self, cases, **changes):
        spec = {"skill": "sample", "version": "1.0", "evals": cases}
        spec.update(changes)
        self.spec.write_text(json.dumps(spec), encoding="utf-8")

    def run_cli(self, *arguments, env=None):
        return subprocess.run(
            [sys.executable, str(self.repo / "scripts" / "run_evals.py"), *arguments],
            capture_output=True, text=True, cwd=self.repo, timeout=20, env=env,
        )

    def fake_claude(self, body):
        directory = self.repo / "bin"
        directory.mkdir(exist_ok=True)
        executable = directory / "claude"
        executable.write_text(f"#!{sys.executable}\n{body}\n", encoding="utf-8")
        executable.chmod(0o755)
        return dict(os.environ, PATH=str(directory) + os.pathsep + os.environ.get("PATH", ""))

    def assert_input_error(self, result):
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("ERROR", result.stderr.upper())
        self.assertNotIn("Traceback", result.stderr)


class WarningRegionTests(unittest.TestCase):
    def test_cue_hidden_by_emphasis_still_marks_a_warning(self):
        self.assertFalse(run_evals._recommends_antipattern(
            "poll the api", "Do **not** expose the endpoint and do **not** poll the API.\n"))

    def test_cue_on_the_next_line_of_the_same_sentence_counts(self):
        text = ("Client-side fakes (`jest.useFakeTimers`, sinon, mocking `Date`) do\n"
                "nothing to Stripe's billing engine.\n")
        self.assertFalse(run_evals._recommends_antipattern("jest.useFakeTimers", text))

    def test_cue_on_the_previous_line_of_the_same_sentence_counts(self):
        text = "- Goal prompt is natural language (no `page.locator` /\n  `data-testid` in the goal).\n"
        self.assertFalse(run_evals._recommends_antipattern("data-testid", text))

    def test_plain_recommendation_is_still_detected(self):
        self.assertTrue(run_evals._recommends_antipattern(
            "jest.useFakeTimers", "Use jest.useFakeTimers to move the billing date.\nThen assert.\n"))


class InputValidationTests(RepoFixture):
    def test_empty_suite_is_an_error(self):
        self.spec.unlink()
        self.assert_input_error(self.run_cli("--static"))

    def test_missing_skill_is_an_error_even_with_reference_text(self):
        self.skill.unlink()
        refs = self.skill.parent / "references"
        refs.mkdir()
        (refs / "patterns.md").write_text("toHaveURL", encoding="utf-8")
        self.assert_input_error(self.run_cli("--static"))

    def test_empty_skill_is_an_error(self):
        self.skill.write_text(" \n", encoding="utf-8")
        self.assert_input_error(self.run_cli("--static"))

    def test_all_mode_detects_skill_without_eval(self):
        other = self.repo / "skills" / "forgotten"
        other.mkdir()
        (other / "SKILL.md").write_text("Uncovered skill", encoding="utf-8")
        self.assert_input_error(self.run_cli("--all"))

    def test_invalid_json_is_a_concise_input_error(self):
        self.spec.write_text("{broken", encoding="utf-8")
        self.assert_input_error(self.run_cli("--static"))

    def test_malformed_eval_shapes_are_errors(self):
        malformed = [
            [], {}, {"skill": "sample", "evals": []},
            {"skill": "sample", "evals": {}},
            {"skill": "other", "evals": [case()]},
            {"skill": "sample", "evals": ["not a case"]},
            {"skill": "sample", "evals": [case(), case()]},
        ]
        for spec in malformed:
            with self.subTest(spec=spec):
                self.spec.write_text(json.dumps(spec), encoding="utf-8")
                self.assert_input_error(self.run_cli("--static", "--min-pass-rate", "0"))

    def test_invalid_case_fields_are_errors(self):
        malformed = [
            {"id": ""}, {"id": 1}, {"prompt": None}, {"prompt": "  "},
            {"expected_patterns": "toHaveURL"}, {"expected_patterns": []},
            {"expected_patterns": [None]}, {"expected_patterns": [""]},
            {"expected_patterns": ["toHaveURL OR "]},
            {"expected_patterns": [".*"]},
            {"anti_patterns": None}, {"anti_patterns": "waitForTimeout"},
        ]
        for changes in malformed:
            with self.subTest(changes=changes):
                self.write_spec([case(**changes)])
                self.assert_input_error(self.run_cli("--static"))

    def test_validation_precedes_model_calls(self):
        self.write_spec([case(), case(id="bad", prompt=None)])
        marker = self.repo / "model-was-called"
        env = self.fake_claude(f"from pathlib import Path\nPath({str(marker)!r}).touch()\nprint('toHaveURL')")
        self.assert_input_error(self.run_cli("--live", env=env))
        self.assertFalse(marker.exists())

    def test_malformed_group_or_repeated_or_is_rejected_before_model_calls(self):
        marker = self.repo / "model-was-called"
        env = self.fake_claude(f"from pathlib import Path\nPath({str(marker)!r}).touch()\nprint('toHaveURL')")
        for pattern in ("(toHaveURL OR )", "toHaveURL OR OR missing"):
            with self.subTest(pattern=pattern):
                self.write_spec([case(expected_patterns=[pattern])])
                self.assert_input_error(self.run_cli("--live", "--min-pass-rate", "0", env=env))
                self.assertFalse(marker.exists())


class ModelProcessTests(unittest.TestCase):
    def test_nonzero_exit_is_not_scored_as_output(self):
        with patch.object(run_evals.subprocess, "run", return_value=subprocess.CompletedProcess(
            [], 1, "toHaveURL", "authentication failed",
        )):
            with self.assertRaises(RuntimeError):
                run_evals.run_claude("Write a test", None)

    def test_stderr_and_empty_stdout_are_not_model_answers(self):
        for stdout, stderr in [("", "toHaveURL"), (" \n", ""), ("", "")]:
            with self.subTest(stdout=stdout, stderr=stderr):
                with patch.object(run_evals.subprocess, "run", return_value=subprocess.CompletedProcess(
                    [], 0, stdout, stderr,
                )):
                    with self.assertRaises(RuntimeError):
                        run_evals.run_claude("Write a test", None)

    def test_timeout_is_an_execution_error(self):
        with patch.object(run_evals.subprocess, "run", side_effect=subprocess.TimeoutExpired(
            "claude", 180, output=b"toHaveURL", stderr=b"partial output",
        )):
            with self.assertRaises(RuntimeError):
                run_evals.run_claude("Write a test", None)

    def test_success_scores_only_stdout(self):
        with patch.object(run_evals.subprocess, "run", return_value=subprocess.CompletedProcess(
            [], 0, "toHaveURL", "diagnostic waitForTimeout",
        )):
            self.assertEqual(run_evals.run_claude("Write a test", None), "toHaveURL")


class CLITests(RepoFixture):
    def test_live_only_case_is_reported_but_not_scored_in_static_mode(self):
        self.write_spec([case(), case(id="sample-002", static=False,
                                      expected_patterns=["https://ci.example.com/run/4821"])])
        output = self.repo / "result.json"
        result = self.run_cli("--static", "--min-pass-rate", "100", "--json", str(output))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        report = json.loads(output.read_text())[0]
        self.assertEqual((report["passed"], report["failed"], report["live_only"]), (1, 0, 1))
        self.assertEqual(report["checkable_cases"], 1)
        self.assertIn("LIVE-ONLY", result.stdout)
        env = self.fake_claude("print('Run https://ci.example.com/run/4821 is still under investigation; toHaveURL')")
        result = self.run_cli("--live", "--json", str(output), env=env)
        report = json.loads(output.read_text())[0]
        live_case = next(c for c in report["cases"] if c["id"] == "sample-002")
        self.assertEqual(live_case["status"], "pass", result.stdout + result.stderr)
        self.assertEqual(report["live_only"], 0)

    def test_static_field_must_be_boolean(self):
        self.write_spec([case(static="no")])
        self.assert_input_error(self.run_cli("--static"))

    def test_normal_static_run_records_scope(self):
        output = self.repo / "result.json"
        result = self.run_cli("--static", "--json", str(output))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        report = json.loads(output.read_text())[0]
        self.assertEqual(report["passed"], 1)
        self.assertEqual(report["scope"], "skill_content")
        self.assertIn("content", result.stdout.lower())

    def test_threshold_cannot_pass_semantic_only_case(self):
        self.write_spec([case(
            expected_patterns=["explains every important design tradeoff clearly"],
            anti_patterns=["recommends deleting all failing tests immediately"],
        )])
        output = self.repo / "result.json"
        result = self.run_cli("--min-pass-rate", "0", "--json", str(output))
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        report = json.loads(output.read_text())[0]
        self.assertEqual(report["passed"], 0)
        self.assertEqual(report["uncheckable"], 1)
        self.assertEqual(report["semantic_deferred"], 2)

    def test_invalid_thresholds_and_workers_are_usage_errors(self):
        for arguments in [
            ("--min-pass-rate", "-1"), ("--min-pass-rate", "101"),
            ("--min-pass-rate", "nan"), ("--min-pass-rate", "inf"),
            ("--workers", "0"), ("--workers", "-2"),
            ("--all", "--skill", "sample"),
        ]:
            with self.subTest(arguments=arguments):
                self.assert_input_error(self.run_cli(*arguments))

    def test_threshold_is_computed_from_actual_failures(self):
        self.write_spec([case(), case(id="sample-002", expected_patterns=["missing_token"])])
        self.assertEqual(self.run_cli("--min-pass-rate", "50").returncode, 0)
        self.assertEqual(self.run_cli("--min-pass-rate", "50.1").returncode, 1)
        self.assertEqual(self.run_cli().returncode, 1)

    def test_live_error_is_preserved_and_cannot_be_thresholded_away(self):
        output = self.repo / "result.json"
        env = self.fake_claude("import sys\nprint('toHaveURL')\nprint('auth failed', file=sys.stderr)\nsys.exit(3)")
        result = self.run_cli("--live", "--min-pass-rate", "0", "--json", str(output), env=env)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        report = json.loads(output.read_text())[0]
        self.assertEqual(report["errors"], 1)
        self.assertFalse(report["cases"][0]["passed"])
        self.assertIn("toHaveURL", report["cases"][0]["output"])
        self.assertIn("auth failed", report["cases"][0]["stderr"])

    def test_live_and_baseline_preserve_raw_outputs(self):
        env = self.fake_claude("import sys\nprint('toHaveURL live' if '--append-system-prompt' in sys.argv else 'toHaveURL baseline')")
        output = self.repo / "result.json"
        for mode in ("live", "baseline"):
            with self.subTest(mode=mode):
                result = self.run_cli(f"--{mode}", "--json", str(output), env=env)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                report = json.loads(output.read_text())[0]
                self.assertEqual(report["scope"], "model_output")
                self.assertIn(mode, report["cases"][0]["output"])

    def test_model_runs_do_not_inherit_repository_context(self):
        (self.repo / "CLAUDE.md").write_text("waitForTimeout", encoding="utf-8")
        env = self.fake_claude(
            "from pathlib import Path\n"
            "print(Path('CLAUDE.md').read_text() if Path('CLAUDE.md').exists() else 'toHaveURL')"
        )
        for mode in ("live", "baseline"):
            with self.subTest(mode=mode):
                result = self.run_cli(f"--{mode}", env=env)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_unsupported_isolation_flag_fails_with_upgrade_guidance(self):
        env = self.fake_claude("import sys\nprint('unknown option --safe-mode', file=sys.stderr)\nsys.exit(2)")
        result = self.run_cli("--live", env=env)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("update Claude Code", result.stdout)

    def test_baseline_can_run_before_skill_is_authored(self):
        self.skill.unlink()
        env = self.fake_claude("print('toHaveURL')")
        result = self.run_cli("--baseline", "--skill", "sample", env=env)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_missing_model_cli_is_a_concise_execution_error(self):
        env = dict(os.environ, PATH=str(self.repo / "no-executables"))
        result = self.run_cli("--live", env=env)
        self.assert_input_error(result)

    def test_json_write_error_is_concise(self):
        self.assert_input_error(self.run_cli("--json", str(self.repo)))


if __name__ == "__main__":
    unittest.main()
