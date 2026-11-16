// Summarises trial.jsonl against the survey's reading of each commit.
// usage: node trial-summary.mjs trial.jsonl [--detail]
import fs from 'node:fs';

const [file, detail] = process.argv.slice(2);
const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const count = (items, key) => items.reduce((table, item) => { const k = key(item); table[k] = (table[k] ?? 0) + 1; return table; }, {});
const outcome = row => row.verdict ?? (row.notRun ? 'not_run' : 'error');

console.log(`${rows.length} commits, ${rows.reduce((sum, row) => sum + row.seconds, 0)} s`);
console.log('verdicts', count(rows, outcome));
console.log('survey -> trial');
for (const [key, n] of Object.entries(count(rows, row => `${row.survey} -> ${outcome(row)}`)).sort()) console.log(`  ${String(n).padStart(4)}  ${key}`);
// trial.jsonl keeps three rows of a status per commit and the full numbers in counts.
const counts = row => row.counts ?? count(row.tests ?? [], test => test.status);
const perTest = rows.reduce((table, row) => { for (const [status, n] of Object.entries(counts(row))) table[status] = (table[status] ?? 0) + n; return table; }, {});
console.log(`per test (${Object.values(perTest).reduce((sum, n) => sum + n, 0)})`, perTest);
console.log('commits with at least one', count(rows.flatMap(row => Object.keys(counts(row))), status => status));
console.log('base runs', count(rows.filter(row => row.baseRuns), row => row.baseRuns));
console.log('timed out', rows.filter(row => /timed out/.test(row.reason ?? row.error ?? '')).map(row => `${row.repo} ${row.commit.slice(0, 10)}`).join(', ') || 'none');

const expected = { red_then_green: ['red_then_green'], inconclusive: ['inconclusive'], no_behaviour_change: ['no_test_shows_the_bug'],
  red_in_other_environment: ['no_test_shows_the_bug'], red_for_another_reason: ['no_test_shows_the_bug'] };
const odd = rows.filter(row => !(expected[row.survey] ?? []).includes(outcome(row)));
console.log(`\n${odd.length} to read:`);
for (const row of odd) {
  console.log(`${row.repo} ${row.commit.slice(0, 10)} ${row.environment ? '[dated] ' : ''}${row.survey} -> ${outcome(row)} | ${row.summary ?? ''} | ${(row.reason ?? row.error ?? row.notRun ?? '').replace(/\s+/g, ' ').slice(0, 260)}`);
  if (detail) for (const test of (row.tests ?? []).filter(test => !['red_then_green'].includes(test.status)).slice(0, 6)) console.log(`    ${test.status} ${test.missing ? `needs ${test.missing} ` : ''}${test.name.slice(0, 90)} | ${test.message.replace(/\s+/g, ' ').slice(0, 140)}`);
}
