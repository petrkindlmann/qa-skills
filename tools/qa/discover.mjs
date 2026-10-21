import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { runBounded } from '../../tests/workflows/support/process.mjs';

async function readSmall(filename, limit = 1024 * 1024) {
  try {
    if ((await fs.stat(filename)).size > limit) throw new Error(`Project input exceeds ${limit} bytes: ${filename}`);
    return await fs.readFile(filename, 'utf8');
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function hash(data) { return data === null ? null : createHash('sha256').update(data).digest('hex'); }

// Lockfiles are provenance only; stream them so a large monorepo lock cannot block a run.
async function hashFile(filename) {
  const digest = createHash('sha256');
  try { for await (const chunk of createReadStream(filename)) digest.update(chunk); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  return digest.digest('hex');
}

const nodeTestPattern = /\bnode\b[^\n]*\s--test(?:\s|$|=)/;
export function isNodeTestScript(script) { return nodeTestPattern.test(script ?? ''); }

// The reporter a script, argument list or NODE_OPTIONS already declares; null when none.
export function declaredReporter(text) {
  const match = /--test-reporter(?:=|\s+)(\S+)/.exec(text ?? '');
  if (match) return match[1];
  return /--test-reporter(?:\s|$)/.test(text ?? '') ? '' : null;
}

export function discoverChecks(manifest = {}, packageManager = 'npm') {
  const script = manifest.scripts?.test;
  if (typeof script !== 'string' || !script.trim()) return [];
  const command = [packageManager, 'run', 'test'];
  // npm strips a leading `--` before forwarding; pnpm hands it to the script verbatim,
  // where test runners read it as end-of-options (checked with npm 11, pnpm 10, bun 1.3).
  const separator = packageManager === 'npm' ? ['--'] : [];
  let reporter = 'exit-code';
  if (isNodeTestScript(script)) {
    // The TAP reporter is injected only when the script declares none. A declared
    // non-TAP reporter cannot be overridden, so only its exit code can be observed.
    const declared = declaredReporter(script);
    reporter = declared === null || declared === 'tap' ? 'tap' : 'exit-code';
  }
  else if (/\bplaywright\s+test\b/.test(script)) { command.push(...separator, '--reporter=json'); reporter = 'playwright-json'; }
  else if (/\bvitest\b/.test(script) && !/\b(?:run|--run)\b/.test(script)) command.push(...separator, '--run');
  else if (/\bjest\b/.test(script)) command.push(...separator, '--runInBand', '--watch=false');
  return [{ id: 'project-tests', command, reporter, timeoutMs: 90_000, source: 'package.json scripts.test', declaredScript: script }];
}

export async function discoverProject(project) {
  const root = await fs.realpath(project);
  if (!(await fs.stat(root)).isDirectory()) throw new Error('project must be a directory');
  const names = await fs.readdir(root);
  const manifestText = await readSmall(path.join(root, 'package.json'));
  let manifest = {};
  if (manifestText !== null) {
    try { manifest = JSON.parse(manifestText); } catch { throw new Error('Project package.json is not valid JSON'); }
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Project package.json must be an object');
  }
  const packageManager = /^(npm|pnpm|yarn|bun)@/.exec(manifest.packageManager ?? '')?.[1] ??
    (names.includes('pnpm-lock.yaml') ? 'pnpm' : names.includes('yarn.lock') ? 'yarn' : names.includes('bun.lock') || names.includes('bun.lockb') ? 'bun' : 'npm');
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
  const frameworks = [];
  for (const [dep, kind] of [['@playwright/test', 'playwright'], ['playwright', 'playwright'], ['cypress', 'cypress'], ['vitest', 'vitest'], ['jest', 'jest'], ['next', 'next'], ['react', 'react'], ['vue', 'vue'], ['@angular/core', 'angular']]) {
    if (dependencies[dep] && !frameworks.includes(kind)) frameworks.push(kind);
  }
  if (isNodeTestScript(manifest.scripts?.test)) frameworks.push('node-test');
  if (names.some(name => ['pyproject.toml', 'pytest.ini', 'requirements.txt'].includes(name))) frameworks.push('python');
  const locks = names.filter(name => ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'uv.lock', 'poetry.lock'].includes(name));
  const inputs = [{ path: 'package.json', sha256: hash(manifestText) }].filter(item => item.sha256);
  for (const lock of locks) inputs.push({ path: lock, sha256: await hashFile(path.join(root, lock)) });
  const context = await readSmall(path.join(root, '.agents/qa-project-context.md'), 128 * 1024);
  if (context !== null) inputs.push({ path: '.agents/qa-project-context.md', sha256: hash(context) });
  const git = await runBounded({ command: 'git', args: ['rev-parse', '--show-toplevel'], cwd: root, timeoutMs: 3000, killGraceMs: 100, settlementGraceMs: 100 });
  let commit = null, dirty = null, changedFiles = [], gitRoot = null;
  if (git.code === 0 && !git.timedOut) {
    gitRoot = git.log.trim();
    const [revision, tracked, untracked, status] = await Promise.all([
      ['rev-parse', 'HEAD'], ['diff', '--name-only', 'HEAD', '--', '.'], ['ls-files', '--others', '--exclude-standard', '--', '.'], ['status', '--porcelain', '--', '.'],
    ].map(args => runBounded({ command: 'git', args, cwd: root, timeoutMs: 3000, killGraceMs: 100, settlementGraceMs: 100, maxOutputBytes: 100_000 })));
    commit = revision.code === 0 && /^[a-f0-9]{40,64}$/i.test(revision.log.trim()) ? revision.log.trim() : null;
    dirty = status.code === 0 ? status.log.trim().length > 0 : null;
    changedFiles = [...new Set([tracked, untracked].filter(result => result.code === 0).flatMap(result => result.log.trim().split('\n').filter(Boolean)))].slice(0, 200);
  }
  return { root, name: typeof manifest.name === 'string' ? manifest.name : path.basename(root), packageManager,
    frameworks, lockfiles: locks, inputs, contextPath: context === null ? null : '.agents/qa-project-context.md',
    availableScripts: Object.keys(manifest.scripts ?? {}).filter(key => typeof manifest.scripts[key] === 'string'),
    checks: discoverChecks(manifest, packageManager), commit, dirty, gitRoot, changedFiles,
    runtime: { node: process.version, platform: process.platform, arch: process.arch } };
}
