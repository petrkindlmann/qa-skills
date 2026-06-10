# Tiering: smoke / core / extended

Encoding tiers as markers driven by risk + defect-detection history, not by speed.
Decision rules in `SKILL.md` §6.

## Selection evidence (in priority order)

1. **Business risk / critical path** — from the risk map (`risk-based-testing`). Revenue,
   auth, data integrity, top user journeys => smoke/core regardless of runtime.
2. **Defect-detection history** — tests that have caught real bugs (the `defect_catchers`
   set from `ci-history-mining.md`) earn a high tier on merit.
3. **Runtime / duration / execution time** — a *secondary tiebreaker only*. Among
   equally-risky tests, prefer faster ones for smoke. Never the primary axis, never
   smoke as the first N tests in file order, never a random sample.

| Tier | Goal | Selection |
|------|------|-----------|
| smoke | runs on every push, a few minutes | top-risk paths + proven defect-catchers; fast enough to gate every commit |
| core | per-PR / merge gate | all critical + high-risk coverage |
| extended | full / nightly / slow / pre-release | everything else, exhaustive, edge cases |

## Encode tiers as markers (not by moving files)

```python
import pytest

@pytest.mark.smoke
def test_checkout_completes_payment(): ...

@pytest.mark.extended
def test_checkout_handles_47_currency_edge_cases(): ...
```

```ini
# pytest.ini / pyproject.toml
[pytest]
markers =
    smoke: critical-path + proven defect-catcher; gates every push
    core: critical + high-risk coverage; PR/merge gate
    extended: full/nightly/slow/edge-case suite
```

```bash
pytest -m smoke            # select a tier without moving any files
pytest -m "core or smoke"  # the PR gate
pytest -m extended         # nightly
```

JS/Vitest equivalent: tag with `test.concurrent`/custom tags or filename suffixes
(`*.smoke.test.ts`) and select with `vitest --project smoke` or a `testNamePattern`.
JUnit: use `@Tag("smoke")` and `-Dgroups=smoke`.

## Assigning tiers from evidence

```python
def assign_tier(test, risk_tier, defect_catchers, runtime_s):
    if risk_tier == "critical" or test in defect_catchers:
        # fast enough to gate every push? -> smoke, else core
        return "smoke" if runtime_s < 2.0 else "core"
    if risk_tier == "high":
        return "core"
    return "extended"
```

Runtime only breaks ties *inside* a risk class; it never promotes a low-risk test into
smoke nor demotes a critical-path test out of it.
