# visual-testing on TodoMVC: what ran

The authoring agent's session was lost with the host window after its second run, so this
report is written by the orchestrating session from the agent's files, its transcript and
three further runs. Nothing in the spec was changed afterwards.

## Observed results

| Run | Command | Result |
|---|---|---|
| Baseline (agent) | `playwright test --update-snapshots` | 9 PNGs written under `todomvc-visual.spec.mjs-snapshots/` |
| Run 2 (agent) | `playwright test` | 10 scheduled, 9 passed, 1 skipped |
| Determinism 1 | `playwright test` | 9 passed, 1 skipped |
| Determinism 2 | `playwright test` | 9 passed, 1 skipped |
| Detector | `VISUAL_DETECTOR_CHECK=1 playwright test` | 10 passed |
| Whole lab | `npm run test:workflows` | 46 scheduled, 45 passed, 1 skipped |

The skipped case is the opt-in comparator detector check; with the flag set it proves that
`toHaveScreenshot` rejects a three-item list presented as the completed-filter baseline.
Three consecutive runs without `--update-snapshots` passed, which is the determinism
requirement of the task.

## What the suite covers

Nine baselines: empty state (full page), several active items, the three filter views from
one mixed seed, all completed through mark-all, editing in progress (focus kept on the edit
field on purpose), row hover revealing the delete control, and a 375 px mobile capture.
Stabilisation: `animations: 'disabled'`, `caret: 'hide'`, an injected `stylePath` that
removes TodoMVC's label and delete-control fades, `maxDiffPixels: 0`, and a `settle()` helper
that blurs the last clicked control and parks the pointer so the state, not the path to it,
is captured. The baseline-update workflow is documented at the top of the spec.

## Skill observations recovered from the agent's work

- The skill's recommended global `expect.toHaveScreenshot` block belongs in
  `playwright.config`, which the task declared read-only; the agent moved the options into a
  shared `VISUAL` constant instead (comment in `visual-helpers.mjs`). The skill should say
  where the options go when the config cannot be edited.
- The agent had to read Playwright's type definitions to confirm the `stylePath`, `caret`
  and `animations` options and the default `-darwin` snapshot suffix; the skill's recipe did
  not state that baselines are platform-tagged, which decides whether macOS baselines can be
  used in Linux CI (they cannot).
- The agent probed the stylesheet for transitions itself; the skill does not tell the reader
  to inventory CSS transitions before choosing a stabilisation strategy.

The agent's own list of recipe difficulties, with line numbers, was lost with its session.
The three points above are the ones its files and commands show; they are not a complete
record of what it would have reported.

## Post-authoring edit

The orchestrator added one file-level `test.skip` for non-darwin platforms so the lab's
Linux CI job does not fail on missing `-linux.png` baselines. No assertion or baseline changed.

## Not verified

Linux baselines, any browser other than bundled Chromium, and the behaviour of the suite
under a real UI change (the campaign's fault matrix covers that separately).
