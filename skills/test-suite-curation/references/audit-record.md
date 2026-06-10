# The Audit Record

The per-test "what we deleted and why" log that makes every removal defensible to a future
engineer or auditor. One row per deleted test — never just a count. Decision rules in
`SKILL.md` §8.

## Column schema

| Column | What it holds |
|--------|---------------|
| `row_id` | stable id referenced from the quarantine skip reason (e.g. `R-0142`) |
| `test_id` | full path/name of the removed test |
| `category` | `redundant` / `obsolete` / `low-value` |
| `reason` | the specific justification, not "redundant" alone |
| `superseded_by` | surviving test id that covers/replaces it (required for `redundant`) |
| `coverage_delta` | lines/branches no longer covered after removal (before/after); ideally 0 net loss |
| `mutation_check` | for `redundant`: survivor kills the same mutant set? (`yes` + run id) |
| `quarantined_at` | SHA/date the test entered quarantine |
| `window_closed` | date the observation window ended with no escaped defect |
| `approver` | name of the human who signed off (CODEOWNERS reviewer) |
| `approval_sha` | the PR/commit SHA of the deletion |
| `restore` | one-line command + quarantine location to recover it |

## Worked example row

```
row_id:          R-0142
test_id:         tests/legacy/test_discount.py::test_legacy_discount_rounding
category:        redundant
reason:          subsumed by test_discount_v2; identical line+branch coverage AND survivor
                 kills the same mutant set (no unique fault detection)
superseded_by:   tests/pricing/test_discount.py::test_discount_v2
coverage_delta:  0 lines / 0 branches lost (survivor covers superset)
mutation_check:  yes — mutmut run 2026-05-12, kills(B) ⊆ kills(A)
quarantined_at:  9a1c3f7  2026-05-14
window_closed:   2026-06-09  (2 sprints, no escaped defect)
approver:        p.kindlmann (QA lead, CODEOWNERS /tests/)
approval_sha:    e72b04d
restore:         git revert e72b04d  (or un-skip in tests/quarantine/test_discount.py)
```

## Store it committed and versioned

Keep the log as a committed table so it is versioned next to the deletions and survives
forever. CSV for tooling, Markdown table for humans:

```
docs/test-curation-log.md     # committed; reviewed via CODEOWNERS
```

A row you cannot fully fill is a deletion you cannot defend — if `superseded_by`,
`coverage_delta`, or `mutation_check` is blank for a `redundant` removal, the test does
not get deleted yet.
