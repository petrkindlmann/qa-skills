# JUnit XML adapter: real-producer checks (2026-10-21, macOS arm64)

Scratch projects outside the repository, each run through `node scripts/qa.mjs run --project <dir>`.
Lines are the runner's own log lines and `result.json` fields.

## pytest 9.1.1 (Python 3.14 venv), explicit check with `resultFile: "reports/junit.xml"`

Command: `python3 -m pytest -q -p no:cacheprovider --junitxml=reports/junit.xml`

| Case | Runner line | tests (total/passed/failed/skipped/observed) |
|---|---|---|
| healthy (2 tests) | `PASSED py: Every recorded test case passed with no skips or reruns.` | 2/2/0/0/2 |
| defect (`2701` expected) | `FAILED py: 1 test failed. Exit code 1.` | 2/1/1/0/2 |
| skipped (`@pytest.mark.skip`) | `INCOMPLETE py: The report contains skipped, rerun, misplaced, or no test cases.` | 2/1/0/1/1 |
| stale (command `python3 -c pass`, file left from the healthy run) | `INCOMPLETE py: The declared result file was not rewritten by this command; a stale report is not evidence.` | 0 |
| pytest missing (before install) | `FAILED py: The declared command failed without a complete test verdict. Exit code 1.` | 0 |

Real report head: `<testsuites name="pytest tests"><testsuite name="pytest" errors="0" failures="0" skipped="0" tests="2" ...>`
(no counters on the root; counters on the suite reconcile with the cases).

## Vitest 5.0.5, discovered from `"test": "vitest run"` with no config

Discovery produced `["npm","run","test","--","--reporter=junit","--outputFile=.vitest/qa-junit.xml"]`
with `reporter: "junit-xml"` and `resultFile: ".vitest/qa-junit.xml"`. Vitest 5 writes the JUnit
reporter to `.vitest/junit/output.xml` by default instead of printing it, which is why the
output file is named explicitly (first attempt without it: `INCOMPLETE project-tests: No complete JUnit XML report was emitted.`).

| Case | Runner line | tests |
|---|---|---|
| healthy (2 tests) | `PASSED project-tests: Every recorded test case passed with no skips or reruns.` | 2/2/0/0/2 |
| defect | `FAILED project-tests: 1 test failed. Exit code 1.` | 2/1/1/0/2 |
| `test.skip` | `INCOMPLETE project-tests: The report contains skipped, rerun, misplaced, or no test cases.` | 2/1/0/1/1 |
| stale (script replaced by `node -e 0`) | `INCOMPLETE vitest: The declared result file was not rewritten by this command; a stale report is not evidence.` | 0 |

Real report head: `<testsuites name="vitest tests" tests="2" failures="0" errors="0" ...><testsuite name="prices.test.mjs" ... tests="2" failures="0" errors="0" skipped="1" ...>`
(counters on both levels; the skipped case carries `<skipped/>`).

Each passing or failing run wrote `evidence/<id>.result.xml` next to the command log and the
HTML report links it. Not exercised here: jest-junit, mocha-junit-reporter, gotestsum and
Surefire output, which the parser accepts by the documented shape only.
