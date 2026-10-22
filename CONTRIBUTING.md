# Contributing

## Adding a new skill

The authoring contract is **`docs/SKILL_TEMPLATE.md`** — read it first; it defines the
exact frontmatter, section set and order, line caps, and voice. The short version:

1. Write the eval spec FIRST: `evals/your-skill-name-evals.json` (8–10 cases). It is the
   failing test — see `docs/V3-DESIGN.md` ("TDD for skills").
2. Create `skills/your-skill-name/SKILL.md` to the template. Keep it ≤450 lines (hard cap
   650); move heavy code (>30-line blocks) to `references/` and cite each file (no orphans).
3. Frontmatter: `name` (== directory), `description` (with quoted trigger phrases, a
   `Not for: X — use Y.` anti-trigger where a sibling overlaps, and `Related:`), `license: MIT`,
   `metadata.author/version/category` (category from the whitelist in `scripts/validate_skills.py`).
4. Required sections: `<objective>`, `## Discovery Questions` (start with the
   `.agents/qa-project-context.md` check), `## Core Principles`, domain sections,
   `## Anti-Patterns`, `## Done When` (objectively checkable items), `## Related Skills`.
5. Regenerate the index: `python3 scripts/build_index.py`. Update `VERSIONS.md`.
6. Verify before opening a PR:
   - `python3 -m pip install -r requirements-dev.txt`
   - `python3 -m unittest discover -s tests -p 'test_*.py' -v`
   - `python3 scripts/validate_skills.py` (must be 0 errors)
   - `python3 scripts/run_evals.py --static --skill your-skill-name`
   - add the skill to the tables in `README.md` and `AGENTS.md` (`CLAUDE.md` is a symlink
     to it) and to the category lists in `site/index.html`.

### SKILL.md structure

See `docs/SKILL_TEMPLATE.md` for the authoritative, annotated template. Section order:

```markdown
---
name: skill-name
description: >-
  What it does and covers. Use when: "trigger," "trigger." Not for: X — use Y. Related: a, b.
license: MIT
metadata: { author: kindlmann, version: "1.0", category: <whitelist> }
---

<objective> … </objective>
## Discovery Questions   (first line: check qa-project-context)
## Core Principles
## <domain sections>
## Anti-Patterns
## Verification          (conditional — "run this now" checks)
## Done When
## Related Skills
```

## Improving an existing skill

- Fix errors, add missing patterns, improve code examples
- One concern per PR
- Update `VERSIONS.md` if the change is significant

### Test the behavior being taught

Static evals check words in the skill and references. They do not run the user's request,
compile examples, establish a legal conclusion, or judge whether an answer is correct.
Inspect their reported semantic criteria and distinguish content flags from observed defects.
Do not add fixture-specific facts to a skill just to satisfy a static pattern.

For a recipe change, reproduce the defect with a controlled case, change the actual code
fence that users copy, and make the same case pass. The `tests/examples/` and `tests/browser/`
suite loads documented helpers directly, so a disconnected implementation cannot satisfy it.
Include a healthy fixture as well as a broken one so an assertion that always fails cannot pass.

```bash
npm ci
npm test
npx playwright install chromium
npm run test:browser
```

Node 24 is required for the TypeScript-stripping test loader. Set `QA_BROWSER_EXECUTABLE`
only when intentionally testing a system Chromium/Chrome; otherwise use the pinned
Playwright browser. Record the actual version and do not generalize one engine's result.
Changes to the QA runner (`tools/qa/`, `scripts/qa.mjs`) also need `npm run test:qa`.

The static runner defers prose criteria to a judge (808 of them across `evals/`).
`python3 scripts/judge_evals.py --static --skill your-skill-name` sends a skill's text and
its criteria to the `claude` CLI in one call and accepts a "yes" only with a quote the skill
actually contains; `--from-results` judges recorded `--live` answers instead. It costs tokens
and is not part of CI. Method and costs: `docs/EVAL-JUDGE-2026-10-21.md`.

For instruction changes, give a fresh agent a realistic request and the skill without the
expected answer. Save the request, complete output, skill revision, and separate review.
Use new examples after revisions; repeating the demonstration alone is not a held-out check.
The `run_evals.py --live` and `--baseline` modes require Claude Code and are response-only
pattern checks. Their generated code still needs execution and their deferred criteria
still need a judge. Never substitute a fake model process for evidence of model quality.

### Actual application workflows

The application lab uses a checksum-pinned official TodoMVC, a local Shop with SQLite,
and the real Mailpit binary. They use loopback sockets and synthetic accounts, without
request interception or external payment/email delivery. On Linux AMD64 or macOS arm64
(the two platforms with a pinned Mailpit asset; `python3` must be on PATH, or set
`QA_PYTHON`):

```bash
npm ci
npx playwright install chromium
npm run workflow:setup
npm run test:workflows
npm run test:mailpit
npm run test:workflow-controls
```

`test:workflows` is the ordinary healthy acceptance suite. `test:workflow-controls` also
expects the designated assertions to fail for deliberate defects; it exits nonzero if
a healthy control fails, a defect escapes, input is absent or infrastructure prevents
an observation. To add a scenario, add the fault switch to the fixture (`fixture-app/faults.py`
or `upstream-todomvc/faults/mutations.mjs`), write the acceptance case against the public
contract, and register the pair in `run-matrix.mjs` with the substring of the test title
that must fail. A fault that no test catches is reported as `not_established`, not hidden. Reports keep each failed assertion; an expected negative control is
not counted as a passing application test. Keep baseline authoring separate from
review-driven repairs and record skill/source hashes. See
`docs/REAL-WORKFLOWS-2026-10-21.md` for provenance and the exact coverage boundary.

The lab holds 28 faults: 19 in the Shop (`fixture-app/faults.py`) and 9 in TodoMVC
(`upstream-todomvc/faults/mutations.mjs`). `run-matrix.mjs` takes a phase and an optional
comma-separated list of case ids:

| Phase | What it runs |
| --- | --- |
| `final` (default, the CI gate) | the released suites: one healthy run of the whole `generated/` root (36 tests) and 22 fault cases |
| `campaign3` | each campaign-3 suite healthy and under the fault its skill should catch |
| `initial` | the first campaign's healthy and fault cases against its own baseline suites |
| `review-baseline` | the review's faults against the baseline suites, where the gaps the review found are expected |

```bash
QA_MATRIX_OUTPUT=/tmp/matrix node tests/workflows/run-matrix.mjs final todo-layout-shift,combined-healthy
```

The root of `generated/` is the released set. The config leaves out `campaign3/` and
`experiment/` there, because their own phase and `run-experiment.mjs` score them; point
`QA_WORKFLOW_SUITE` at an absolute folder path to run one of them directly. Adding a
top-level folder under `generated/` changes the gate's healthy count.

Run the `final` phase before pushing anything under `tests/workflows/`. On a heavily loaded
machine cases slow down several times and can end `not_established` with `timedOut: true`;
compare with the case's line in the last green CI log and re-run that id alone. A
`not_established` case with no failed test is different: the detector missed the fault, so
read its attachments. That is how a timing race in the layout-shift addon was found.

### Comparing with and without skills

`docs/WITH-WITHOUT-2026-10-22.md` gives one task to blind agents in three arms and scores
their suites with `tests/workflows/run-experiment.mjs <take>[,<take>...]`. Each take must
pass two healthy runs, and a fault counts as detected only when a second run fails cleanly
on a shared test title; anything else is recorded as unstable or invalid.
`QA_EXPERIMENT_SET=primary|secondary` picks the pre-registered or the exploratory faults;
the two are never mixed. For a new comparison:

- Fix the prompt, the arms and the primary fault set before any take is scored, and keep
  fault names out of the repository while a take is authoring.
- Subagents started in this repository inherit `AGENTS.md` and the session's memory. A
  take without them runs as `claude -p` from a directory outside the repository; check its
  transcript for the attached instruction files, the model and any reads outside its workspace.
- Keep the host awake while scoring (`caffeinate -dims` on macOS). Runs that overlap a sleep
  are invalid and are re-run, not counted.

## CI and releases

`.github/workflows/validate-skills.yml` runs on pull requests and on pushes to `main` that
touch skills, evals, scripts, tests, the runner, the package files, `README.md`, `VERSIONS.md`
or `AGENTS.md`. Its three jobs (validation, executable recipes and runner, application
workflows) take about 10 runner minutes per push, so batch commits before pushing. `main` is
the only branch.

A release bumps `skills_index.json` with `python3 scripts/build_index.py --version X.Y.Z`,
adds a `VERSIONS.md` entry, and updates the figures in `README.md` and `site/index.html`.
Tags and GitHub releases are made by the owner.

## Reference files

Reference files go in `skills/skill-name/references/` for content that would make SKILL.md too long. Agents load these on demand.

## Tool integrations

Tool recipes live in the owning skill's `references/` directory. The executable QA
runner lives in `tools/qa/`. Keep `tools/REGISTRY.md` aligned with real skill names.

## What we look for

- Code examples that actually work, not pseudocode
- Opinions on best practices rather than listing every option
- Cross-references to related skills
- Evals in `evals/` if you're adding a skill

## License

Contributions are licensed under MIT.
