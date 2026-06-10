---
name: bug-reproduction
description: >-
  Turn a vague bug report into a VERIFIED minimal reproduction and then a failing
  regression test, agent-driven end to end. Covers extracting the implicit repro from a
  thin report (env, build, steps, data), the reproduce-minimize-isolate-capture loop,
  git bisect to find the introducing commit, building a deterministic minimal repro
  (fixed seeds, frozen time, stubbed network), writing the failing regression test BEFORE
  the fix (red) and confirming the fix flips it green, and writing repro evidence back
  into the ticket. Distinguishes flaky-not-reproducible from environment-specific.
  Use when: "reproduce this bug," "minimal reproduction," "repro steps," "find the commit
  that broke it," "git bisect," "make the repro deterministic," "write a failing test for
  this bug," "regression test for a defect," "can't reproduce this bug."
  Not for: Classifying/deduplicating/severity-routing existing failures without
  reproducing them — that is ai-bug-triage. Generating tests from specs rather than from a
  defect — that is ai-test-generation.
  Related: ai-bug-triage, ai-test-generation, test-reliability, systematic-debugging, qa-project-context.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: ai-qa
---

<objective>
A bug you cannot reproduce is a bug you cannot fix or prove fixed. This skill takes a
thin, hand-wavy report ("order total is wrong sometimes") and drives it to a VERIFIED
minimal reproduction, a deterministic failing test written BEFORE the fix, a `git bisect`
that names the introducing commit, and a structured evidence block in the ticket. The
discipline it enforces: reproduce before theorizing, minimize one cut at a time, freeze
time/seed/network so the repro fails identically every run, watch the test go red first,
and confirm the fix flips it green — and that reverting the fix turns it red again.
</objective>

## Quick Route

| You have… | Go to |
|-----------|-------|
| A thin report and no idea how to trigger it | [Step 1: Extract the implicit repro](#step-1-extract-the-implicit-repro) |
| A messy 14-step repro to clean up | [Step 2: The reproduce-minimize-isolate-capture loop](#step-2-the-reproduceminimizeisolatecapture-loop) |
| "Worked last month, broken now" | [Step 3: Bisect to the introducing commit](#step-3-bisect-to-the-introducing-commit) |
| A repro that passes/fails inconsistently | [Step 4: Make the repro deterministic](#step-4-make-the-repro-deterministic) |
| A clean repro, no fix yet | [Step 5: Write the failing regression test (red) first](#step-5-write-the-failing-regression-test-red-first) |
| "The dev says it's fixed, test is green" | [Step 6: Verify the fix actually fixes it](#step-6-verify-the-fix-actually-fixes-it) |
| "It won't reproduce for me but does for the user" | [Step 7: Flaky vs environment vs not-reproducible](#step-7-flaky-vs-environment-vs-not-reproducible) |
| Repro + test done | [Step 8: Write the evidence back into the ticket](#step-8-write-the-evidence-back-into-the-ticket) |

## Discovery Questions

First, check `.agents/qa-project-context.md` in the project root — it carries the tech
stack, test runner, known-flaky areas, and environment matrix. Pass over any question it
already answers. If it is missing, suggest creating one with the `qa-project-context` skill.

- **What is the report, verbatim?** The thinner it is, the more you must extract before
  touching code — a one-line report sets the whole intake agenda (Step 1).
- **Does it reproduce at all yet, and how reliably?** "Every time" vs "sometimes" decides
  whether you go straight to minimizing or into determinism work first.
- **Did it ever work?** A known-good past release unlocks `git bisect` to the introducing
  commit; no known-good point means you debug forward instead.
- **What is the test runner and stack?** Vitest/Jest vs Playwright changes the determinism
  API (`vi.setSystemTime` vs `page.clock`) and where the regression test lands.
- **What are the non-determinism sources?** Time-of-day rules, randomness, third-party
  APIs, locale — each must be pinned for the repro to be trustworthy.

---

## Core Principles

1. **Reproduce before you theorize.** The strongest wrong instinct is to read a symptom
   and jump to a root cause ("sounds like a float rounding bug, let me patch the total
   calc"). Don't. Extract the repro, make it fail on demand, and only then form a
   hypothesis. A fix without a reproduction is a guess you can't falsify.

2. **A repro is a deterministic artifact, not a story.** "It happens around midnight with a
   random code" is a story. Freeze the clock, seed the RNG, and stub the network so the
   same inputs produce the same failure on every run and every machine. If it isn't
   deterministic, you can't bisect it, test it, or prove it fixed.

3. **Minimize one variable at a time, and re-confirm after every cut.** Shrinking the repro
   is a search, not a rewrite. Remove one step, data field, or dependency, then re-run and
   confirm it *still reproduces*. Removing several at once tells you nothing about which one
   mattered.

4. **The regression test is written RED, before the fix.** Assert the real expected value,
   watch it fail first (proving it catches *this* bug), then watch the fix flip it green.
   A test added after the fix, or one disabled / marked pending, proves nothing.

5. **Green isn't done — revert-to-verify is.** A passing test can pass for the wrong
   reason. Temporarily remove the fix and confirm the test goes red again. Only a test that
   fails without the fix actually guards against the bug.

---

## Step 1: Extract the implicit repro

A thin report ("Checkout is broken, order total is wrong sometimes") names a symptom, not a
path. Before any code, extract or ask for every reproducibility dimension. Never invent the
repro steps from imagination, and never theorize a root cause yet — both come after the bug
reproduces.

For a "wrong total" / data-correctness bug, the load-bearing dimensions a thin report most
often omits are:

- **Exact steps to reproduce** — the click-by-click path, not "checkout is broken."
- **Build / version / commit (git SHA)** — they may be on a build where it's already fixed.
- **Environment** — browser + version, OS, device.
- **Input data** — cart contents, quantities, the account/user, coupon, the exact fixture.
  A total is a pure function of its inputs; without them you are guessing.
- **Expected vs actual** — the number they expected and the number they saw.
- **Frequency** — every time, or intermittent? "Sometimes" points at non-determinism.
- **Locale / timezone / currency** — rounding, tax, and formatting are locale-specific; a
  total "wrong" in `de-DE` may be correct in `en-US`.
- **Timestamp** of occurrence, plus any logs/screenshots/network trace.

Write these into a single repro spec before touching code. If a row is blank, that is your
next question to the reporter — not a license to start writing the fix or theorizing.

See `references/intake.md` for the full extraction checklist, why each load-bearing
dimension matters for "wrong total," and the repro-spec template.

---

## Step 2: The reproduce→minimize→isolate→capture loop

Given a confirmed-but-messy repro (e.g. 14 manual UI steps across 3 pages), do **not** hand
the 14-step version to the developer and do **not** rewrite it wholesale. Run this loop:

1. **REPRODUCE / confirm.** First establish a baseline: run the full repro and confirm it
   actually fails. You can only minimize something that currently reproduces.
2. **MINIMIZE.** Remove **one** step, field, or dependency. Re-run. If it *still reproduces*,
   keep the cut; if it no longer fails, that element was load-bearing — restore it. Repeat,
   one variable at a time, until every remaining piece is necessary. This is the core
   ordering rule: never minimize before confirming it reproduces, and never omit verifying
   it still fails after each cut.
3. **ISOLATE.** Narrow the failure to the smallest layer that still shows it — drop from a
   3-page UI flow to a single page, then to a unit/API call against the offending function
   if the bug lives below the UI.
4. **CAPTURE.** Record the now-**minimal** repro as evidence: the smallest steps or the
   single command, plus logs/trace/screenshot. This is what the developer and the
   regression test consume.

The output is the *smallest* sequence that still reproduces — not the original walkthrough.

---

## Step 3: Bisect to the introducing commit

The bug is on `HEAD` but a past release was clean, and you have a command that exits
**non-zero when the bug is present**. Use `git bisect run` to binary-search history
automatically — do not manually check out each commit, and do not use `git revert` to hunt
for it.

```sh
git bisect start
git bisect bad HEAD          # current commit has the bug   (alias: git bisect new)
git bisect good v2.4.0       # last clean release            (alias: git bisect old)
git bisect run npm test -- checkout-total.spec.ts   # ONE targeted test, never the full suite
# bisect prints "<sha> is the first bad commit"
git bisect reset             # ALWAYS clean up — restores the original HEAD
```

The exit-code contract `git bisect run` uses: **exit code 0 = good** (bug absent),
**non-zero (1–124) = bad** (bug present), **exit 125 = skip** (untestable). So your command
must return 0 when the feature is fine and non-zero when the bug reproduces — most runners
already do this. Run **one targeted test**, not `npm test:all` / the whole suite: an
unrelated failure at an old commit would mark it bad and send the search down the wrong half.

The `good`/`bad` pair assumes a regression (good in the past, bad now). The `old`/`new`
aliases mean the same search and read better when hunting any state transition.

See `references/bisect.md` for the full happy path and the skip/untestable wrapper.

### Bisect skip and determinism (untestable or flaky commits)

Two things corrupt a naive bisect, and the default bad answer — "exit 1 on any failure" —
walks into both:

- **Old commits won't build.** A compile error exits 1, which bisect reads as "bug present"
  and marks a clean commit bad. Wrong: an unbuildable commit is **untestable** — your
  wrapper script must `exit 125` (skip) on build failure, distinguishing it from a real
  bad commit.
- **Flaky network/timing failures.** A transient un-stubbed third-party call exits 1 and
  gets blamed. Force determinism *during* bisect — stub the network, pin `TZ`, seed the
  RNG — so only the real bug can fail the step. If a commit's result flips between runs,
  treat it as untestable (`exit 125`), not bad.

Wrap the step in a script that returns **0 = good, 1 = bad, 125 = skip** (the valid bad
range is 1–127 *excluding* 125), guards the build, stubs the network, and retries once to
catch flakiness. Then `git bisect run ./bisect-step.sh`. Full wrapper in
`references/bisect.md`.

---

## Step 4: Make the repro deterministic

The bug "only around midnight, with a random discount code, via a third-party pricing API"
has three non-determinism sources. Pin all three so it **fails the same way every single
run** — do not wait for midnight, do not let it hit the real pricing API, and never use a
`sleep`/`setTimeout`/`waitForTimeout` to paper over timing.

| Source | Vitest | Playwright |
|--------|--------|-----------|
| **Time** | `vi.useFakeTimers()` + `vi.setSystemTime(new Date('…'))` | `page.clock.install({ time })` + `page.clock.setFixedTime(…)` |
| **Randomness** | `faker.seed(1337)` (or stub `Math.random`) | seed the app's RNG via an init hook |
| **Network** | MSW `setupServer` + `http.get` → `HttpResponse.json` | `page.route(...)` → `route.fulfill(...)` |

Key points:
- **Vitest:** `vi.setSystemTime` only works after `vi.useFakeTimers()`. Seed faker in
  `beforeEach`. Set MSW `onUnhandledRequest: 'error'` so a missed stub fails loudly.
- **Playwright:** `page.clock.install`/`setFixedTime` must run **before** `page.goto`.
  `page.clock` is the supported API — it exists; do not fall back to a hand-rolled `Date`
  override, and do not bump the timeout to "make it pass."
- Pin locale/timezone/currency (`TZ=UTC`, `LANG`) when the bug is locale-sensitive.

**Avoid:** `jest.useFakeTimers('legacy')` (and `timers: 'legacy'`) — legacy fake timers are
deprecated and don't mock `Date`/`Date.now`, so the clock stays live and your "frozen"
repro still drifts. Modern timers are the default since Jest 27 — just call
`jest.useFakeTimers()` + `jest.setSystemTime()`, or `vi.useFakeTimers()` in Vitest. (Jest 30,
2025)

See `references/determinism.md` for the full Vitest (`vi.useFakeTimers` + `vi.setSystemTime`
+ `faker.seed` + MSW `setupServer`) and Playwright (`page.clock` + `page.route`) recipes,
plus a 10-run determinism check.

---

## Step 5: Write the failing regression test (red) first

You have a clean deterministic repro and the dev hasn't fixed it yet. Write the regression
test **now**, before the fix, as TDD-for-bugs:

1. Encode the minimal repro as a test that **asserts the real expected value** —
   `expect(total).toBe(2754)`. A tautological assertion that always passes proves nothing.
2. Run it and confirm it **fails before the fix** — it must be **red first**. A test that
   doesn't go red isn't exercising the bug.
3. **Commit the test** (or stage it on the fix branch) so the **test guards the fix** in CI.
4. After the dev's fix lands, re-run: it should **flip to green**. Same test, no edits.

Expected state: **red before the fix, green after the fix.**

Wrong moves that defeat the point — a test that genuinely fails until *this* bug is fixed:
writing the test only after the fix already landed; disabling the failing test (pending
markers, an always-true tautology, or removing the assertion) just to keep CI green; or
fixing first and bolting a test on afterward. Keep the assertion live and let it go red.

See `references/determinism.md` for the deterministic test bodies the assertion sits in.

---

## Step 6: Verify the fix actually fixes it

The dev pushed a fix and the regression test now passes. **Green is necessary but not
sufficient** — a test can pass for an unrelated reason. Do not close on green alone or
trust the dev's word. Run the validity check:

1. **Revert the fix** temporarily (stash it, or `git stash`/comment the fix line) and
   re-run the test. Confirm it **still fails without the fix**. That proves the
   test actually exercises this bug (the test catches the bug) — that it passes *because of
   the fix*, and is not passing for another reason unrelated to the defect.
2. **Restore the fix** and confirm green returns.
3. **Re-run deterministically** several times (`--repeat-each` / a loop) to confirm the
   green is stable, not a lucky pass.

Only when the test is red-without-fix and green-with-fix, repeatably, is the fix verified.
This revert-to-verify step is the whole point of the regression test and is the one most
often left out.

---

## Step 7: Flaky vs environment vs not-reproducible

You spent two hours and it won't reproduce for you, but it clearly happens for the user. Do
**not** close as "cannot reproduce" immediately, do not assume flaky and quarantine, and do
not conclude "doesn't repro on my machine so it isn't real." These are three distinct
diagnoses with distinct evidence:

| Diagnosis | Discriminating evidence | What you do |
|-----------|------------------------|-------------|
| **Flaky** | Same code, same env, **passes and fails on the same commit** — run `--repeat-each 50` (or rerun the same command many times) in *one* environment and watch it flip | Find the non-determinism (time/RNG/network/race), make it deterministic (Step 4) |
| **Environment-specific** | Reproduces only under a different config — **timezone, locale, viewport, OS, browser version, CI vs local** — and is stable within that config | Match the user's environment: reproduce *their* timezone/locale/OS/browser, then minimize |
| **Data-dependent** | Reproduces only with the user's specific account/input | Get and replicate their data/fixture; the bug rides on the input, not the platform |
| **Genuinely not reproducible** | None of the above reproduces after matching env + data + repeat runs | Document what you tried (envs, run counts, data) and the negative result — don't silently close |

The step bare attempts miss: **match the reported user environment and data** before
judging — replicate their config (timezone, locale, OS, browser version) and reproduce
their env, then re-run. `--repeat-each` in the *same* env isolates true flakiness; cross-env
divergence points to environment-specific; input-dependence points to data-specific.

---

## Step 8: Write the evidence back into the ticket

Reproduction and the committed regression test are done. Replace the vague original report
with a structured block — do **not** paste the raw 14-step UI walkthrough, and do **not**
just write "reproduced, closing." Include all seven elements:

1. **Minimal steps / repro command** — the smallest path, not the walkthrough.
2. **Environment + build/commit** — exact SHA and platform.
3. **Expected vs actual** — the concrete numbers.
4. **Introducing commit** — the offending commit from `git bisect`.
5. **Regression test** — link to the committed test file and path.
6. **Evidence** — logs, screenshot, trace, or artifact.
7. **Determinism notes** — seed, frozen time, and stubs so anyone can re-run identically.

See `references/ticket-writeback.md` for the copy-paste Markdown structure.

---

## Anti-Patterns

### 1. Jumping to the fix before reproducing
Reading "total is wrong" and patching the total calc, or guessing "looks like a rounding
bug," before you can make it fail on demand. You can't prove an unreproduced fix works.
Extract the repro first (Step 1).

### 2. Minimizing before confirming it reproduces
Stripping steps from a repro you never confirmed actually fails. You end up "minimizing"
something that was never broken. Confirm the baseline fails, *then* cut.

### 3. Removing several variables at once
Cutting three steps in one pass, so when it stops reproducing you don't know which one
mattered. Remove one variable at a time and re-run after each.

### 4. Bisecting the whole suite, or by hand
`git bisect run npm test:all` lets unrelated failures mark commits bad; manual
checkout-and-test is slow and error-prone. Run one targeted test under `git bisect run`.

### 5. Exit 1 on build failure during bisect
Treating an unbuildable commit as "bug present." It marks clean commits bad and corrupts
the search. Return **exit 125** (skip) for untestable commits; reserve non-zero for the
genuine bug.

### 6. Live time, RNG, or network in the repro
Leaving `new Date()` and `Math.random` unmocked, hitting the real pricing API, or
"waiting for midnight" with a sleep. The repro becomes a coin flip. Freeze time, seed the
RNG, stub the network (Step 4).

### 7. Writing the test after the fix, or disabling it
Adding the regression test once the bug is already gone, or neutering a failing test
(pending markers, a tautological assertion, a removed assertion) to keep CI green. The test
never proves it catches the bug. Write it red, before the fix.

### 8. Closing on green without revert-to-verify
"The test passes, close it." A test can pass for the wrong reason. Revert the fix, confirm
it goes red again, restore, confirm green.

### 9. Closing as "cannot reproduce" on first failure to repro
Collapsing flaky / environment-specific / not-reproducible into one dismissal. Match the
user's environment and data and use `--repeat-each` before judging (Step 7).

---

## Failure Modes

| Symptom | Likely cause | Fix / check |
|---------|--------------|-------------|
| Bisect lands on an obviously unrelated commit | Full suite or flaky failures marking commits bad | Switch to one targeted test; wrap with exit-125 skip + network stub |
| Repro passes locally, fails in CI (or vice versa) | Environment-specific (TZ, locale, OS, browser) | Pin `TZ`/`LANG`; match the failing environment (Step 7) |
| Test is green but you're not sure it catches the bug | Never ran it red | Revert the fix and confirm it fails (Step 6) |
| `vi.setSystemTime` has no effect | Called before `vi.useFakeTimers()` | Call `useFakeTimers()` first |
| `page.clock` time not applied to app startup | `install`/`setFixedTime` ran after `page.goto` | Move clock setup before navigation |
| Repro flips pass/fail run to run | Live time/RNG/network not pinned | Apply Step 4; confirm with `--repeat-each 10` |

---

## Verification

- The repro command/test **fails on demand**: run it 10× (`--repeat-each 10` or a loop) and
  confirm it fails every time before the fix.
- `git bisect run …` terminates with "`<sha>` is the first bad commit" and `git bisect
  reset` leaves you on the original `HEAD`.
- With the fix reverted the regression test exits non-zero; with the fix applied it exits 0.
- The ticket block contains all seven write-back elements (Step 8) — grep it for the
  commit SHA, the test path, and the determinism notes.

---

## Done When

- A documented **minimal** reproduction exists — smallest steps or a single command — that
  fails on demand, verified failing across repeated runs.
- If the bug is a regression, `git bisect` has named the introducing commit SHA and it is
  recorded in the ticket.
- The repro is deterministic: time frozen, RNG seeded, network stubbed — proven by 10
  identical consecutive runs.
- A regression test is committed that was **red before the fix and green after**, and was
  confirmed to fail when the fix is reverted.
- The ticket carries the structured evidence block with all seven elements (minimal steps,
  environment/build, expected vs actual, introducing commit, regression-test link,
  evidence artifact, determinism notes); the original vague report is replaced, not left.
- If it did not reproduce, it is classified (flaky / environment-specific / data-dependent /
  not-reproducible) with the evidence that led there — never silently closed.

---

## Related Skills

- **`ai-bug-triage`** — Classify, deduplicate, and severity-route *existing* failures.
  Triage decides *whether and where* a failure matters; come here to actually *reproduce*
  one and write the failing test. Triage hands off; bug-reproduction picks up.
- **`ai-test-generation`** — Generate tests from specs/PRDs/stories. Use it when the source
  is a requirement; use this skill when the source is a *defect* and the test must first go
  red against the bug.
- **`test-reliability`** — Runtime self-healing and quarantine for a flaky test. When Step 7
  diagnoses true flakiness, go there to stabilize or quarantine; here you only diagnose.
- **`qa-project-context`** — Stack, test runner, environment matrix, and known-flaky areas
  that shape every step above. Check it first.
- **systematic-debugging** (`superpowers:systematic-debugging`) — The general root-cause
  debugging loop once you have a deterministic repro; this skill produces that repro and
  the failing test that guards the eventual fix.
