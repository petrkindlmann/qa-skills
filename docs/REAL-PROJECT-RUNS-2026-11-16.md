# The three v3.6.0 recipes on real projects (2026-11-16)

## Question

The v3.6.0 recipes (`regression-evidence.md`, `lost-reply-retry.md`, `account-switch.md`) were
written and tested against this repository's own lab. Do they work on projects nobody here
wrote, and do they find anything there?

## Answer

They run on real projects, and each needed adjustments the lab never asked for.

- **Regression evidence.** Over 250 merged fix commits in nine well-known repositories, the
  fix commit's tests were run against the commit before the fix. In 226 the tests fail before
  and pass after. In none of the 250 was a test shown to pass on the buggy code for good. The
  24 that were not a plain red-then-green are the useful part: five pytest fixes whose tests
  are red before the fix only because they import a helper the fix adds, seven whose tests
  fail only on another interpreter version or under the type checker, one test that fails 18
  times in 20 on the buggy code, and eight where this machine could not produce a result.
- **Lost reply.** With the official MCP TypeScript SDK as client and server transport, a
  `tools/call` whose reply is dropped and which the caller sends again runs the tool twice. A
  key kept in memory stops that until the server restarts; a key kept on disk survives the
  restart.
- **Account switch.** On a widely used self-hosted web application, one of four URLs holding
  a private file was still readable in the same browser after sign-out, online and offline,
  with no request reaching the server. The application is not named here; see
  [Account switch](#account-switch-a-self-hosted-web-application).

The sample is reviewed, mature projects. It says nothing about repositories without review,
and it does not show that the recipes improve what an agent produces.

## Method

Counting rules were fixed before the first run and not changed afterwards.

- **Repositories.** undici, fastify, eslint, express, hono (Node), pytest, click, fastapi, llm
  (Python), cloned on 2026-11-15 with history since 2025-01-01. flask, werkzeug and httpx were
  cloned and had too few qualifying commits; aider and OpenHands were cloned and not set up.
- **Sample.** Per repository, the 30 most recent commits on the default branch whose subject
  says `fix`, is not a docs, chore, CI, test-only, refactor, types or lint change, and which
  change at least one source file and one test file. To that were added up to 40 qualifying
  commits carrying a `Co-authored-by` trailer or footer of a coding agent (Claude, Copilot,
  Cursor, Codex, Devin, Gemini, OpenHands, aider). That selected 293 commits.
- **Set aside, 43.** 41 merge commits where a commit inside the pull request says `fix` and
  the pull request's own title does not, and two commits that change more than eight test
  files. 250 were evaluated.
- **Runs per commit.** Three: the parent with its own test files (to learn which test names
  are new), the parent with the fix commit's test files, and the fix commit. The last two are
  one call of the shipped `regressionEvidence`, loaded from the code fence in
  `skills/bug-reproduction/references/regression-evidence.md`. A run was limited to 150 s.
- **Classification.** Automatic, from the three JUnit reports, in `analyze.mjs`. Every commit
  the classifier did not call red-then-green was then read and re-run by hand, as was every
  commit whose only red tests failed with a message that looks like a missing name
  (`ImportError`, `AttributeError`, `is not a function` and similar). The hand readings are
  in [`review.json`](evidence/real-project-runs-2026-11-16/review.json) and replace the
  automatic category in the final table.
- **Environment.** One Mac (Darwin 27.2.0), Node 26.0.0, Python 3.13.12, with 3.12.13 and
  3.14.6 for the two version-specific fixes. Dependencies were installed at each
  repository's current head; 19 commits of fastapi and llm were re-run with dependencies
  resolved as of the commit's date, because the current ones broke their tests.
- **Repeat.** All of undici and fastify (85 commits) were run a second time.

## Results: fix commits

| Result | Commits | Coding-agent co-authored |
|---|---|---|
| Tests fail at the parent and pass at the fix | 226 | 56 |
| Inconclusive on this machine | 8 | 0 |
| Fail at the parent only in another environment | 7 | 2 |
| Fail at the parent for another reason | 5 | 3 |
| Fail at the parent while the test file is imported | 1 | 0 |
| Flaky on the buggy code | 1 | 1 |
| Titled fix, no behaviour change | 1 | 0 |
| Not runnable here | 1 | 0 |
| **Evaluated** | **250** | **62** |

| Repository | Evaluated | Red then green | Other |
|---|---|---|---|
| undici | 53 | 49 | 3 inconclusive, 1 flaky on the bug |
| pytest | 35 | 28 | 5 another reason, 1 other environment, 1 not runnable |
| hono | 34 | 29 | 5 other environment (type-level tests) |
| eslint | 30 | 26 | 4 inconclusive |
| fastify | 30 | 30 | |
| fastapi | 29 | 27 | 1 at import, 1 other environment |
| llm | 28 | 28 | |
| click | 7 | 7 | |
| express | 4 | 2 | 1 no behaviour change, 1 inconclusive |

What the rows other than red-then-green are:

- **Another reason (5, all pytest).** The new tests import a private helper that the fix
  itself adds (`_imp_fix_co_filename`, `_plugin_rewrite_name`, `RegisteredMarker`,
  `_chmod_rwx`, `_get_prog_name`). At the parent the import fails, in four cases for the
  whole test file. Red, then green, and the red says nothing about the bug. With the import
  made tolerant, all five commits have at least one test that fails at the parent on the
  behaviour ([`tolerant-import.txt`](evidence/real-project-runs-2026-11-16/tolerant-import.txt)),
  so the tests are sound. A reviewer who only checks "red before, green after" could not have
  known that.
- **Other environment (7).** Five hono fixes are to types; their tests pass under vitest at
  the parent and fail under `tsc` there (1 to 8 type errors, 0 at the fix). One pytest fix
  concerns Python 3.12 only and one fastapi fix Python 3.14 only; on those interpreters the
  tests fail at the parent and pass at the fix, and on 3.13 they pass at both.
- **Flaky on the bug (1, undici `2f66db7322`).** Recorded as passing at the parent in the
  first pass and failing in the second. Twenty runs at the parent: 18 failed, 2 passed.
- **At import (1, fastapi `65e42bd5ec`).** The bug raises while the routes are declared, so
  the test file does not collect at the parent. The error is the reported one.
- **No behaviour change (1, express `6cd404eb28`).** A refactor titled fix; its test passes
  before and after, as it should.
- **Not runnable (1, pytest `7d646b595c`).** Needs Python 3.15.
- **Inconclusive (8).** Four eslint commits and one express commit wrote no report with the
  dependencies installed at head. Three undici commits have tests that fail on this machine
  at the fix commit itself.

**New tests that pass at the parent.** The 226 red-then-green commits add 1,345 tests. 920
fail at the parent and 425 pass there; 100 of the commits have at least one of the latter.
These were not read one by one. A fix commit commonly adds neighbouring cases along with the
regression test, so this is a count and not a defect rate.

**Repeat.** 83 of 85 commits got the same result twice. The two differences are the flaky
undici test above and one undici commit where two tests failed at the fix commit the second
time ([`second-pass.txt`](evidence/real-project-runs-2026-11-16/second-pass.txt)).

**The helper's own verdict on a whole file.** The survey passed the changed test files to
`regressionEvidence` with no `select` and a symptom that matches anything. Used that way the
helper said `distinguishes` for 9 commits, `does_not_distinguish` for 158 and `inconclusive`
for 83. That is the helper doing what it documents: it asks that every selected test fail at
the base, and a real test file is mostly tests that have nothing to do with the fix. The
inconclusive ones were two tests sharing a name (41), a skipped test in the file (28), a
different set of tests at the two revisions (9) and a base failure the classifier then
handled (5). On a real suite `select` is not optional.

## Three runs in detail

### Regression evidence: pytest pull request 14989

Issue [pytest-dev/pytest#14552](https://github.com/pytest-dev/pytest/issues/14552) reports
that after a test directory is moved, the second run fails with
`AssertionError: assert '…st1/test_a.py' == '…st2/test_a.py'`. The fix is merge commit
`f8ad1f6f95`. The shipped helper, with the fix's two new tests selected
([`pytest-14989.mjs`](evidence/real-project-runs-2026-11-16/pytest-14989.mjs),
[output](evidence/real-project-runs-2026-11-16/pytest-14989.txt)):

| Test file | `symptom` | Verdict |
|---|---|---|
| As committed | From the report: the inner run has one failure | `inconclusive`: failed at the base without the symptom, `ImportError: cannot import name '_imp_fix_co_filename'` |
| As committed | `/co_filename/`, a keyword from the issue title | `distinguishes`, wrongly: the `ImportError` text contains the helper's name |
| Import of the new helper made tolerant | From the report | `distinguishes`: both tests fail at the base with the symptom and pass at the fix |

The first row is the recipe working as intended. The second is a way to defeat it that the
recipe does not warn about: a symptom that is a single word from the report can also occur
in an identifier. The third is the evidence the pull request could have carried.

### Lost reply: the MCP TypeScript SDK

Client: `Client` with `StreamableHTTPClientTransport`. Server: `McpServer` on
`StreamableHTTPServerTransport`, stateless, `@modelcontextprotocol/sdk` 1.32.2. The tool,
`create_note`, appends a line to a file and was written for this run; the client, the
transport and the protocol are the SDK's. The proxy dropped the reply to the first
`tools/call`, an HTTP 200 carrying the result as one server-sent event
([`mcp/run.mjs`](evidence/real-project-runs-2026-11-16/mcp/run.mjs),
[output](evidence/real-project-runs-2026-11-16/mcp/run.txt)).

| Case | Verdict | Notes written |
|---|---|---|
| Tool as written, the caller calls it again | `duplicated` | 2 |
| Caller sends `idempotency_key`, the tool ignores it | `duplicated` | 2 |
| Key remembered in memory | `one_effect` | 1 |
| Key remembered in memory, server restarted between the attempts | `duplicated` | 2 |
| Key remembered on disk, server restarted | `one_effect` | 1 |

The SDK client did not retry by itself (`clientRetried=false`); the second call stands for an
agent that gets an error and calls the tool again. This reproduces the question open in
[modelcontextprotocol#3394](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/3394);
it is not a defect in the SDK.

### Account switch: a self-hosted web application

A current release of a widely used open-source application was run locally in Docker with
two accounts. Account A owned a private file containing a random sentinel. The helper drove
Playwright's Chromium 151 through A, sign-out and B over four URLs that show A the file.

Eight findings, all for one URL, the direct download of the file: signed out and as B, online
and offline, in the response and in the page. The other three URLs left nothing. A separate
check with plain Playwright and the server's request log:

- before sign-in the URL answers 404;
- to A it answers 200 with `Cache-Control: private` and a `max-age` of several hours;
- after sign-out, in the same browser, it shows the file and the server log has no new request;
- a new browser gets 404.

The server refuses everyone it should. The copy is in the browser's HTTP cache, which is the
case the recipe's repair list describes (`private` alone still lets this browser reuse the
response for the next account). Whether that matters is the project's decision. The
application's name, the URL and the scripts are left out of this report until the project
has been told.

## What real projects asked of the recipes

None of these is in the shipped text yet. They are candidates for a later change.

1. A pass at the base can be the environment. The base needs the interpreter version the
   report names, the dependencies of the time, and for a type-level test the type checker
   as the runner.
2. A test file that imports something the fix adds does not load at the base. The symptom
   check catches it; the recipe could say how to write the test so it reaches the behaviour.
3. A symptom of one word can match an identifier in an unrelated error.
4. A test can be flaky on the bug. One base run that passes is weak evidence either way.
5. `select` is needed on any real test file: duplicate test names and skipped tests are
   common and each makes the verdict `inconclusive`.
6. Tests of a buggy revision may not exit (open sockets in undici). The runner's force-exit
   and per-test timeout were needed.
7. `prepare` runs in the working tree as well as in the base worktree, so it has to be safe
   to run twice.
8. A base run can leave damage outside its worktree. The parent of a pytest fix to `rm_rf`
   left a temp directory that pytest could not delete, and every later pytest run on the
   machine failed at start-up until it was removed by hand.
9. For MCP over Streamable HTTP, `drop` has to pick the `tools/call` request; the default
   drops the first POST, which is `initialize`.
10. `accountSwitchLeaks` needed `settled` on an application that holds a notification stream
    open. Its timeout message could name the requests it was waiting for.

## Limits

- One machine and, except for undici and fastify, one run per commit.
- The filter is the word `fix` in a title. Fixes titled otherwise are not in the sample.
- Only test files changed by the fix commit were run. A regression test added in a later
  commit is not seen.
- Only repositories whose tests run locally within 150 s per file set are in the sample.
- A coding-agent trailer shows that an agent took part in the commit, not who wrote the test.
- Red at the parent with an assertion failure was not compared with the bug report, apart
  from the pytest example. The hand reading covered the 24 commits that were not
  red-then-green and the 8 whose red messages look like a missing name.
- The account-switch run used Chromium only.

## Evidence

In [`evidence/real-project-runs-2026-11-16/`](evidence/real-project-runs-2026-11-16/):

- `results.json`: one row per selected commit (293) with repository, commit, title, test
  files, automatic and final result, and counts of new tests.
- `review.json`: the hand readings.
- `tables.txt`, `second-pass.txt`: the classifier's output.
- `survey.mjs`, `analyze.mjs`, `tolerant.sh`, `hono-types.sh`: the scripts as run, with the
  working directory read from `REAL_RUNS_DIR` in place of a local path.
- `pytest-14989.mjs` and `.txt`, `tolerant-import.txt`: the pytest runs.
- `mcp/`: the server, the run and its output.

The clones, virtual environments and full per-run records (about 3.5 GB) were not kept in
the repository.
