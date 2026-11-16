# Regression evidence: the same test at two revisions

Step 6 of the skill reverts the fix by hand and re-runs the test. The two tools here do it
mechanically, which matters most when an agent wrote both the fix and the test in one
sitting: the test was never seen red, and it may only describe what the new code does.

- **`scripts/regression-check.mjs`** is a command. It looks at every test a change adds or
  edits and says which of them fail on the code that still has the bug, and why. Start here.
- **`regressionEvidence`** is a function for one named test, to assert inside a suite or a
  gate. It demands the reported symptom and has stricter verdicts.

Both freeze the test files, run them at the revision that has the bug and at the candidate,
and compare JUnit reports. They need `git` and a runner that can write JUnit XML
(`node --test`, Playwright, Vitest and pytest have it built in; Jest needs `jest-junit`).
The script runs on Node 20 or later, the function as written on Node 24.

## The script: every new test, at both revisions

The fix and its tests are in the working tree and `HEAD` still has the bug:

```bash
node scripts/regression-check.mjs --symptom '0\.30000000000000004' -- \
  node --test --test-reporter=junit --test-reporter-destination={report} {tests}
```

A branch or a pull request against its base:

```bash
node scripts/regression-check.mjs --base origin/main --candidate HEAD --prepare 'npm ci' -- \
  npx vitest run --reporter=junit --outputFile={report} {tests}
```

The path is relative to this skill's folder. `{report}` becomes the JUnit file the runner
must write and `{tests}` the test files. Without `--tests` the script carries every file
changed since the base whose path looks like a test or test data, and hands the runner
those that are code and not fixtures, helpers or snapshots. A file named like a test
(`url.test.ts`, `test_url.py`) is run wherever it lives, also under `src/utils/`. `--help`
lists the options.

It runs the base three ways: with its own tests, to learn which test names are new; with
the candidate's tests; and with the candidate's tests again, up to `--repeat` times
(default 3), while a new test keeps passing there. Then the candidate once. Each run is in
its own process group, which is removed when the run ends, so workers that a buggy
revision leaves hanging do not survive the check.

Every new or changed test gets one status:

| Status | Observed at the base | What it tells you |
|---|---|---|
| `shows_the_bug` | Failed with the `--symptom` | The evidence you want |
| `red_then_green` | Failed, and no `--symptom` was given | Compare the printed failure with the report, or pass `--symptom` |
| `red_without_symptom` | Failed with something else | Red for another reason. Read it |
| `missing_at_base` | Failed, or its file did not load, on a name that only the candidate has; printed as `needs <name>` | The test never reached the behaviour. It is red on any revision without the new helper |
| `did_not_load` | The file failed to load, with or without a report from the runner, and the error is not the symptom | Read the error. A support file that was not carried is named with `--tests` |
| `green_at_base` | New, and passed in every base run | It never showed this bug. A neighbouring case is fine; the regression test must not be here |
| `flaky_at_base` | Passed in some base runs, failed in others | Its green after the fix proves little. Make it deterministic first (Step 4) |
| `fails_at_candidate` | Any | The change does not make it pass |
| `skipped` | Skipped in a run | No result |

The verdict is `shows_the_bug` (or `red_then_green` without a symptom) when at least one
test is in the first two rows and nothing fails at the candidate. Otherwise it is
`no_test_shows_the_bug`, `not_fixed`, `breaks_other_tests` (a test that passed at the base
now fails), `inconclusive` (no report, a timeout, no new or changed test, or every one of
them skipped) or `tampered`.
Exit code 0 is for the first two verdicts, 2 for `inconclusive` and `tampered`, 1 for the
rest. `--json` writes the revisions, the hashes of the carried files and every row, which is
what goes into the ticket.

`missing_at_base` is decided from the repository and not from the wording of the failure:
the name in an `ImportError`, a `TypeError: x is not a function` or a failed module lookup
is searched at both revisions, and the status applies only when the base does not contain
it anywhere and the candidate does. A crash on a name the base already uses, which may be
the bug itself, stays red. To repair such a test, reach the behaviour through what the base
already has, or import the new helper inside the one test that is about the helper.

`green_at_base` has three ordinary causes besides a test that does not catch the bug. The
bug may exist only on another runtime version, in which case run the check with that
interpreter. The base may need the dependencies of its time. And a fix to types is red only
under the type checker, so use the type checker as the test command for it.

## The function: one test, as an assertion

### Verdicts

| Verdict | What was observed |
|---|---|
| `distinguishes` | Every selected test failed at the base with the reported symptom and passed at the candidate, on the same test bytes |
| `does_not_distinguish` | A selected test passed at the base. It never showed the bug, so its green says nothing about the fix |
| `not_fixed` | The test shows the bug at the base and still fails at the candidate |
| `candidate_fails` | A selected test passed at the base and fails at the candidate |
| `breaks_other_tests` | The selected tests go red to green, and other tests from the same command that passed at the base now fail |
| `inconclusive` | Nothing can be said: no test matched, a test was skipped, a run timed out or wrote no report, the two runs selected different tests, or the base failure does not carry the symptom |
| `tampered` | A frozen test file or a tracked file changed while the tests ran |

Only `distinguishes` supports "this test catches the bug and the change removes it". Every
other verdict goes into the report as it is. `inconclusive` is not a pass and not a fail;
fix the cause and run again.

The symptom is what keeps a wrong failure out. A test that calls a function the fix
introduced fails at the base with `TypeError: formatTotal is not a function`. That is red,
then green, and it has nothing to do with the bug. Give the symptom as the user would have
seen it: the wrong value, the status code, the duplicated row.

### The helper

```ts
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const unescape = (value: string) => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(x?)([0-9a-f]+);/gi, (_, hex, code) => String.fromCodePoint(parseInt(code, hex ? 16 : 10)))
  .replace(/&amp;/g, '&');

type Case = { name: string; status: 'passed' | 'failed' | 'skipped'; message: string };
type Run = { revision?: string; exitCode: number | null; timedOut: boolean; tests: Case[] | null; output?: string; changed?: string[] };

export function readJUnit(xml: string): Case[] {
  const attribute = (source: string, name: string) => unescape(new RegExp(`\\s${name}="([^"]*)"`).exec(source)?.[1] ?? '');
  const cases: Case[] = [];
  for (const [, attributes, body = ''] of xml.matchAll(/<testcase\b((?:[^>"]|"[^"]*")*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const problem = /<(failure|error)\b((?:[^>"]|"[^"]*")*?)(?:\/>|>([\s\S]*?)<\/\1>)/.exec(body);
    cases.push({
      name: [attribute(attributes, 'classname'), attribute(attributes, 'name')].filter(Boolean).join(' › '),
      status: problem ? 'failed' : /<skipped\b/.test(body) ? 'skipped' : 'passed',
      message: problem ? unescape(`${attribute(problem[2], 'message')}\n${(problem[3] ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')}`) : '',
    });
  }
  return cases;
}

export function regressionVerdict(base: Run, candidate: Run, { symptom, select = /./ }: { symptom: RegExp; select?: RegExp }) {
  if (!(symptom instanceof RegExp)) throw new Error('Give the reported symptom as a RegExp; a test can fail at the base for other reasons');
  const matches = (pattern: RegExp, value: string) => new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, '')).test(value);
  const verdict = (name: string, reason: string, regressions: string[] = []) => ({ verdict: name, reason, regressions });
  for (const [label, run] of [['base', base], ['candidate', candidate]] as const) {
    if (run.changed?.length) return verdict('tampered', `${label}: ${run.changed.join(', ')} changed while the tests ran`);
    if (run.timedOut) return verdict('inconclusive', `${label}: the run timed out`);
    if (!run.tests) return verdict('inconclusive', `${label}: no JUnit report was written (exit ${run.exitCode})`);
  }
  const baseTests = base.tests ?? [], candidateTests = candidate.tests ?? [];
  const was = baseTests.filter(test => matches(select, test.name));
  const now = candidateTests.filter(test => matches(select, test.name));
  const names = (tests: Case[]) => tests.map(test => test.name).sort();
  if (!was.length || !now.length) return verdict('inconclusive', `no test matched ${select} at the ${was.length ? 'candidate' : 'base'}`);
  if (names(was).join('\n') !== names(now).join('\n')) return verdict('inconclusive', `the two runs selected different tests: ${names(was).join(', ')} / ${names(now).join(', ')}`);
  if (new Set(names(was)).size !== was.length) return verdict('inconclusive', 'two selected tests share a name; make the selection unambiguous');
  const skipped = [...was, ...now].filter(test => test.status === 'skipped');
  if (skipped.length) return verdict('inconclusive', `skipped: ${skipped[0].name}`);

  const after = new Map(now.map(test => [test.name, test.status]));
  const green = was.filter(test => test.status === 'passed');
  const broken = green.find(test => after.get(test.name) === 'failed');
  if (broken) return verdict('candidate_fails', `passes at the base and fails at the candidate: ${broken.name}`);
  if (green.length) return verdict('does_not_distinguish', `passes at the base, so it never showed the bug: ${green.map(test => test.name).join(', ')}`);
  const other = was.find(test => !matches(symptom, test.message));
  if (other) return verdict('inconclusive', `base: "${other.name}" failed without the symptom ${symptom}: ${other.message.trim().split('\n')[0]}`);
  const red = now.filter(test => test.status === 'failed');
  if (red.length) return verdict('not_fixed', `still fails at the candidate: ${red.map(test => test.name).join(', ')}`);

  const passedBefore = new Set(baseTests.filter(test => test.status === 'passed').map(test => test.name));
  const regressions = candidateTests.filter(test => test.status === 'failed' && passedBefore.has(test.name)).map(test => test.name);
  return regressions.length
    ? verdict('breaks_other_tests', `the selected tests go red to green, and ${regressions.length} other test(s) that passed at the base now fail`, regressions)
    : verdict('distinguishes', `${was.length} test(s) failed at the base with the symptom and passed at the candidate`);
}

export function regressionEvidence({ repo, tests, command, symptom, select = /./, base = 'HEAD', candidate = null,
  prepare = null, timeoutMs = 300_000, env = process.env }: {
  repo: string; tests: string[]; command: string[]; symptom: RegExp; select?: RegExp; base?: string;
  candidate?: string | null; prepare?: string[] | null; timeoutMs?: number; env?: NodeJS.ProcessEnv;
}) {
  if (!tests?.length) throw new Error('Name the test files to freeze');
  const git = (cwd: string, ...args: string[]) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    return result.stdout;
  };
  const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
  const frozen = tests.map(file => {
    const bytes = fs.readFileSync(path.join(repo, file));
    return { file, bytes, sha256: sha256(bytes) };
  });

  const runAt = (revision: string | null): Run => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'regression-'));
    const cwd = revision ? path.join(scratch, 'tree') : repo;
    try {
      if (revision) {
        git(repo, 'worktree', 'add', '--detach', cwd, revision);
        for (const { file, bytes } of frozen) {
          fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
          fs.writeFileSync(path.join(cwd, file), bytes);
        }
      }
      if (prepare) {
        const ready = spawnSync(prepare[0], prepare.slice(1), { cwd, env, encoding: 'utf8', timeout: timeoutMs });
        if (ready.status !== 0) throw new Error(`${prepare.join(' ')} failed at ${revision ?? 'the working tree'}: ${ready.stderr}`);
      }
      const tracked = () => sha256(git(cwd, 'diff', 'HEAD'));
      const before = tracked();
      const report = path.join(scratch, 'junit.xml');
      const [program, ...args] = command.map(part => part.replaceAll('{report}', report));
      const result = spawnSync(program, args, { cwd, env: { ...env, PLAYWRIGHT_JUNIT_OUTPUT_FILE: report }, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1 << 28 });
      const changed = frozen.filter(({ file, sha256: expected }) => !fs.existsSync(path.join(cwd, file))
        || sha256(fs.readFileSync(path.join(cwd, file))) !== expected).map(({ file }) => file);
      if (tracked() !== before) changed.push('a tracked file');
      return {
        revision: `${git(cwd, 'rev-parse', 'HEAD').trim()}${revision ? '' : ' + working tree'}`,
        exitCode: result.status,
        timedOut: (result.error as NodeJS.ErrnoException)?.code === 'ETIMEDOUT',
        tests: fs.existsSync(report) ? readJUnit(fs.readFileSync(report, 'utf8')) : null,
        output: `${result.stdout ?? ''}${result.stderr ?? ''}`.slice(-4000),
        changed,
      };
    } finally {
      if (revision && fs.existsSync(cwd)) git(repo, 'worktree', 'remove', '--force', cwd);
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  };

  const observed = { base: runAt(base), candidate: runAt(candidate) };
  return {
    ...regressionVerdict(observed.base, observed.candidate, { symptom, select }),
    frozen: frozen.map(({ file, sha256: hash }) => ({ file, sha256: hash })),
    ...observed,
  };
}
```

### Using it

The usual case: the fix and its test are in the working tree, uncommitted, and `HEAD` still
has the bug.

```js
const evidence = regressionEvidence({
  repo: process.cwd(),
  tests: ['tests/order-total.test.mjs'],            // frozen, and copied onto the base
  command: ['node', '--test', '--test-reporter=junit', '--test-reporter-destination={report}', 'tests/*.test.mjs'],
  symptom: /0\.30000000000000004/,                 // the wrong value from the bug report
  select: /order total/,                            // the regression test, not the whole suite
});
assert.equal(evidence.verdict, 'distinguishes', evidence.reason);
```

- `base` is any revision that has the bug: `HEAD` by default, the parent of the fix commit,
  or the commit `git bisect` named. `candidate` is a revision, or `null` for the working tree.
- `{report}` is replaced with a path outside the tree. pytest: `--junitxml={report}`.
  Vitest: `--reporter=junit --outputFile={report}`. Playwright takes the path from
  `PLAYWRIGHT_JUNIT_OUTPUT_FILE`, which the helper sets to the same file; pass
  `--reporter=junit`.
- `select` is needed on any real test file. With the default, every test in the command has
  to fail at the base, and an old test, a skipped test or two tests with one name end the
  check as `does_not_distinguish` or `inconclusive`.
- `prepare` runs in each tree before the tests, for example `['npm', 'ci']`. A worktree has
  no `node_modules`, and the base may need other dependencies than the candidate. With
  `candidate: null` it also runs in your working tree, so it must be safe to run twice
  (`[ -e node_modules ] || ln -s …`, not a bare `ln -s`). The script's `--prepare` runs in
  worktrees only.
- Let `command` run more than the selected test when the suite is fast. Tests outside
  `select` are compared too, and one that passed at the base and fails at the candidate
  turns the verdict into `breaks_other_tests`.
- List in `tests` only files that are tests or test data. Anything listed is copied onto the
  base, so a source file in the list carries the fix with it and the result is
  `does_not_distinguish`. The returned `frozen` list with hashes goes into the ticket.

## What `distinguishes` and `shows_the_bug` mean

The frozen test separates these two revisions, for this symptom, on this machine. Write that
in the ticket with both commit hashes and the hashes of the test files.

It does not show that the fix is correct or complete. Other inputs that trigger the same
defect are untested, and a fix that special-cases the test's input gets the same verdict.
If the bug has more than one known trigger, write a test for each. A single run also says
nothing about flakiness; repeat it as Step 6 asks before closing.

## Gotchas

- **The symptom has to come from the report, not from the first red run.** Copying whatever
  the test printed at the base into `symptom` makes the check circular.
- **A symptom of one word can match the wrong failure.** A report titled "the old
  `co_filename` is used" and a symptom of `/co_filename/` accepted
  `ImportError: cannot import name '_imp_fix_co_filename'` as the bug. Use the wrong value,
  the status code or the sentence the user saw. The script catches this case by itself;
  the function does not.
- **A pass at the base can be the machine.** Before reading `green_at_base` or
  `does_not_distinguish` as a weak test, check the runtime version the report names, the
  dependency versions of the base's date, and whether the fix is to types.
- **One base run is one sample.** A test can fail on the bug nine times in ten. The script
  repeats the base while a new test passes there; with the function, loop it yourself.
- **A buggy revision can damage more than its worktree.** Its tests may leave processes
  running, or files in the shared temp directory that the next run trips over. The script
  ends each run's process group. Files outside the worktree are yours to check when a later
  run fails for no visible reason. One old revision's network tests used up the kernel's
  socket buffers on macOS within seconds and the machine restarted; a timeout does not help
  once the kernel is stuck. Run the old revisions of a project you do not know in a
  container or a virtual machine.
- **Names must match between the runs.** Parameterized tests whose titles contain the data,
  or a test file that fails to load at the base and reports under the file's name, give
  `inconclusive` with both name lists. Fix the test so it loads at the base.
- **Worktrees share the repository, not ignored files.** Local `.env` files, built assets and
  databases are missing at the base. Create them in `prepare`.
- **`tampered` covers tracked files and the frozen tests.** A test that edits an untracked
  or ignored file is not seen.
- **The timeout stops the command's own process.** A runner that forks workers needs its own
  per-test timeout as well, or the workers outlive the run.
- **JUnit dialects differ.** `readJUnit` reads `<failure>` and `<error>` as failed and
  `<skipped>` as skipped. It was run against the output of `node --test`, Playwright and
  pytest. A reporter that marks a retried flaky test only in properties is read as failed.
