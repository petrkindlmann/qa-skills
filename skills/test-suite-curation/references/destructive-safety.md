# Destructive Safety: the grace period

Quarantine markers, sign-off via CODEOWNERS, and the escaped-defect watch. The full
gate is in `SKILL.md` §7. Never `rm` test files directly; never delete 600 in one PR.

## Step 1 — Quarantine, do not delete

Mark flagged tests skipped (they stop running but stay visible and instantly restorable),
or move them to a `quarantine/` suite that still lives in the repo.

```python
# pytest: skip with a reason tying back to the audit row
import pytest

@pytest.mark.skip(reason="curation-2026-Q2 redundant; audit row R-0142; restore: git revert <sha>")
def test_legacy_discount_rounding(): ...

# or xfail if it should fail until removed
@pytest.mark.xfail(reason="curation-2026-Q2 obsolete; feature removed")
def test_removed_feature(): ...
```

```ts
// Jest / Vitest
test.skip('legacy discount rounding [curation-2026-Q2, audit R-0142]', () => { /* ... */ })
```

Or relocate without deleting:

```bash
git mv tests/legacy/test_discount.py tests/quarantine/test_discount.py
```

## Step 2 — Human sign-off (CODEOWNERS)

A named approver must approve the quarantine/removal PR. Put the test paths under
CODEOWNERS so review is required automatically.

```
# .github/CODEOWNERS
/tests/                @qa-leads
/tests/quarantine/     @qa-leads @eng-managers
docs/test-curation-log.md  @qa-leads
```

"Redundant tests need no review" is wrong — redundancy was a hypothesis until the
mutation check confirmed it, and even then a human approves removal.

## Step 3 — Observation window + escaped-defect watch

Run the suite with the cohort quarantined (skipped) for a grace period —
**default 2 sprints / 2 releases** — and watch for escaped defects.

Escaped-defect watch checklist:

- [ ] Production incidents during the window cross-checked against what the quarantined
      tests covered (use their coverage fingerprint from §1).
- [ ] New bug tickets reviewed: would any quarantined test have caught this?
- [ ] Hotfix commits reviewed: did they touch lines only a quarantined test covered?
- [ ] If YES to any: the test was NOT redundant — **restore it** and update the audit row.

```bash
# restore in one step
git revert <quarantine-sha>          # if quarantined via a single PR
# or un-skip / git mv back from tests/quarantine/
```

## Step 4 — Delete in small batches

Only after the window closes with no escaped defect, delete in small batches (not one
600-file PR), each batch PR linked to its audit rows (`audit-record.md`). Keep the
quarantine commit so every test is restorable — git history is the floor, not the plan.
