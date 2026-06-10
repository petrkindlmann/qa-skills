# v3.0.0 Design: 43 → 50 skills, TDD-validated library

Date: 2026-06-10. Approved scope: add 7 researched skills, re-template all 43 existing
skills to the v3 house format, build the eval runner, run full live evals on all 50.

This overrides the TODO.md decision to wait for adoption proof before expanding — explicit
owner decision on 2026-06-10.

## The 7 new skills

| Skill | Category | Boundary |
|---|---|---|
| `test-case-management` | process | Manual/hybrid case authoring in TestRail/Xray/Zephyr/Qase. Not test code — that's `ai-test-generation`. |
| `bug-reproduction` | ai-qa | Vague report → minimal repro → failing regression test. `ai-bug-triage` classifies and never executes; this executes. |
| `agentic-browser-testing` | ai-qa | Goal-driven E2E via browser agents (Playwright MCP, computer-use): determinism, cost control, agent-to-script graduation. Scripted Playwright stays in `playwright-automation`. |
| `email-testing` | specialized | Inbox capture (Mailpit/Mailosaur/MailSlurp), OTP/magic-link/signup flows. SMTP/rendering, not API tests. |
| `payment-testing` | specialized | PSP sandboxes, Stripe test cards/test clocks, 3DS/SCA iframes, webhook reconciliation. |
| `test-suite-curation` | process | Whole-corpus pruning: coverage fingerprints, near-duplicate clustering, CI-history mining, smoke/core/extended tiering, deletion records. "Should this test exist" — `ai-qa-review` owns "is this test good." |
| `analytics-tracking-testing` | specialized | GA4/GTM dataLayer, pixels: schema/value/timing correctness via beacon interception. Consent gating stays in `compliance-testing`. |

Vetoed by research: `property-based-testing` as a standalone — lands as
`skills/unit-testing/references/property-based-testing.md` instead.
Second wave candidates (not now): `i18n-testing`, `mcp-server-testing`, `seo-testing`.

## TDD for skills (new methodology)

For every skill, the eval spec is the failing test and the skill is the implementation:

1. **RED** — write `evals/<skill>-evals.json` first. Run each eval prompt against an agent
   *without* the skill; record verbatim what it gets wrong (anti-patterns used, expected
   patterns missing). A baseline that passes everything means the eval is too weak — strengthen
   it before writing a single line of skill content.
2. **GREEN** — write the skill to fix the documented baseline failures, following
   `docs/SKILL_TEMPLATE.md`. Run the evals *with* the skill loaded; all cases must pass.
3. **REFACTOR** — every fix round closes the specific gap the failing eval exposed; re-run
   failed cases until green.

For the 43 existing skills the same gate applies in reverse: re-template, then full live
eval; any failure is either a content gap (fix the skill) or a bad eval (fix the eval, and
say which and why in the commit).

## Re-template pass (all 43)

Per skill: audit (currency web-check of every named tool/version, correctness of every
command and config key, trigger precision, token economy, cross-ref validity) → rewrite to
the v3 template preserving good content verbatim → verify (template compliance, nothing
load-bearing lost, every eval `expected_pattern` still taught, line caps hold).

## Validation infrastructure

- `scripts/validate_skills.py` (extended): required sections per template, category
  whitelist, name/dir match, references exist **and** no orphan reference files, Related
  Skills entries are real skills, eval spec exists per skill, `skills_index.json` and
  README counts in sync, line caps.
- `scripts/run_evals.py` (new): `--static` (skill content teaches every expected pattern,
  no anti-pattern recommended; free, CI-able), `--live` (eval prompts through `claude -p`
  with skill loaded; pattern-check output), `--baseline` (same without the skill — the RED
  phase). Pattern grammar: `A OR B` alternation, `.*` wildcards, otherwise case-insensitive
  substring; semantic patterns (plain prose) flagged for judge review rather than silently
  passed.
- `.github/workflows/validate.yml` (new): validator + static evals on every PR.

## Library-level consistency

- CLAUDE.md + AGENTS.md skill tables → 50 entries; new disambiguation rules:
  email/payment/analytics vs api-testing & compliance-testing; agentic-browser-testing vs
  playwright-automation; bug-reproduction vs ai-bug-triage; test-suite-curation vs
  ai-qa-review; test-case-management vs ai-test-generation.
- `skills_index.json` regenerated (currently stale at v2.5.0) — becomes generated artifact
  of `scripts/build_index.py`.
- README, site/, VERSIONS.md → v3.0.0; TODO.md updated (eval runner shipped, expansion
  decision superseded); CONTRIBUTING.md points at `docs/SKILL_TEMPLATE.md`.

## Execution waves

1. Build 7 new skills (TDD pipeline per skill, parallel across skills).
2. Re-template 43 (audit → rewrite → verify pipeline, parallel across skills).
3. Library consistency + validation infrastructure.
4. Full live eval, all 50 × ~9 cases; deterministic pattern check first, LLM judge only for
   deterministic failures and semantic patterns; fix loop until green.
5. Final verification: validator, static evals, adversarial review panel, VERSIONS/site.

All work on branch `v3-overhaul`; no pushes without owner request.
