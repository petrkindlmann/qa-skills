# Mining CI History

Aggregating test-result history into per-test pass/fail/flip rates, and the same-SHA
flake detection that is the *actual* definition of flakiness. Dispositions in `SKILL.md` §4.

## Sources

- **JUnit XML archives** — most CI systems emit `junit.xml` per run; archive them.
- **Datadog Test Optimization** — Flaky Test Management API; stores per-test history.
- **Trunk Flaky Tests** — same-SHA flake detection native; ~10+ runs/test for confidence.
- **BuildPulse** — surfaces tests with inconsistent outcomes on the same SHA.
- **CircleCI test insights** — per-test flakiness over time.

## Aggregate JUnit XML into per-test signals

```python
import glob, xml.etree.ElementTree as ET
from collections import defaultdict

runs = defaultdict(list)   # test_id -> [(sha, passed_bool), ...]

for path in glob.glob("ci-history/**/junit*.xml", recursive=True):
    sha = path.split("/")[1]               # however you encode commit SHA in the path
    for case in ET.parse(path).iter("testcase"):
        test_id = f"{case.get('classname')}::{case.get('name')}"
        failed = any(case.iter(tag) for tag in ("failure", "error"))
        runs[test_id].append((sha, not failed))

def pass_rate(history):
    return sum(p for _, p in history) / len(history)

def flip_rate(history):
    # fraction of consecutive runs that transitioned pass<->fail
    flips = sum(1 for (_, a), (_, b) in zip(history, history[1:]) if a != b)
    return flips / max(1, len(history) - 1)
```

## Never-failing tests

```python
never_failed = [t for t, h in runs.items() if pass_rate(h) == 1.0]
```

Disposition: **investigate, do not delete**. 100% pass usually means low-churn / low-risk
/ stable code — the test never trips because nobody touches what it guards. Cross-check
the churn of the file under test (`git log --oneline -- <file> | wc -l`) and its risk
tier. Covers a critical path that simply has not regressed => keep.

## Same-SHA flake detection (the real definition)

A flaky test is one with **different results on the same SHA** — a single failed run does
NOT make a test flaky.

```python
def same_sha_flaky(runs):
    flaky = []
    for test, history in runs.items():
        by_sha = defaultdict(set)
        for sha, passed in history:
            by_sha[sha].add(passed)
        # both True and False observed on at least one commit => flaky
        if any(len(outcomes) > 1 for outcomes in by_sha.values()):
            flaky.append(test)
    return flaky
```

Disposition: **quarantine and fix the flake, never delete to clean up CI**. Quarantine
de-noises CI now; the root cause still gets fixed (see `test-reliability`). A flaky test
may be the only coverage of a real path — deleting it loses that path.

## Defect-detection history (for tiering)

Tests that have actually caught real bugs earn a high tier (SKILL.md §6). Approximate it:
a test that **failed on the commit immediately before a commit that closed a bug ticket**
caught that regression.

```python
# tests that failed on a SHA later linked to a fixed bug ticket
defect_catchers = {
    t for t, h in runs.items()
    if any(not passed and sha in bugfix_parent_shas for sha, passed in h)
}
```

`bugfix_parent_shas` comes from your tracker (commits referenced by closed defect
tickets, or `git log --grep='fix' --grep='bug'`).

## Platform API pulls

```bash
# Datadog flaky tests (replace with your site/keys)
curl -s "https://api.datadoghq.com/api/v2/ci/test_management/flaky" \
  -H "DD-API-KEY: $DD_API_KEY" -H "DD-APPLICATION-KEY: $DD_APP_KEY"

# Trunk: flaky test list is available via the Trunk web app and API per repo.
```
