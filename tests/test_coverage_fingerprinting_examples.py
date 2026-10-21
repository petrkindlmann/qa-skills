"""Execute the documented extractor using synthetic CoverageData API records.

These checks validate aggregation logic; they do not run pytest instrumentation
or verify an installed coverage.py package.
"""

from __future__ import annotations

import os
from pathlib import Path
import re
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch


REPOSITORY = Path(os.environ.get("QA_SKILLS_ROOT", Path(__file__).resolve().parents[1]))
REFERENCE = REPOSITORY / "skills/test-suite-curation/references/coverage-fingerprinting.md"
SOURCE = "/src/pricing.py"
USD = "tests/test_pricing.py::test_price[usd|alternate]"
JPY = "tests/test_pricing.py::test_price[jpy]"


def documented_python(marker):
    blocks = re.findall(r"^```python\r?\n([\s\S]*?)^```", REFERENCE.read_text(), re.M)
    matches = [block for block in blocks if marker in block]
    if len(matches) != 1:
        raise AssertionError(f"Expected one Python fence containing {marker!r}")
    return matches[0]


class ContextFixture:
    def __init__(self):
        self.records = {
            "": ({99}, {(99, 100)}),
            "legacy.test_price": ({98}, {(98, 99)}),
            f"{USD}|setup": ({1, 2}, {(1, 2)}),
            f"{USD}|run": ({2, 3}, {(2, 3)}),
            f"{USD}|teardown": ({4}, {(3, 4)}),
            f"{JPY}|run": ({2, 5}, {(2, 5)}),
        }
        self.query_context = None

    def measured_contexts(self):
        return set(self.records)

    def measured_files(self):
        return {SOURCE}

    def set_query_context(self, context):
        self.query_context = context

    def set_query_contexts(self, contexts):
        if contexts is not None:
            raise AssertionError("Fixture only supports clearing the query filter")
        self.query_context = None

    def lines(self, filename):
        return list(self.records[self.query_context][0]) if filename == SOURCE else None

    def arcs(self, filename):
        return list(self.records[self.query_context][1]) if filename == SOURCE else None


class CoverageFingerprintTests(unittest.TestCase):
    def setUp(self):
        self.data = ContextFixture()
        fixture = self.data

        class Coverage:
            def __init__(self, data_file):
                if data_file != ".coverage":
                    raise AssertionError(data_file)

            def load(self):
                pass

            def get_data(self):
                return fixture

        self.namespace = {}
        with patch.dict(sys.modules, {"coverage": SimpleNamespace(Coverage=Coverage)}):
            exec(compile(documented_python("cov = coverage.Coverage"), str(REFERENCE), "exec"), self.namespace)

    def test_unions_setup_run_and_teardown_under_the_test_id(self):
        self.assertEqual(self.namespace["line_sets"].get(USD), {(SOURCE, line) for line in (1, 2, 3, 4)})
        self.assertEqual(self.namespace["branch_sets"].get(USD), {(SOURCE, arc) for arc in ((1, 2), (2, 3), (3, 4))})

    def test_parameter_ids_stay_distinct_and_embedded_pipes_survive(self):
        self.assertEqual(set(self.namespace["line_sets"]), {USD, JPY})
        self.assertEqual(self.namespace["line_sets"].get(JPY), {(SOURCE, 2), (SOURCE, 5)})

    def test_unattributed_and_non_pytest_contexts_are_excluded(self):
        all_lines = set().union(*self.namespace["line_sets"].values())
        self.assertTrue(all_lines, "The healthy fixture must contribute coverage")
        self.assertNotIn((SOURCE, 99), all_lines)
        self.assertNotIn((SOURCE, 98), all_lines)

    def test_query_filter_is_cleared_after_extraction(self):
        self.assertIsNone(self.data.query_context)

    def test_unique_coverage_counts_tests_instead_of_phases(self):
        exec(compile(documented_python("line_owner_count = Counter"), str(REFERENCE), "exec"), self.namespace)
        self.assertEqual(self.namespace["uniquely_covered"].get(USD), {(SOURCE, line) for line in (1, 3, 4)})
        self.assertEqual(self.namespace["uniquely_covered"].get(JPY), {(SOURCE, 5)})
        self.assertEqual(self.namespace["line_owner_count"][(SOURCE, 2)], 2)


if __name__ == "__main__":
    unittest.main()
