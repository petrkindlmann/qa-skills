// Corpus analysis for the test-suite-curation run (SKILL.md §1 fingerprint, §3 clustering,
// plus the weak-assertion and orphan-helper scans the task asked for).
//
//   node tests/workflows/generated/campaign3/test-suite-curation/tools/analyze.mjs <workdir>
//
// <workdir> holds inventory-rows.json (from `playwright test --list --reporter=json`) and
// receives analysis.json, clusters.md, weak.md, orphans.md.
//
// Deviations from the skill's references, all recorded in final-response.md:
//   - clustering.md parses with Python `ast` and says "for JS/TS use @babel/parser or ts-morph".
//     Neither is resolvable from the repo root and no dependency may be added, so this file
//     tokenises the test body with a small hand-written lexer and normalises tokens the way the
//     reference's Normalizer does (identifiers -> VAR, literals -> CONST, keywords kept).
//   - coverage-fingerprinting.md needs per-test line coverage of the application. The
//     applications are black boxes here (fixture-app/ and upstream-todomvc/ are off limits and
//     must not be instrumented), so the "execution profile" is a static behaviour fingerprint:
//     API paths, UI targets, actions and matchers named by the test body and by every helper
//     function it calls (helpers inlined transitively).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/Users/petr/projects/qa-skills/tests/workflows/generated';
const WORK = process.argv[2];
if (!WORK) throw new Error('usage: analyze.mjs <workdir>');
const rows = JSON.parse(fs.readFileSync(path.join(WORK, 'inventory-rows.json'), 'utf8'));

// ---------------------------------------------------------------- lexer
const KEYWORDS = new Set('await async const let var for of in if else return function new try catch finally throw typeof class this true false null undefined while do switch case break continue import export from default delete void instanceof yield extends static get set'.split(' '));

function tokenize(src) {
  const toks = []; let i = 0; const n = src.length;
  const push = (t, v, at) => toks.push({ t, v, at });
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '"' || c === "'") { let j = i + 1; while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; } push('str', src.slice(i + 1, j), i); i = j + 1; continue; }
    if (c === '`') {
      let j = i + 1, depth = 0;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (depth === 0 && src[j] === '`') break;
        if (src[j] === '$' && src[j + 1] === '{') { depth++; j += 2; continue; }
        if (depth > 0 && src[j] === '}') depth--;
        j++;
      }
      push('str', src.slice(i + 1, j), i); i = j + 1; continue;
    }
    if (/[0-9]/.test(c)) { let j = i; while (j < n && /[0-9_.xa-fA-F]/.test(src[j])) j++; push('num', src.slice(i, j), i); i = j; continue; }
    if (/[A-Za-z_$]/.test(c)) { let j = i; while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++; const v = src.slice(i, j); push(KEYWORDS.has(v) ? 'kw' : 'id', v, i); i = j; continue; }
    if (c === '/') {
      const prev = toks[toks.length - 1];
      const canRegex = !prev || (prev.t === 'p' && /^(\(|,|=|:|\[|!|&&|\|\||\?|\{|\}|;|=>|\?\?)$/.test(prev.v)) || prev.t === 'kw';
      if (canRegex) {
        let j = i + 1, inClass = false;
        while (j < n) {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '[') inClass = true; else if (src[j] === ']') inClass = false;
          else if (src[j] === '/' && !inClass) break; else if (src[j] === '\n') break;
          j++;
        }
        j++; while (j < n && /[gimsuy]/.test(src[j])) j++;
        push('re', src.slice(i, j), i); i = j; continue;
      }
    }
    const m = src.slice(i, i + 3).match(/^(===|!==|=>|\.\.\.|&&|\|\||\?\?|\?\.|\+=|-=|[-+*/%=<>!&|^~?:;,.(){}[\]])/);
    if (m) { push('p', m[1], i); i += m[1].length; continue; }
    i++;
  }
  return toks;
}

// Brace-match from the token index of an opening '{'; returns the index of its '}'.
function matchBrace(toks, open) {
  let depth = 0;
  for (let k = open; k < toks.length; k++) {
    if (toks[k].t !== 'p') continue;
    if (toks[k].v === '{') depth++;
    else if (toks[k].v === '}') { depth--; if (depth === 0) return k; }
  }
  return toks.length - 1;
}

// ---------------------------------------------------------------- helper function index
// name -> { file, toks } for every function-like definition in a helper module.
function indexFunctions(file) {
  const src = fs.readFileSync(file, 'utf8');
  const toks = tokenize(src);
  const fns = {};
  const add = (name, bodyToks) => { if (!fns[name]) fns[name] = { file, toks: bodyToks }; };
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k], nx = toks[k + 1];
    // function name(...) {   |  async function name(...) {
    if (t.t === 'kw' && t.v === 'function' && nx?.t === 'id') {
      // Skip the parameter list first: `function f({ a, b }) {` has a brace before the body.
      let d = 0, q = k + 2, close = -1;
      for (; q < toks.length; q++) { const x = toks[q]; if (x.t === 'p' && x.v === '(') d++; else if (x.t === 'p' && x.v === ')') { d--; if (d === 0) { close = q; break; } } }
      const open = close > 0 && toks[close + 1]?.t === 'p' && toks[close + 1].v === '{' ? close + 1 : -1;
      if (open > 0) add(nx.v, toks.slice(open + 1, matchBrace(toks, open)));
      continue;
    }
    // name = (...) => ... | name = async (...) => ... | name = x => ...
    if (t.t === 'id' && nx?.t === 'p' && nx.v === '=') {
      let j = k + 2; if (toks[j]?.t === 'kw' && toks[j].v === 'async') j++;
      let arrow = -1;
      if (toks[j]?.t === 'p' && toks[j].v === '(') {
        let d = 0; for (let q = j; q < toks.length; q++) { if (toks[q].t === 'p' && toks[q].v === '(') d++; else if (toks[q].t === 'p' && toks[q].v === ')') { d--; if (d === 0) { if (toks[q + 1]?.v === '=>') arrow = q + 1; break; } } }
      } else if (toks[j]?.t === 'id' && toks[j + 1]?.v === '=>') arrow = j + 1;
      if (arrow > 0) {
        const b = toks[arrow + 1];
        if (b?.t === 'p' && b.v === '{') add(t.v, toks.slice(arrow + 2, matchBrace(toks, arrow + 1)));
        else { // expression body: up to ';' or '}' at depth 0
          let d = 0, q = arrow + 1;
          for (; q < toks.length; q++) { const x = toks[q]; if (x.t !== 'p') continue; if ('([{'.includes(x.v)) d++; else if (')]}'.includes(x.v)) { if (d === 0) break; d--; } else if (x.v === ';' && d === 0) break; }
          add(t.v, toks.slice(arrow + 1, q));
        }
      }
      continue;
    }
    // method shorthand: name(...) {   (object literal or class body), optionally preceded by async
    if (t.t === 'id' && nx?.t === 'p' && nx.v === '(') {
      let d = 0, q = k + 1, close = -1;
      for (; q < toks.length; q++) { const x = toks[q]; if (x.t === 'p' && x.v === '(') d++; else if (x.t === 'p' && x.v === ')') { d--; if (d === 0) { close = q; break; } } }
      const prev = toks[k - 1];
      const isCall = prev && ((prev.t === 'p' && /^(\.|\?\.|\(|,|=|=>|:|!|&&|\|\||\?|\[)$/.test(prev.v)) || prev.t === 'kw' && prev.v !== 'async' && prev.v !== 'static');
      if (close > 0 && toks[close + 1]?.t === 'p' && toks[close + 1].v === '{' && !isCall) {
        add(t.v, toks.slice(close + 2, matchBrace(toks, close + 1)));
      }
    }
  }
  return fns;
}

// import { a, b as c } from './x.mjs'  and  export { a, b } from './x.mjs'
function importMap(file) {
  const src = fs.readFileSync(file, 'utf8');
  const map = {}; // local name -> { file, name }
  const re = /(?:import|export)\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const target = path.resolve(path.dirname(file), m[2]);
    for (const part of m[1].split(',')) {
      const seg = part.trim(); if (!seg) continue;
      const [orig, local] = seg.split(/\s+as\s+/).map(s => s.trim());
      map[local || orig] = { file: target, name: orig };
    }
  }
  return map;
}

const fnIndexCache = {};
function functionsOf(file) {
  if (!fnIndexCache[file]) fnIndexCache[file] = fs.existsSync(file) ? indexFunctions(file) : {};
  return fnIndexCache[file];
}
const importCache = {};
function importsOf(file) {
  if (!importCache[file]) importCache[file] = fs.existsSync(file) ? importMap(file) : {};
  return importCache[file];
}

// Resolve a called name from a given file to a helper function body (following re-exports).
function resolveFn(file, name, seen = new Set()) {
  const key = `${file}::${name}`; if (seen.has(key)) return null; seen.add(key);
  if (file.includes('/support/')) return null; // off limits, never read
  const imp = importsOf(file)[name];
  if (imp) return resolveFn(imp.file, imp.name, seen) ?? (functionsOf(imp.file)[imp.name] ? { ...functionsOf(imp.file)[imp.name], name: imp.name } : null);
  const local = functionsOf(file)[name];
  return local ? { ...local, name } : null;
}

// Every helper module in the corpus (non-spec .mjs), for the method lookup of ui.add/app.edit.
const ALL_METHOD_FNS = {};
function allFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', 'test-suite-curation'].includes(e.name)) allFiles(p, out); }
    else if (/\.(mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}
const corpusFiles = allFiles(ROOT);
for (const f of corpusFiles) if (!f.endsWith('.spec.mjs')) for (const [name, fn] of Object.entries(functionsOf(f))) (ALL_METHOD_FNS[name] ??= []).push({ ...fn, name });

// ---------------------------------------------------------------- test bodies
function testBody(file, line) {
  const src = fs.readFileSync(file, 'utf8');
  const offset = src.split('\n').slice(0, line - 1).join('\n').length;
  const toks = tokenize(src);
  const start = toks.findIndex(t => t.at >= offset && t.t === 'id' && t.v === 'test');
  const arrow = toks.findIndex((t, i) => i > start && t.t === 'p' && t.v === '=>');
  const open = arrow + 1;
  if (toks[open]?.v !== '{') throw new Error(`no body for ${file}:${line}`);
  const close = matchBrace(toks, open);
  return { toks: toks.slice(open + 1, close), src: src.slice(toks[open].at, toks[close].at + 1) };
}

// Skill-faithful normalisation: identifiers -> VAR, literals -> CONST, keywords and punctuation kept.
const normalize = toks => toks.map(t => t.t === 'id' ? 'VAR' : (t.t === 'str' || t.t === 'num' || t.t === 're') ? 'CONST' : t.v);
// Adapted normalisation: member names after '.' are kept (they carry the oracle: toHaveText, check...).
const normalizeMembers = toks => toks.map((t, i) => t.t === 'id' ? (toks[i - 1]?.v === '.' ? t.v : 'VAR') : (t.t === 'str' || t.t === 'num' || t.t === 're') ? 'CONST' : t.v);

const shingles = (tokens, k = 3) => { const s = new Set(); for (let i = 0; i + k <= tokens.length; i++) s.add(tokens.slice(i, i + k).join(' ')); return s; };
const jaccard = (a, b) => { if (!a.size && !b.size) return 1; let inter = 0; for (const x of a) if (b.has(x)) inter++; return inter / (a.size + b.size - inter); };

// Behaviour fingerprint tokens from a token stream (body plus inlined helpers).
function profileTokens(toks) {
  const out = new Set();
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === 'str') {
      const s = t.v;
      for (const m of s.matchAll(/\/(?:api\/v1\/[a-z]+|api\/[a-z-]+(?:\/[^\s'"`]+)?|health|test-support\/[a-z]+|reset-password)/g)) out.add('path:' + m[0].replace(/\/\$\{[^}]*\}/g, '/:id').replace(/\/[A-Za-z0-9_.-]*(missing|unknown|does-not-exist)[^/]*/, '/:id'));
      if (/^(Sign in|Sign out|Place order|Refresh orders|Send reset link|Mark all as complete|Clear completed|All|Active|Completed|What needs to be done\?|Email|Password|Account email|New password|Your orders|Signed in\.|Signed out\.)$/.test(s)) out.add('ui:' + s);
      if (/^\d+ items? left$/.test(s)) out.add('ui:count');
      if (/^(invalid_credentials|too_many_attempts|unauthenticated|invalid_order|idempotency_conflict|not_found|invalid_signature|payment_mismatch|event_conflict|fulfillment_unavailable|invalid_or_expired_token|forbidden|internal_error)$/.test(s)) out.add('err:' + s);
      if (/^(pending|paid)$/.test(s)) out.add('status:' + s);
      if (/^(TEA-50|CUP-01)$/.test(s)) out.add('sku:' + s);
      if (/^(Reset your Shop password)$/.test(s)) out.add('mail:subject');
      continue;
    }
    if (t.t === 'num' && /^(200|201|202|204|400|401|403|404|409|422|429|500|503)$/.test(t.v)) out.add('http:' + t.v);
    if (t.t === 'id' && toks[i - 1]?.v === '.') {
      if (/^to[A-Z]/.test(t.v)) out.add('m:' + t.v);
      else if (/^(click|dblclick|check|uncheck|fill|press|type|hover|reload|goto|restart|post|get|delete|put|fetch|add|edit|remove|filter|allLabel|allCheckbox|clear|toggleAll|clearCompleted|stop|advance|dispose|evaluate|route|keyboard|screenshot|setTimeout|timed|budget|warn|note|receive|search|remove)$/.test(t.v)) out.add('a:' + t.v);
    }
    if (t.t === 'id' && toks[i + 1]?.v === '(' && /^(oracle)$/.test(t.v) && toks[i + 2]?.t === 'str') out.add('oracle:' + toks[i + 2].v);
    if (t.t === 'id' && /^(getByRole|getByLabel|getByText|getByPlaceholder)$/.test(t.v) && toks[i + 2]?.t === 'str') out.add(t.v + ':' + toks[i + 2].v);
    if (t.t === 'id' && t.v === 'locator' && toks[i + 2]?.t === 'str') out.add('css:' + toks[i + 2].v);
  }
  return out;
}

// Inline every helper the body calls (transitively) and return the expanded token stream.
function expand(file, bodyToks) {
  const seen = new Set(); const out = [...bodyToks]; const inlined = [];
  const queue = [{ file, toks: bodyToks }];
  while (queue.length) {
    const { file: f, toks } = queue.shift();
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]; if (t.t !== 'id' || toks[i + 1]?.v !== '(') continue;
      let fn = null;
      if (toks[i - 1]?.v === '.') { // method call: ui.add(...) -> any helper method named add
        const cands = ALL_METHOD_FNS[t.v];
        if (cands && cands.length) fn = cands.find(c => path.dirname(c.file) === path.dirname(f) || importsOf(f) && Object.values(importsOf(f)).some(im => im.file === c.file)) ?? null;
      } else fn = resolveFn(f, t.v);
      if (!fn) continue;
      const key = `${fn.file}::${fn.name}`; if (seen.has(key)) continue; seen.add(key);
      inlined.push(path.relative(ROOT, fn.file) + '::' + fn.name);
      out.push(...fn.toks); queue.push({ file: fn.file, toks: fn.toks });
    }
  }
  return { toks: out, inlined };
}

// Assertion metrics on a token stream.
function assertionMetrics(toks, src) {
  const m = { expects: 0, soft: 0, poll: 0, statusOnly: 0, weakMatchers: 0, strongMatchers: 0, warns: 0, ifs: 0, throws: 0 };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === 'id' && t.v === 'expect') { if (toks[i + 1]?.v === '(') m.expects++; else if (toks[i + 1]?.v === '.' && toks[i + 2]?.v === 'soft') m.soft++; else if (toks[i + 1]?.v === '.' && toks[i + 2]?.v === 'poll') m.poll++; }
    if (t.t === 'id' && toks[i - 1]?.v === '.' && /^to[A-Z]/.test(t.v)) {
      if (/^(toBeDefined|toBeTruthy|toBeFalsy|toBeUndefined|toBeNull|toBeInstanceOf)$/.test(t.v)) m.weakMatchers++; else m.strongMatchers++;
    }
    if (t.t === 'id' && t.v === 'warn' && toks[i - 1]?.v === '.') m.warns++;
    if (t.t === 'kw' && t.v === 'if') m.ifs++;
    if (t.t === 'kw' && t.v === 'throw') m.throws++;
  }
  m.statusOnly = (src.match(/expect\((?:await )?[^;\n]*?\.status\(\)[^;\n]*?\)\s*\.toBe\(\d+\)/g) || []).length;
  return m;
}

// ---------------------------------------------------------------- run over the inventory
const tests = [];
const bodyCache = {};
for (const r of rows) {
  const file = path.join(ROOT, r.file);
  const key = `${r.file}:${r.line}`;
  bodyCache[key] ??= testBody(file, r.line);
  const body = bodyCache[key];
  const ex = expand(file, body.toks);
  const suite = r.file.split('/').slice(0, r.file.startsWith('campaign3/') ? 2 : 1).join('/');
  const direct = assertionMetrics(body.toks, body.src);
  const expanded = assertionMetrics(ex.toks, body.src);
  const oracles = [...profileTokens(ex.toks)].filter(x => x.startsWith('oracle:')).map(x => x.slice(7));
  tests.push({
    id: `${r.file}:${r.line} ${r.title}`, file: r.file, line: r.line, title: r.title, suite,
    app: /todo|visual|migration|drift/.test(r.file) || /TodoMVC/.test(r.title) ? 'todo' : 'shop',
    sharesBodyWith: rows.filter(o => o.file === r.file && o.line === r.line && o.title !== r.title).map(o => o.title),
    bodyLines: body.src.split('\n').length, bodyTokens: body.toks.length, expandedTokens: ex.toks.length,
    inlined: ex.inlined, direct, expanded, oracles,
    _ast: shingles(normalize(body.toks)), _astM: shingles(normalizeMembers(body.toks)), _prof: profileTokens(ex.toks),
  });
}
// The accessibility/performance specs are Shop+Todo mixed; fix app by fixture names in the body.
for (const t of tests) { const s = bodyCache[`${t.file}:${t.line}`].src; const sig = fs.readFileSync(path.join(ROOT, t.file), 'utf8').split('\n')[t.line - 1]; t.app = /\btodo\b/.test(sig) ? 'todo' : /\bapp\b|clients|request|playwright/.test(sig) ? 'shop' : t.app; }

// Dynamic execution profile (HTTP request set read from the --trace on run), when present.
const fpPath = path.join(WORK, 'fingerprints.json');
const dyn = fs.existsSync(fpPath) ? JSON.parse(fs.readFileSync(fpPath, 'utf8')).tests : null;
for (const t of tests) { const d = dyn?.find(x => x.id === t.id); t._dyn = new Set(d?.requests ?? []); t.dynamicRequests = d ? d.requests.length : null; t.durationMs = d?.duration ?? null; }

// Pairwise similarities.
const n = tests.length;
const pairs = [];
for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
  const a = tests[i], b = tests[j];
  const ast = jaccard(a._ast, b._ast), astM = jaccard(a._astM, b._astM), prof = jaccard(a._prof, b._prof);
  const dynSim = dyn ? jaccard(a._dyn, b._dyn) : 0;
  pairs.push({ i, j, ast, astM, prof, dyn: dynSim, combined: 0.6 * ast + 0.4 * prof, combinedM: 0.6 * astM + 0.4 * prof, combinedDyn: 0.6 * ast + 0.4 * dynSim });
}

// Average-linkage agglomerative clustering, cut at 1 - threshold on distance.
function cluster(scoreKey, threshold) {
  const sim = Array.from({ length: n }, () => new Float64Array(n));
  for (const p of pairs) { sim[p.i][p.j] = sim[p.j][p.i] = p[scoreKey]; }
  let clusters = tests.map((_, i) => [i]);
  const avg = (A, B) => { let s = 0; for (const a of A) for (const b of B) s += sim[a][b]; return s / (A.length * B.length); };
  while (true) {
    let best = -1, bi = -1, bj = -1;
    for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) { const s = avg(clusters[i], clusters[j]); if (s > best) { best = s; bi = i; bj = j; } }
    if (best < threshold) break;
    clusters[bi] = [...clusters[bi], ...clusters[bj]]; clusters.splice(bj, 1);
  }
  return clusters.filter(c => c.length > 1).map(c => ({ members: c.map(i => tests[i].id), pairwise: c.flatMap((a, x) => c.slice(x + 1).map(b => ({ a: tests[a].id, b: tests[b].id, score: +sim[a][b].toFixed(3) }))) }));
}

const result = {
  counts: { tests: n, files: new Set(tests.map(t => t.file)).size, suites: new Set(tests.map(t => t.suite)).size },
  tests: tests.map(({ _ast, _astM, _prof, _dyn, ...t }) => ({ ...t, profile: [..._prof].sort() })),
  clusters: {
    ast085: cluster('ast', 0.85), ast070: cluster('ast', 0.70),
    combined085: cluster('combined', 0.85), combined070: cluster('combined', 0.70),
    combinedMembers085: cluster('combinedM', 0.85), combinedMembers070: cluster('combinedM', 0.70),
    ...(dyn ? { combinedDynamic085: cluster('combinedDyn', 0.85), combinedDynamic070: cluster('combinedDyn', 0.70), dynamicOnly090: cluster('dyn', 0.90) } : {}),
  },
  topPairs: pairs.map(p => ({ a: tests[p.i].id, b: tests[p.j].id, ast: +p.ast.toFixed(3), astMembers: +p.astM.toFixed(3), profile: +p.prof.toFixed(3), dynamic: +p.dyn.toFixed(3), combined: +p.combined.toFixed(3), combinedMembers: +p.combinedM.toFixed(3), combinedDynamic: +p.combinedDyn.toFixed(3) })).sort((x, y) => y.combinedMembers - x.combinedMembers).slice(0, 60),
};
fs.writeFileSync(path.join(WORK, 'analysis.json'), JSON.stringify(result, null, 1));

// ---------------------------------------------------------------- orphan helpers
const specFiles = corpusFiles.filter(f => f.endsWith('.spec.mjs'));
const helperFiles = corpusFiles.filter(f => !f.endsWith('.spec.mjs'));
const importedNames = {}; // file -> Set(names imported by anyone)
const importedFiles = new Set();
for (const f of corpusFiles) for (const [local, im] of Object.entries(importsOf(f))) { (importedNames[im.file] ??= new Set()).add(im.name); importedFiles.add(im.file); }
// bare side-effect / default imports and dynamic imports
for (const f of corpusFiles) for (const m of fs.readFileSync(f, 'utf8').matchAll(/import\s+(?:[\w$]+\s+from\s+)?['"]([^'"]+)['"]/g)) importedFiles.add(path.resolve(path.dirname(f), m[1]));
const orphanReport = [];
for (const h of helperFiles) {
  const src = fs.readFileSync(h, 'utf8');
  const exported = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([\w$]+)/g)) exported.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) for (const seg of m[1].split(',')) { const s = seg.trim(); if (s) exported.add(s.split(/\s+as\s+/).pop().trim()); }
  const used = importedNames[h] ?? new Set();
  const unused = [...exported].filter(e => !used.has(e));
  orphanReport.push({ file: path.relative(ROOT, h), importedByAnyone: importedFiles.has(h), exported: [...exported], unused });
}
fs.writeFileSync(path.join(WORK, 'orphans.json'), JSON.stringify(orphanReport, null, 1));

// ---------------------------------------------------------------- markdown summaries
const md = [];
md.push(`# Clusters (${n} tests)\n`);
for (const [k, cs] of Object.entries(result.clusters)) {
  md.push(`\n## ${k}: ${cs.length} clusters\n`);
  for (const c of cs) { md.push(`- ${c.members.length} members:`); for (const mbr of c.members) md.push(`  - ${mbr}`); for (const p of c.pairwise) md.push(`    - ${p.score}  ${p.a.split(' ')[0]} ~ ${p.b.split(' ')[0]}`); }
}
md.push('\n## Top 60 pairs by combined (member-preserving) score\n');
for (const p of result.topPairs) md.push(`- ${p.combinedMembers} (ast ${p.ast} / astM ${p.astMembers} / profile ${p.profile} / dynamic ${p.dynamic})  ${p.a}  ~  ${p.b}`);
fs.writeFileSync(path.join(WORK, 'clusters.md'), md.join('\n'));

const weak = ['# Assertion metrics per test (direct = test body; expanded = body + inlined helpers)\n', '| test | direct expects | expanded expects | soft | poll | status-only | weak matchers | strong matchers | warns | ifs | oracles | inlined helpers |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
for (const t of result.tests) weak.push(`| ${t.id} | ${t.direct.expects} | ${t.expanded.expects} | ${t.expanded.soft} | ${t.expanded.poll} | ${t.expanded.statusOnly} | ${t.expanded.weakMatchers} | ${t.expanded.strongMatchers} | ${t.expanded.warns} | ${t.direct.ifs} | ${t.oracles.join(', ')} | ${t.inlined.length} |`);
fs.writeFileSync(path.join(WORK, 'weak.md'), weak.join('\n'));

const orph = ['# Helper modules: exported names never imported\n'];
for (const o of orphanReport) orph.push(`- ${o.file} (imported by anyone: ${o.importedByAnyone}) exported ${o.exported.length}, unused: ${o.unused.join(', ') || 'none'}`);
fs.writeFileSync(path.join(WORK, 'orphans.md'), orph.join('\n'));

console.log(`tests ${n}, files ${result.counts.files}, suites ${result.counts.suites}`);
for (const [k, cs] of Object.entries(result.clusters)) console.log(`${k}: ${cs.length} clusters, ${cs.reduce((s, c) => s + c.members.length, 0)} tests`);
console.log('helper files', helperFiles.length, 'never imported:', orphanReport.filter(o => !o.importedByAnyone).map(o => o.file).join(', '));
