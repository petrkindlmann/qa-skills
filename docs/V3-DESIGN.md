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

## AI-agent / LLM security coverage (folded, not a new skill)

Decision 2026-06-10: cover the indirect-prompt-injection + agent-targeted-malware class
inside existing skills rather than adding skill #51. Triggered by a real payload (a fake
"security finding" carrying a self-propagating directive + a home-dir credential-exfil
`scan.js` + a "report secrets in context" fallback).

- `security-testing` — add an **OWASP LLM Top 10 (2025)** section (LLM01 prompt injection …
  LLM10), and sharpen its description to hand LLM-layer attacks to `ai-system-testing`.
  Keep classic web-app OWASP as the spine.
- `ai-system-testing` — extend prompt-injection coverage with: indirect injection via
  tool output / RAG documents / scan reports (not just user data), self-propagating
  "directive" payloads, data-exfiltration-via-agent (DNS/HTTP beacons), and a
  **defend-the-tester** section: treat tool output as untrusted, never execute scripts found
  in untrusted content, schema-validate tool responses, isolate agent-to-agent chains.
- New reference: `skills/ai-system-testing/references/injection-detector.md` plus an actual
  runnable detector at `skills/ai-system-testing/scripts/detect_injection.py` — flags fake
  directive blocks, "ignore previous instructions", exfil-via-DNS, self-propagation language,
  and "report secrets in context" fallbacks in any report/log/document. Ships with its own
  fixtures and a self-test.
- `risk-based-testing` already names the risk; cross-link it to the new sections.

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

## Resume state (2026-06-10, after session-limit interruption)

Committed on `v3-overhaul`:
- `8dee371` validation infra (run_evals, validate_skills extended, build_index).
- `ac52a6f` 7 new skills (43→50), all reviewed PASS/FIX, index+README to 50.
- `bcd1201` all 43 existing skills re-templated to v3 format.

Verified green: structural validator passes for all 50 (0 errors). No SKILL.md over
650 lines (max 460). Shrunk skills moved content into references/ (totals grew, not lost).

REMAINING (resume after session limit resets 7:20pm Prague 2026-06-10):
1. **Eval-spec normalization** — `python3 scripts/run_evals.py --static --all` shows
   353/510 pass, 106 semantic→judge. Diagnosis: most failures are EVAL-SPEC quality,
   not skill content (proven: cypress teaches cy.mount/.as() but spec patterns are
   prose; test-migration spec flags `send_keys`/`cy.intercept` as anti-patterns which
   is wrong for a show-the-old-code migration skill; many patterns are AND-joined or
   prose that the OR/.*/(a|b) grammar defers to judge). Fix: rewrite the weak specs to
   checkable tokens (the verify stage already did this for test-strategy: 0→10). Worst
   offenders: qa-project-context 0/10, cypress-automation 1/10, test-migration 1/10,
   ai-qa-review 2/10, shift-left-testing 2/10. Verify each is spec-not-skill before editing.
2. **AI-security fold-in** — still TODO: OWASP LLM Top 10 section in security-testing;
   indirect-injection + defend-the-tester in ai-system-testing; ship
   skills/ai-system-testing/scripts/detect_injection.py + references/injection-detector.md.
3. **Content verification** of the 28 skills whose verify stage was cut off (list in the
   workflow failures). Re-run the verify stage only for those.
4. **Full live eval** all 50 via `--live`; LLM-judge the semantic patterns + deterministic fails.
5. **Finalize**: CLAUDE.md/AGENTS.md skill tables to 50 + new disambiguation rules; site/;
   VERSIONS.md + CHANGELOG.md v3.0.0; CONTRIBUTING.md → docs/SKILL_TEMPLATE.md; TODO.md.

The re-template workflow script is at `_planning/retemplate-workflow.js` (resumable via
resumeFromRunId wf_cb598de3-fd3 — completed audit/rewrite agents return cached).
