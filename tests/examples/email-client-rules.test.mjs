import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadFunctions, repository } from './snippets.mjs';

const reference = 'skills/email-testing/references/client-compatibility.md';
const { EMAIL_CLIENT_RULES, TRACKED } = loadFunctions(reference, 'function lintEmailHtml(',
  ['EMAIL_CLIENT_RULES', 'TRACKED']);
// Written by scripts/refresh-caniemail-snapshot.mjs from caniemail.com (MIT).
const snapshot = JSON.parse(fs.readFileSync(path.join(repository, 'tests/examples/fixtures/caniemail-snapshot.json'), 'utf8'));
const sourced = EMAIL_CLIENT_RULES.filter(rule => rule.feature);

// What the snapshot says the rule's client list should be.
function recorded(rule) {
  const { results } = snapshot.features[rule.feature];
  return TRACKED.filter(client => {
    const { result } = results[client];
    return rule.note ? new RegExp(`#${rule.note}\\b`).test(result) : result.startsWith('n');
  });
}

test('every compatibility rule lists exactly the clients the snapshot records', () => {
  assert.ok(sourced.length >= 15, `only ${sourced.length} sourced rules were loaded`);
  for (const rule of sourced) {
    assert.ok(snapshot.features[rule.feature], `${rule.feature} is missing from the snapshot; refresh it`);
    assert.deepEqual([...rule.clients].sort(), recorded(rule).sort(), `${rule.id ?? rule.feature} client list`);
    assert.ok(rule.clients.length, `${rule.id ?? rule.feature} names no client`);
  }
});

test('a rule tied to a footnote cites one the feature has', () => {
  const noted = sourced.filter(rule => rule.note);
  assert.ok(noted.length, 'no footnote rule was loaded');
  for (const rule of noted) assert.ok(snapshot.features[rule.feature].notes[rule.note], `${rule.id}: no footnote #${rule.note}`);
});

test('a wrong client list is detected, in both directions', () => {
  const flex = sourced.find(rule => rule.feature === 'css-display-flex');
  assert.deepEqual(recorded(flex), ['outlook.windows']);
  // Gmail on the web supports display:flex, so a rule claiming otherwise must not match the record.
  assert.notDeepEqual([...flex.clients, 'gmail.desktop-webmail'].sort(), recorded(flex).sort());
  const position = sourced.find(rule => rule.feature === 'css-position');
  assert.notDeepEqual(['outlook.windows'], recorded(position).sort());
});

test('finding ids are unique and every tracked client is in the snapshot', () => {
  const ids = EMAIL_CLIENT_RULES.map(rule => rule.id ?? rule.feature);
  assert.equal(new Set(ids).size, ids.length, `duplicate id in ${ids}`);
  assert.deepEqual(snapshot.clients, TRACKED);
  for (const rule of EMAIL_CLIENT_RULES) {
    for (const client of rule.clients) assert.ok(TRACKED.includes(client), `${client} is not tracked`);
  }
});

test('the reference states the date of the data its rules were checked against', () => {
  const date = snapshot.last_update_date.slice(0, 10);
  const text = fs.readFileSync(path.join(repository, reference), 'utf8');
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(text.split(date).length - 1 >= 3, `the reference should name ${date} in its table, its rules and its report wording`);
});
