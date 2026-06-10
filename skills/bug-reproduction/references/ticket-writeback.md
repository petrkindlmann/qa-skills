# Writing repro evidence back into the ticket

When the reproduction is done and the regression test is committed, the ticket must let
*someone else* re-run everything without talking to you. Do not paste the raw 14-step UI
walkthrough, and do not just write "reproduced, closing." Replace the original vague
report with a structured block.

## What goes in, and in what structure

```markdown
## Reproduction (verified)

**Minimal repro:** <the smallest steps or the single test command that triggers the bug>
  1. Seed account #4821, cart [SKU-12 ×3], coupon SAVE10
  2. Run: `npm test -- checkout-total.spec.ts`
  (Down from the original 14 manual UI steps — see test for the exact path.)

**Environment / build:**
  - Commit: 3a9f2c1 (build 2.5.1)
  - Chrome 124 / macOS 14 / desktop
  - Locale de-DE, Europe/Berlin, EUR

**Expected vs actual:**
  - Expected: €27.54
  - Actual:   €27.55  (off by one minor unit, every run)

**Introducing commit (from git bisect):** `7c1d04e` — "switch tax rounding to banker's
  rounding" (2026-02-28). `git show 7c1d04e` for the diff.

**Regression test:** `tests/checkout/checkout-total.spec.ts::computes total with SAVE10`
  — committed in <PR/commit link>. Red before the fix, green after. Verified it fails when
  the fix is reverted (see fix-verification note below).

**Determinism notes (so anyone can re-run identically):**
  - Time frozen at `2026-03-15T00:00:03Z` (`page.clock.setFixedTime` / `vi.setSystemTime`)
  - RNG seeded: `faker.seed(1337)`
  - Network stubbed: pricing API fulfilled from fixture (no live calls)
  - `TZ=UTC`, locale pinned to de-DE

**Evidence:** <link to Playwright trace / failing-run logs / screenshot of the wrong total>
```

## The seven required elements

A complete write-back has all of these; missing any one makes it non-reproducible for the
next person:

1. **Minimal steps / repro command** — not the raw walkthrough.
2. **Environment + build/commit** — the exact SHA and platform.
3. **Expected vs actual** — the concrete numbers, not "it's wrong."
4. **Introducing commit** — the offending/root-cause commit from `git bisect`.
5. **Regression test** — a link to the committed test file and path.
6. **Evidence** — logs, screenshot, trace, or other artifact.
7. **Determinism notes** — seed, frozen time, and stubs needed to re-run identically.

## Status, not just close

If the bug reproduced and the fix is verified, move the ticket to *fix verified / ready to
close* and link the merged fix. If it did **not** reproduce, do not silently close as
"cannot reproduce" — record what you tried (which environments, how many runs, what data)
and classify it (flaky vs environment-specific vs genuinely not-reproducible) so the next
person starts from your evidence, not from zero.
