"""Regression tests for the semantic judge; no model service is contacted.

Run with: python3 -m unittest discover -s tests -p 'test_judge_evals.py' -v
"""

from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import judge_evals  # noqa: E402
import run_evals  # noqa: E402

DOCUMENT = ("## Waiting\n\nWait for the confirmation heading to be visible before asserting.\n"
            "Never retry a failing test until it passes; find the cause.\n")
CASE = {
    "id": "case-001",
    "prompt": "Write the checkout test.",
    "expected_patterns": ["toBeVisible", "waits for a visible confirmation element before asserting"],
    "anti_patterns": ["waitForTimeout", "retrying a failing test until it passes instead of fixing it"],
}


def envelope(verdicts, **extra):
    body = {"type": "result", "subtype": "success", "is_error": False,
            "result": json.dumps({"verdicts": verdicts}),
            "modelUsage": {"claude-test": {}}, "total_cost_usd": 0.01, "duration_ms": 5}
    body.update(extra)
    return json.dumps(body)


class CriteriaTests(unittest.TestCase):
    def test_collects_only_the_semantic_criteria_in_order(self):
        criteria = judge_evals.collect_criteria(CASE, DOCUMENT)
        self.assertEqual([(c["kind"], c["text"]) for c in criteria], [
            ("expected", "waits for a visible confirmation element before asserting"),
            ("anti", "retrying a failing test until it passes instead of fixing it"),
        ])
        self.assertTrue(all(c["case"] == "case-001" for c in criteria))

    def test_prompt_numbers_criteria_and_tags_their_kind(self):
        prompt = judge_evals.build_prompt(DOCUMENT, judge_evals.collect_criteria(CASE, DOCUMENT))
        self.assertIn("1. [expected] waits for a visible", prompt)
        self.assertIn("2. [anti] retrying a failing test", prompt)
        self.assertIn(DOCUMENT, prompt)


class EvidenceTests(unittest.TestCase):
    def test_quote_matches_across_whitespace_and_case(self):
        self.assertTrue(judge_evals.evidence_found("confirmation heading\n  TO BE visible", DOCUMENT))

    def test_short_or_absent_quotes_are_rejected(self):
        self.assertFalse(judge_evals.evidence_found("Wait for", DOCUMENT))
        self.assertFalse(judge_evals.evidence_found("verify the webhook signature first", DOCUMENT))


class ParsingTests(unittest.TestCase):
    def test_envelope_exposes_result_model_and_cost(self):
        parsed = judge_evals.parse_envelope(envelope([]))
        self.assertEqual(parsed["model"], "claude-test")
        self.assertEqual(parsed["cost_usd"], 0.01)
        self.assertEqual(json.loads(parsed["result"]), {"verdicts": []})

    def test_envelope_errors_are_rejected(self):
        with self.assertRaises(ValueError):
            judge_evals.parse_envelope(envelope([], is_error=True, subtype="error_max_turns"))
        with self.assertRaises(ValueError):
            judge_evals.parse_envelope("plain text, not an envelope")

    def test_verdicts_accept_fences_and_reject_wrong_counts_or_values(self):
        fenced = "```json\n" + json.dumps({"verdicts": [{"n": 1, "verdict": "Yes", "evidence": "x"}]}) + "\n```"
        self.assertEqual(judge_evals.parse_verdicts(fenced, 1)[0]["verdict"], "yes")
        with self.assertRaises(ValueError):
            judge_evals.parse_verdicts(json.dumps({"verdicts": [{"n": 1, "verdict": "yes"}]}), 2)
        with self.assertRaises(ValueError):
            judge_evals.parse_verdicts(json.dumps({"verdicts": [{"n": 1, "verdict": "maybe"}]}), 1)
        with self.assertRaises(ValueError):
            judge_evals.parse_verdicts(json.dumps({"verdicts": [{"n": 2, "verdict": "yes"}]}), 1)


class JudgeDocumentTests(unittest.TestCase):
    def setUp(self):
        self.criteria = judge_evals.collect_criteria(CASE, DOCUMENT)

    def test_yes_needs_verified_evidence(self):
        def run(prompt, system, output_format):
            self.assertEqual(output_format, "json")
            return envelope([
                {"n": 1, "verdict": "yes", "evidence": "confirmation heading to be visible before asserting"},
                {"n": 2, "verdict": "yes", "evidence": "retry the test three times"},
            ])
        judged = judge_evals.judge_document(DOCUMENT, self.criteria, run)
        self.assertIsNone(judged["error"])
        self.assertEqual([i["status"] for i in judged["items"]], ["taught", "unverified"])

    def test_no_verdicts_map_per_kind(self):
        run = lambda *a, **k: envelope([{"n": 1, "verdict": "no"}, {"n": 2, "verdict": "no"}])
        statuses = [i["status"] for i in judge_evals.judge_document(DOCUMENT, self.criteria, run)["items"]]
        self.assertEqual(statuses, ["not_taught", "not_recommended"])

    def test_model_trouble_becomes_error_items_not_passes(self):
        def run(*a, **k):
            raise run_evals.ModelRunError("`claude` timed out after 180 seconds")
        judged = judge_evals.judge_document(DOCUMENT, self.criteria, run)
        self.assertIn("timed out", judged["error"])
        self.assertEqual({i["status"] for i in judged["items"]}, {"error"})
        self.assertEqual(judge_evals.summarize({"items": judged["items"]})["incomplete"], 2)

    def test_no_criteria_means_no_call(self):
        def run(*a, **k):
            raise AssertionError("must not call the model")
        self.assertEqual(judge_evals.judge_document(DOCUMENT, [], run)["items"], [])


class ResultsFileTests(unittest.TestCase):
    def test_judges_recorded_outputs_and_rejects_static_results(self):
        spec = {"skill": "sample", "version": "1", "evals": [CASE]}
        with tempfile.TemporaryDirectory() as tmp:
            spec_path = Path(tmp) / "sample-evals.json"
            spec_path.write_text(json.dumps(spec), encoding="utf-8")
            results = Path(tmp) / "live.json"
            results.write_text(json.dumps([{"skill": "sample", "mode": "live", "cases": [
                {"id": "case-001", "status": "pass", "output": DOCUMENT},
                {"id": "case-001", "status": "error", "error": "timeout"},
            ]}]), encoding="utf-8")
            run = lambda *a, **k: envelope([
                {"n": 1, "verdict": "yes", "evidence": "confirmation heading to be visible"},
                {"n": 2, "verdict": "no"},
            ])
            with unittest.mock.patch.object(run_evals, "eval_specs", return_value={"sample": spec_path}):
                reports = judge_evals.judge_results(results, None, run)
                self.assertEqual(reports[0]["calls"], 1)
                self.assertTrue(reports[0]["cases"][0]["semantic_pass"])
                self.assertIn("no recorded output", reports[0]["error"])
                results.write_text(json.dumps([{"skill": "sample", "mode": "static", "cases": []}]),
                                   encoding="utf-8")
                with self.assertRaises(ValueError):
                    judge_evals.judge_results(results, None, run)


import unittest.mock  # noqa: E402

if __name__ == "__main__":
    unittest.main()
