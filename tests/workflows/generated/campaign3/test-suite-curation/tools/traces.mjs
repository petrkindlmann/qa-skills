// Dynamic per-test execution profile for a black-box E2E suite: the set of HTTP requests
// (method, normalised path, status) each test made, read out of the Playwright trace of a
// `--trace on` run. The skill's coverage-fingerprinting.md wants per-test line coverage of
// the application; the applications here may not be instrumented or read, so the request
// set is the stand-in. It feeds the same uniquely-covered and subsumption computations.
//
//   node tools/traces.mjs <QA_WORKFLOW_OUTPUT of the trace run> <workdir>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const OUT = process.argv[2], WORK = process.argv[3];
const verbose = JSON.parse(fs.readFileSync(path.join(OUT, 'verbose.json'), 'utf8'));

const tests = [];
function walk(s, file) {
  for (const sp of s.specs || []) for (const t of sp.tests || []) for (const r of t.results || []) {
    tests.push({ id: `${s.file || file}:${sp.line} ${sp.title}`, file: s.file || file, line: sp.line, title: sp.title, status: r.status, duration: r.duration, trace: (r.attachments || []).find(a => a.name === 'trace')?.path ?? null });
  }
  for (const c of s.suites || []) walk(c, s.file || file);
}
for (const s of verbose.suites) walk(s, s.file);

const STATIC = /\.(css|js|mjs|png|ico|svg|woff2?|map|json)$/;
function normalise(method, rawUrl, status) {
  const u = new URL(rawUrl);
  let p = u.pathname;
  const mailpit = /\/api\/v1\//.test(p);
  p = p.replace(/\/api\/orders\/(?!unknown$|missing$|does-not-exist$)[^/]+$/, '/api/orders/:id')
    .replace(/\/api\/orders\/(unknown|missing|does-not-exist)$/, '/api/orders/:absent')
    .replace(/\/api\/v1\/message\/[^/]+$/, '/api/v1/message/:id');
  if (p === '/reset-password') p += u.searchParams.has('token') ? '?token' : '';
  return `${mailpit ? 'mailpit ' : ''}${method} ${p} ${status}`;
}

const out = [];
for (const t of tests) {
  if (!t.trace || !fs.existsSync(t.trace)) { out.push({ ...t, requests: [], note: 'no trace' }); continue; }
  const names = execFileSync('unzip', ['-Z1', t.trace], { encoding: 'utf8' }).split('\n').filter(n => n.endsWith('.network'));
  const set = new Set(); let total = 0;
  for (const name of names) {
    const text = execFileSync('unzip', ['-p', t.trace, name], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.type !== 'resource-snapshot') continue;
      const req = e.snapshot?.request, res = e.snapshot?.response;
      if (!req?.url || !res) continue;
      total++;
      const u = new URL(req.url);
      if (STATIC.test(u.pathname) && !/\/api\//.test(u.pathname)) continue;
      set.add(normalise(req.method, req.url, res.status));
    }
  }
  out.push({ ...t, requests: [...set].sort(), totalRequests: total, networkFiles: names.length });
}

// Uniquely covered request keys and subsumption candidates (coverage-fingerprinting.md, adapted).
const owners = new Map();
for (const t of out) for (const k of t.requests) owners.set(k, (owners.get(k) || 0) + 1);
for (const t of out) t.unique = t.requests.filter(k => owners.get(k) === 1);
const subsumed = [];
for (const b of out) {
  if (!b.requests.length) continue;
  const sb = new Set(b.requests);
  for (const a of out) {
    if (a === b || a.requests.length <= b.requests.length) continue;
    const sa = new Set(a.requests);
    if ([...sb].every(k => sa.has(k))) subsumed.push({ candidate: b.id, superset: a.id, extra: a.requests.length - b.requests.length });
  }
}
const byCandidate = {};
for (const s of subsumed) (byCandidate[s.candidate] ??= []).push(s.superset);

fs.writeFileSync(path.join(WORK, 'fingerprints.json'), JSON.stringify({ tests: out, subsumption: byCandidate }, null, 1));

const md = ['# Dynamic request fingerprints (from --trace on)\n', `${out.length} tests, ${out.filter(t => t.requests.length).length} with a request set, ${out.filter(t => t.note).length} without a trace.\n`, '## Per test: request-set size, uniquely-made requests, duration\n', '| test | requests | unique to this test | subsumed by (request-set superset) | ms |', '|---|---|---|---|---|'];
for (const t of out) md.push(`| ${t.id} | ${t.requests.length} | ${t.unique.join('; ') || '-'} | ${(byCandidate[t.id] || []).length ? (byCandidate[t.id] || []).map(x => x.split(' ')[0]).join(', ') : '-'} | ${t.duration} |`);
md.push('\n## Request keys made by exactly one test (load-bearing tests)\n');
for (const t of out) if (t.unique.length) md.push(`- ${t.id}: ${t.unique.join('; ')}`);
fs.writeFileSync(path.join(WORK, 'fingerprints.md'), md.join('\n'));
console.log(`tests ${out.length}; with requests ${out.filter(t => t.requests.length).length}; distinct request keys ${owners.size}; subsumption candidate pairs ${subsumed.length}; candidates ${Object.keys(byCandidate).length}`);
