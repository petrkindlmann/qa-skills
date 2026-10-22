# Agent-authored suites and their records

Each folder keeps what one task produced: the prompt (`task-prompt.txt`), the agent's final
answer (`final-response.md`), execution logs, and any specs it wrote. Agent-written specs are
kept as the task left them, with one exception: in `baseline-shop`, `baseline-todo` and
`review-followup` the assertion the matrix designates for each fault was later wrapped in
`oracle()`, so a run can tell which assertion failed. Campaign-3 takes wrote their own
markers, and the experiment takes have none because `run-experiment.mjs` counts any clean
failure. `addons/` is hand-written and maintained; its changes are listed in `VERSIONS.md`.

The root of this tree is the released set that CI runs (`npm run test:workflows`, and the
`final` phase of `../run-matrix.mjs`): 36 tests from `baseline-shop`, `baseline-todo`,
`review-followup` and `addons`. The config leaves `campaign3/` and `experiment/` out of a
root run because they are scored on their own.

| Folder | What produced it | Tests | Scored by |
| --- | --- | --- | --- |
| `baseline-shop/` | fresh agent with api-testing, playwright-automation, email-testing and payment-testing: Shop acceptance suite | 10 | `final` |
| `baseline-todo/` | fresh agent with playwright-automation and ai-test-generation: TodoMVC acceptance suite | 9 | `final` |
| `review/` | independent review of both baselines with ai-qa-review | none | its gaps are the `review-baseline` phase |
| `review-followup/` | fresh agent implementing the review's recommendations | 6 | `final` |
| `release/` | go/no-go on supplied run records with ai-bug-triage, release-readiness and qa-report-humanizer | none | not scored |
| `addons/` | hand-written with four skills open; see its README for provenance | 11 | `final` |
| `campaign3/<skill>/` | one blind take per skill for ten skills | 5–81 | `run-matrix.mjs campaign3` |
| `experiment/{with,without,bare}-{1,2,3}/` | nine blind takes of one Shop task: four skills, agent rules only, or neither | 11–12 | `../run-experiment.mjs` |

Reports: the first five folders are described in `docs/REAL-WORKFLOWS-2026-10-21.md`,
`addons/` in `docs/WORKFLOW-ADDONS-2026-10-21.md`, `campaign3/` in
`docs/WORKFLOW-CAMPAIGN3-2026-10-21.md`, and `experiment/` in `docs/WITH-WITHOUT-2026-10-22.md`.
