// Classifies survey records. usage: node analyze.mjs [--detail category] [repo ...]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(process.env.REAL_RUNS_DIR ?? 'real-runs');   // holds repos/, venvs/ and out/
const args = process.argv.slice(2).filter(arg => arg !== '--second');
if (args.includes('--export')) args.splice(args.indexOf('--export'), 2);
const detail = args.includes('--detail') ? args.splice(args.indexOf('--detail'), 2)[1] : null;
const repos = args.length ? args : fs.readdirSync(path.join(ROOT, 'out')).filter(file => file.endsWith('.jsonl') && !/\.(dated|second)\.jsonl$/.test(file)).map(file => file.replace('.jsonl', ''));

// A failure that says the test reached for something the base does not have.
const MISSING_API = /is not a function|is not defined|is not a constructor|Cannot find module|does not provide an export|has no attribute|ImportError|ModuleNotFoundError|cannot import name|unexpected keyword argument|fixture '[^']*' not found|NameError|Cannot read properties of undefined/;

const keyed = tests => {
  const seen = new Map(), rows = new Map();
  for (const test of tests) {
    const count = seen.get(test.name) ?? 0;
    seen.set(test.name, count + 1);
    rows.set(`${test.name}#${count}`, test);
  }
  return rows;
};

const FIX = /\bfix(es|ed)?\b/i;
// A merge commit counts as a fix when the pull request's own title says so, not a commit inside it.
function titledFix(record) {
  if (!record.merge) return true;
  const text = spawnSync('git', ['log', '-1', '--format=%s%n%b', record.sha], { cwd: path.join(ROOT, 'repos', record.repo), encoding: 'utf8' }).stdout;
  const [subject, ...body] = text.split('\n');
  return FIX.test(subject) || FIX.test(body.find(line => line.trim()) ?? '');
}

export function classify(record) {
  if (!titledFix(record)) return { category: 'not_titled_fix' };
  if (record.skipped) return { category: 'skipped_wide' };
  if (record.error) return { category: 'inconclusive', why: `error: ${record.error.split('\n')[0].slice(0, 120)}` };
  const { native, base, candidate } = record;
  if (base.changed?.length || candidate.changed?.length) return { category: 'inconclusive', why: 'tampered: a tracked file changed during the run' };
  if (candidate.timedOut || !candidate.tests) return { category: 'inconclusive', why: `candidate: ${candidate.timedOut ? 'timed out' : 'no report'}` };
  if (base.timedOut) return { category: 'inconclusive', why: 'base: timed out' };
  if (!base.tests) return { category: 'inconclusive', why: 'base: no report' };
  if (!native.tests) return { category: 'inconclusive', why: 'parent with its own tests: no report' };
  if (!candidate.tests.length) return { category: 'inconclusive', why: 'candidate: no tests ran' };
  const before = keyed(native.tests), atBase = keyed(base.tests), atCandidate = keyed(candidate.tests);
  const rows = [...atCandidate].map(([key, test]) => ({ key, name: test.name, added: !before.has(key), base: atBase.get(key)?.status ?? 'absent',
    candidate: test.status, message: atBase.get(key)?.message ?? '' }));
  const added = rows.filter(row => row.added && row.candidate !== 'skipped');
  const redGreen = rows.filter(row => row.base === 'failed' && row.candidate === 'passed');
  const result = { added: added.length, total: rows.length, redGreen: redGreen.length,
    addedRed: added.filter(row => row.base === 'failed' && row.candidate === 'passed'),
    addedGreen: added.filter(row => row.base === 'passed' && row.candidate === 'passed'),
    addedAbsent: added.filter(row => row.base === 'absent'),
    candidateRed: rows.filter(row => row.candidate === 'failed'),
    modifiedRed: redGreen.filter(row => !row.added) };
  result.missingApi = redGreen.filter(row => MISSING_API.test(row.message)).length;
  const baseOnly = [...atBase].filter(([key, test]) => !atCandidate.has(key) && test.status === 'failed').map(([, test]) => test);
  result.baseOnly = baseOnly;
  if (result.candidateRed.length) return { ...result, category: 'inconclusive', why: `candidate: ${result.candidateRed.length} test(s) fail on this machine at the fix commit` };
  if (redGreen.length) {
    const wrong = result.missingApi === redGreen.length;
    if (!added.length) return { ...result, category: wrong ? 'red_missing_api' : 'red_modified_test' };
    if (!result.addedRed.length) return { ...result, category: wrong ? 'red_missing_api' : 'red_modified_test' };
    return { ...result, category: wrong ? 'red_missing_api' : result.addedGreen.length ? 'red_some_added' : 'red_all_added' };
  }
  if (result.addedAbsent.length || baseOnly.length) return { ...result, category: 'base_did_not_load', why: baseOnly[0]?.message.split('\n')[0].slice(0, 160) };
  return { ...result, category: added.length ? 'never_red_new_tests' : 'never_red_no_new_names' };
}

const all = [];
for (const repo of repos) {
  const file = path.join(ROOT, 'out', `${repo}.jsonl`);
  if (!fs.existsSync(file)) continue;
  // A re-run with dependencies as of the commit's date replaces the first run of that commit.
  const dated = new Map((fs.existsSync(file.replace('.jsonl', '.dated.jsonl')) ? fs.readFileSync(file.replace('.jsonl', '.dated.jsonl'), 'utf8') : '')
    .split('\n').filter(Boolean).map(line => JSON.parse(line)).map(record => [record.sha, record]));
  for (const line of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    const first = JSON.parse(line), record = dated.get(first.sha) ?? first;
    all.push({ record, ...classify(record) });
  }
}
const order = ['red_all_added', 'red_some_added', 'red_modified_test', 'red_missing_api', 'base_did_not_load', 'never_red_new_tests', 'never_red_no_new_names', 'inconclusive', 'skipped_wide', 'not_titled_fix'];
const table = rows => order.map(category => `${category}=${rows.filter(row => row.category === category).length}`).filter(cell => !cell.endsWith('=0')).join('  ');
for (const repo of repos) {
  const rows = all.filter(row => row.record.repo === repo);
  if (!rows.length) continue;
  console.log(`${repo.padEnd(9)} n=${String(rows.length).padEnd(3)} ${table(rows)}`);
  const agent = rows.filter(row => row.record.agent);
  if (agent.length) console.log(`${''.padEnd(9)} agent n=${agent.length}: ${table(agent)}`);
}
console.log(`${'ALL'.padEnd(9)} n=${String(all.length).padEnd(3)} ${table(all)}`);
console.log(`${'  agent'.padEnd(9)} n=${String(all.filter(row => row.record.agent).length).padEnd(3)} ${table(all.filter(row => row.record.agent))}`);
console.log(`${'  other'.padEnd(9)} n=${String(all.filter(row => !row.record.agent).length).padEnd(3)} ${table(all.filter(row => !row.record.agent))}`);

if (detail) {
  for (const row of all.filter(entry => detail === 'all' || entry.category === detail)) {
    const { record } = row;
    console.log(`\n${record.repo} ${record.sha.slice(0, 10)} ${record.date} ${record.agent ? '[agent] ' : ''}${record.title.slice(0, 110)}`);
    console.log(`  ${row.category}${row.why ? ` (${row.why})` : ''} | tests ${row.total ?? '-'} added ${row.added ?? '-'} red→green ${row.redGreen ?? '-'} | ${record.runnable.join(', ')}`);
    for (const test of (row.addedGreen ?? []).slice(0, 6)) console.log(`  green at base: ${test.name.slice(0, 150)}`);
    for (const test of [...(row.addedRed ?? []), ...(row.modifiedRed ?? [])].slice(0, 3)) console.log(`  red at base: ${test.name.slice(0, 90)} :: ${test.message.split('\n')[0].slice(0, 140)}`);
    if (row.category === 'inconclusive' && (record.base?.output || record.candidate?.output)) console.log(`  output: ${(record.candidate?.output ?? record.base?.output).trim().split('\n').slice(-3).join(' / ').slice(0, 300)}`);
  }
}

// Final table: the automatic category, replaced by the manual reading where one exists.
const review = JSON.parse(fs.readFileSync(path.join(ROOT, 'out', 'review.json'), 'utf8'));
const final = all.map(row => {
  const manual = Object.entries(review).find(([sha]) => row.record.sha.startsWith(sha))?.[1];
  const category = manual ? manual[0] : row.category.startsWith('red_') ? 'red_then_green' : row.category;
  return { ...row, final: category };
});
const counted = final.filter(row => !['not_titled_fix', 'skipped_wide'].includes(row.final));
const tally = rows => Object.entries(Object.groupBy(rows, row => row.final)).sort((a, b) => b[1].length - a[1].length).map(([key, list]) => `${key}=${list.length}`).join('  ');
console.log(`\nFINAL  evaluated=${counted.length} (of ${final.length}; ${final.length - counted.length} set aside)`);
console.log(`  all:   ${tally(counted)}`);
console.log(`  agent: n=${counted.filter(row => row.record.agent).length}  ${tally(counted.filter(row => row.record.agent))}`);
console.log(`  other: n=${counted.filter(row => !row.record.agent).length}  ${tally(counted.filter(row => !row.record.agent))}`);
for (const repo of repos) { const rows = counted.filter(row => row.record.repo === repo); if (rows.length) console.log(`  ${repo.padEnd(8)} n=${String(rows.length).padEnd(3)} ${tally(rows)}`); }
const red = counted.filter(row => row.final === 'red_then_green');
const sum = (rows, pick) => rows.reduce((total, row) => total + (pick(row) ?? 0), 0);
console.log(`  new tests in the ${red.length} red-then-green commits: ${sum(red, row => row.added)} added, ${sum(red, row => row.addedRed?.length)} fail at the parent, ${sum(red, row => row.addedGreen?.length)} pass at the parent; ${red.filter(row => row.addedGreen?.length).length} commits have at least one new test that passes at the parent`);
console.log(`  dated environments used: ${final.filter(row => row.record.environment).length}`);

// --second: how often the repeat pass of a repository gave the same automatic category.
if (process.argv.includes('--second')) {
  for (const repo of repos) {
    const file = path.join(ROOT, 'out', `${repo}.second.jsonl`);
    if (!fs.existsSync(file)) continue;
    const first = new Map(fs.readFileSync(path.join(ROOT, 'out', `${repo}.jsonl`), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).map(record => [record.sha, classify(record)]));
    const again = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
    const simple = category => category.startsWith('red_') && category !== 'red_missing_api' ? 'red' : category;
    const differ = again.filter(record => simple(first.get(record.sha).category) !== simple(classify(record).category));
    console.log(`${repo}: second pass ${again.length} commits, same result ${again.length - differ.length}, different ${differ.length}`);
    for (const record of differ) console.log(`  ${record.sha.slice(0, 10)} ${first.get(record.sha).category} (${first.get(record.sha).why ?? ''}) -> ${classify(record).category} (${classify(record).why ?? ''}) | ${record.title.slice(0, 70)}`);
  }
}
// --export file: one compact row per commit.
if (process.argv.includes('--export')) {
  const target = process.argv[process.argv.indexOf('--export') + 1];
  fs.writeFileSync(target, `${JSON.stringify(final.map(row => ({ repo: row.record.repo, commit: row.record.sha, date: row.record.date, title: row.record.title.split(' | ')[0],
    agentCoAuthored: row.record.agent, tests: row.record.runnable, result: row.final, automatic: row.category, why: row.why,
    note: Object.entries(review).find(([sha]) => row.record.sha.startsWith(sha))?.[1][1], environment: row.record.environment,
    newTests: row.added, newTestsRedAtParent: row.addedRed?.length, newTestsGreenAtParent: row.addedGreen?.length })), null, 1)}\n`);
}
