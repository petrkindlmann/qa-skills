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
   - add the skill to the tables in `README.md`, `CLAUDE.md`, and `AGENTS.md`.

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

For instruction changes, give a fresh agent a realistic request and the skill without the
expected answer. Save the request, complete output, skill revision, and separate review.
Use new examples after revisions; repeating the demonstration alone is not a held-out check.
The `run_evals.py --live` and `--baseline` modes require Claude Code and are response-only
pattern checks. Their generated code still needs execution and their deferred criteria
still need a judge. Never substitute a fake model process for evidence of model quality.

### Actual application workflows

The second campaign uses a checksum-pinned official TodoMVC, a local Shop with SQLite,
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
