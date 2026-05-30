# TODO

Outstanding work, roughly in priority order. Updated 2026-05-30.

## Near-term

- [ ] **Eval runner.** The 43 `evals/*.json` files are specs only — there's no harness that feeds each prompt to an agent and scores output against `expected_patterns` / `anti_patterns`. Build a minimal runner so "do the skills work" is measured, not asserted. This is the most credible differentiator vs. other skill collections.
- [ ] **Distribution.** Repo is live at [qa-skills.com](https://qa-skills.com) and filed to `awesome-claude-code` (issue #1774). Post a before/after demo (agent writing Playwright tests with vs. without these skills) to relevant communities. Track GitHub stars as the real adoption signal.
- [ ] **Landing page proof points (optional).** Page is accurate as-is; could add "43/43 eval coverage" and the load-on-demand `references/` structure as credibility signals.

## Validation (before investing further)

- [ ] Confirm adoption (stars / installs) before adding more skills — current scope of 43 is enough.
- [ ] If pursuing revenue, validate a productized "set up senior-grade QA conventions in your repo" service offer before any paid product. Per-skill willingness-to-pay is low; service-first is the realistic path.

## Deferred / not now

- [ ] Do **not** build billing, subscriptions, accounts, or a hosted SaaS until adoption is proven.
- [ ] Optional: scrub the old Cloudflare account ID/email from git history (`git filter-repo`). Low priority — they're non-secret identifiers already public, and a history rewrite breaks existing clones/forks.

## Known accepted trade-offs

- `SKILL.md` line cap is 650 (raised from 500); `playwright-automation` at 529 is the intentional reference-model outlier.
- Independent Codex review of `docs/PROJECT_SURVEY.md` is pending Codex quota reset — survey was self-audited in the interim.
