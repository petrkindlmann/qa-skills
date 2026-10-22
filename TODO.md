# TODO

Outstanding work, roughly in priority order. Reviewed 2026-10-22, at v3.5.0.

## Decisions waiting on the owner

- [ ] **Tag and release v3.5.0.** `main` carries it, CI is green and the site is deployed; no
  tag or GitHub release exists yet.
- [ ] **MCP server and Claude Code plugin.** Proposed, not built: a stdio server exposing the
  runner (`qa_plan`, `qa_run`, `qa_init`, `skill_route`) and `skill://` resources, plus a plugin
  with the 50 skills and a `/qa` command that lists every contract clause before loading skills.
  Open questions: SDK dependency or none, this repo or a separate package, and whether `qa_run`
  may execute project commands from an MCP host without a confirmation step.
- [ ] **Contract sweep beyond `api-testing`.** The with-and-without run showed loaded skills
  narrowing a suite to their own subjects. `api-testing` now requires a test or a "not covered"
  line per contract clause; decide whether `AGENTS.md` should ask the same of every acceptance
  task.

## Evidence still missing

- [ ] **Full live eval.** `--static` passes 511 of 511 checkable cases (5 are live-only) and the
  semantic judge has read all 808 deferred criteria against the skills' text. Neither shows
  that an agent produces the pattern. The `--live --all` run (~500 `claude -p` sessions,
  hours, heavy token cost) is still a follow-up; run it before any major promotion.
- [ ] **A comparison where skills could help.** The with-and-without Shop task did not show
  higher detection with skills (primary set circular, secondary 15 vs 16 and 18 of 30). A
  fairer test would use a task whose failure modes the skills cover and the base model is
  known to miss, with fault design kept apart from skill authoring.

## Lab follow-ups

- [ ] The curated copy of the layout-shift spec under
  `tests/workflows/generated/campaign3/test-suite-curation/curated/` keeps the old timing-bound
  anchor as that take's output. Its matrix phase does not run the fault; repair it if the
  curated suite is ever promoted.
- [ ] Two process-cleanup example tests use 700 ms budgets and fail when the host's load
  average is very high. They pass on CI and quiet re-runs; investigate before loosening them.
- [ ] `c3-tdm-idempotency-index` cannot hit the dropped-constraint race with a three-request
  burst; the case stays as a recorded limit.
- [ ] At a local load average around 40, two Mailpit instances never started listening within
  the wrapper's 15-second readiness bound (empty Mailpit log, connection refused). CI is not
  affected; raise the bound toward the runtime's 30 seconds only if it recurs at normal load.

## Distribution

- [ ] Live at [qa-skills.com](https://qa-skills.com) and filed to `awesome-claude-code`
  (issue #1774). In October 2026: 199 stars, 34 forks, 1,100+ unique clones in 14 days.
  Track stars as the adoption signal.
- [ ] Confirm adoption before adding more skills: `i18n-testing`, `mcp-server-testing` and
  `seo-testing` are the researched candidates.
- [ ] If pursuing revenue, validate a productized "set up senior-grade QA conventions in your
  repo" service before any paid product. Per-skill willingness to pay is low.

## Deferred / not now

- [ ] Do **not** build billing, subscriptions, accounts or a hosted SaaS until adoption is proven.
- [ ] Optional: scrub the old Cloudflare account ID/email from git history (`git filter-repo`).
  Low priority: they are non-secret identifiers already public, and a history rewrite breaks
  existing clones and forks.

## Known accepted trade-offs

- `SKILL.md` line cap is 650 (target ≤450); the largest is `playwright-automation` at 478.
- `--static` checks that a skill *teaches* a pattern, and the judge checks the same for prose
  criteria. Neither is an agent success rate.
- The 2026-05-30 project survey and its Codex review are local planning documents
  (gitignored), not part of the published repo.
