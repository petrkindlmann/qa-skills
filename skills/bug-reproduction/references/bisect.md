# Automated bisect to find the introducing commit

You have a bug on `HEAD` that worked in last month's release, and a command that exits
**non-zero when the bug is present**. `git bisect run` does a binary search over history
and calls your command at each step. Let it drive — do not check out commits by hand.

## The exit-code contract

`git bisect run <cmd>` interprets the command's exit code at each commit:

| Exit code | Meaning | bisect verdict |
|-----------|---------|----------------|
| `0` | bug absent | **good** (or `old`) |
| `1`–`124`, `126`, `127` | bug present | **bad** (or `new`) |
| `125` | commit is **untestable** — skip it | `git bisect skip` |
| any | — | a non-zero exit other than 125 marks the commit bad |

So your repro command must return **0 when the feature is fine** and **non-zero when the
bug reproduces**. Most test runners already do this: a failing test exits 1.

## Happy path

```sh
git bisect start
git bisect bad HEAD                 # current commit has the bug  (a.k.a. `git bisect new`)
git bisect good v2.4.0             # last month's release was clean (a.k.a. `git bisect old`)
git bisect run npm test -- checkout-total.spec.ts   # ONE targeted test, not the whole suite
# ... bisect prints "<sha> is the first bad commit" ...
git bisect reset                    # ALWAYS clean up — restores HEAD and ends the session
```

Terminology: classic `good`/`bad` assumes you are looking for a commit that introduced a
*regression* (good in the past, bad now). The `old`/`new` aliases mean the same binary
search but read naturally when you are hunting any state transition, not just a break —
`git bisect start --term-old fixed --term-new broken` lets you rename them.

**Run one targeted command, not the full suite.** `git bisect run npm test` (every test)
is slow and brittle: an unrelated failing test at an old commit will mark it bad and send
the search down the wrong half. Point bisect at the single test that encodes *this* bug.

## Skip untestable commits and ignore flaky failures (exit 125)

Two failure modes corrupt a naive bisect:

1. **Old commits won't build.** A compile error makes the test runner exit 1, which bisect
   reads as "bug present" → marks a clean-but-unbuildable commit bad. Wrong.
2. **Flaky network/timing failures.** A transient failure (un-stubbed third-party call)
   exits 1 and gets read as the bug. Wrong.

The fix is a **wrapper script** that distinguishes "can't judge this commit" (exit 125,
skip) from "the bug is genuinely present" (exit 1, bad), and forces determinism while it
runs. `git bisect run ./bisect-step.sh`:

```sh
#!/usr/bin/env bash
# bisect-step.sh — exit 0 = good, 1 = bad (bug present), 125 = skip (untestable).
set -u

# Force determinism so a flaky network or clock can't mark a commit bad.
export TZ=UTC
export PRICING_API_URL="http://localhost:4000"   # local stub server, never the live API
export FAKER_SEED=1337

# 1. If the commit doesn't build, it's UNTESTABLE — skip, don't blame it.
if ! npm ci --silent && npm run build --silent; then
  echo "build failed → untestable, skipping this commit"
  exit 125
fi

# 2. Run the ONE targeted test. Retry once to absorb a single flaky blip; if it flips
#    between pass and fail in the SAME commit, treat the commit as untestable (skip),
#    not as bad — a flaky result is not evidence the bug was introduced here.
npm test -- checkout-total.spec.ts && first=0 || first=1
npm test -- checkout-total.spec.ts && second=0 || second=1

if [ "$first" -ne "$second" ]; then
  echo "result not reproducible at this commit (flaky) → skip"
  exit 125
fi

# Stable result: 0 = bug absent (good), 1 = bug present (bad).
exit "$first"
```

Wire it up:

```sh
git bisect start
git bisect bad HEAD
git bisect good v2.4.0
git bisect run ./bisect-step.sh
git bisect reset
```

Why this matters: the default bad answer — "exit 1 on any failure" — silently marks
unbuildable or flaky commits as bad and the binary search converges on the wrong commit.
The exit-125 skip path and the stub-the-network-during-bisect step are what keep the
result trustworthy.

If a *whole region* of history is unbuildable, skip it up front:

```sh
git bisect skip v2.4.1..v2.4.5     # exclude a known-broken range before running
```

## After bisect

`git bisect run` prints `<sha> is the first bad commit` and `git show <sha>` reveals the
diff. Record that SHA — it is the **introducing commit** and goes verbatim into the ticket
write-back. Then `git bisect reset` to leave the working tree on the original `HEAD`.
