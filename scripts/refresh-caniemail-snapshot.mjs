#!/usr/bin/env node
// Rewrites tests/examples/fixtures/caniemail-snapshot.json: the latest Can I email result
// for each feature and client the email client-compatibility rules name.
// Needs the network unless --from <data.json> is given, so CI does not run it.
// After a refresh, tests/examples/email-client-rules.test.mjs says which rules drifted.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadFunctions, repository } from '../tests/examples/snippets.mjs';

const SOURCE = 'https://www.caniemail.com/api/data.json';
const reference = 'skills/email-testing/references/client-compatibility.md';
const target = path.join(repository, 'tests/examples/fixtures/caniemail-snapshot.json');

const { EMAIL_CLIENT_RULES, TRACKED } = loadFunctions(reference, 'function lintEmailHtml(',
  ['EMAIL_CLIENT_RULES', 'TRACKED']);

const from = process.argv.indexOf('--from');
let text;
if (from > -1) {
  text = readFileSync(process.argv[from + 1], 'utf8');
} else {
  const response = await fetch(SOURCE, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${SOURCE} returned HTTP ${response.status}`);
  text = await response.text();
}
const data = JSON.parse(text);

const features = {};
for (const slug of [...new Set(EMAIL_CLIENT_RULES.map(rule => rule.feature).filter(Boolean))].sort()) {
  const feature = data.data.find(candidate => candidate.slug === slug);
  if (!feature) throw new Error(`Can I email has no feature ${slug}`);
  const results = {};
  for (const client of TRACKED) {
    const [family, platform] = client.split('.');
    const versions = Object.entries(feature.stats[family]?.[platform] ?? {});
    if (!versions.length) throw new Error(`${slug} has no result for ${client}`);
    const [version, result] = versions.at(-1);
    results[client] = { version, result };
  }
  features[slug] = {
    title: feature.title,
    url: feature.url,
    last_test_date: feature.last_test_date,
    results,
    notes: feature.notes_by_num ?? {},
  };
}

writeFileSync(target, `${JSON.stringify({
  source: SOURCE,
  license: 'MIT, Copyright (c) 2019 Rémi Parmentier, https://github.com/hteumeuleu/caniemail',
  last_update_date: data.last_update_date,
  clients: TRACKED,
  features,
}, null, 2)}\n`);
console.log(`${Object.keys(features).length} features, data of ${data.last_update_date} -> ${path.relative(repository, target)}`);
