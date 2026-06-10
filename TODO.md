# TODO

Outstanding work, roughly in priority order. Updated 2026-06-10 (v3.0.0).

## Near-term

- [x] **Eval runner.** ✅ Built in v3.0.0: `scripts/run_evals.py` (`--static` / `--baseline` / `--live`) with the shared grammar in `scripts/eval_patterns.py`, plus the extended `scripts/validate_skills.py` and generated `scripts/build_index.py`.
- [ ] **Full live eval (deferred follow-up).** Decision 2026-06-10: shipped v3.0.0 on the green `--static` pass (471/512 checkable cases, rest correctly deferred to a judge) plus a proven `--live` harness (smoke-tested on api-testing). The full `--live --all` run (~500 `claude -p` sessions, multi-hour, heavy token cost) is a documented follow-up, not a release blocker. Run it before any major external promotion push, ideally wired into `.github/workflows/` as a gated/nightly job (static evals already CI-ready).
- [ ] **CI workflow.** Add `.github/workflows/validate.yml` running `validate_skills.py` + `run_evals.py --static` + `build_index.py --check` on every PR. (Scripts are ready; the workflow file is not yet written.)
- [ ] **Distribution.** Repo is live at [qa-skills.com](https://qa-skills.com) and filed to `awesome-claude-code` (issue #1774). Post a before/after demo (agent writing Playwright tests with vs. without these skills). Track GitHub stars as the real adoption signal.

## Validation (before investing further)

- [ ] Confirm adoption (stars / installs) before adding an 8th-wave of skills — `i18n-testing`, `mcp-server-testing`, `seo-testing` are the researched wave-two candidates if demand warrants.
- [ ] If pursuing revenue, validate a productized "set up senior-grade QA conventions in your repo" service offer before any paid product. Per-skill willingness-to-pay is low; service-first is the realistic path.

## Deferred / not now

- [ ] Do **not** build billing, subscriptions, accounts, or a hosted SaaS until adoption is proven.
- [ ] Optional: scrub the old Cloudflare account ID/email from git history (`git filter-repo`). Low priority — they're non-secret identifiers already public, and a history rewrite breaks existing clones/forks.

## Known accepted trade-offs

- `SKILL.md` line cap is 650 (target ≤450); largest is `playwright-automation` at 460 post-re-template.
- `--static` eval mode is a content proxy: it checks the skill *teaches* a pattern, not that a live agent *produces* it. The handful of remaining static fails are 1-case eval-precision items deferred to the (not-yet-run) live judge, not skill defects.
- Independent Codex review of `docs/PROJECT_SURVEY.md` is pending Codex quota reset — survey was self-audited in the interim.
