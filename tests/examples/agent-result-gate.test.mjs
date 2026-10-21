import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { gateAgentResult } from '../../scripts/agent-result-gate.mjs';
import { runBounded } from '../workflows/support/process.mjs';
import { snippet } from './snippets.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'qa-agent-gate-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = path.join(directory, 'oracle.mjs');
  await writeFile(script, `import { writeFile } from 'node:fs/promises';
    const variant = process.env.QA_TEST_VARIANT;
    if (variant === 'stall') await new Promise(() => setInterval(() => {}, 1000));
    const result = { schemaVersion: 1, runId: process.env.QA_RUN_ID, target: process.env.QA_TARGET,
      buildId: process.env.QA_BUILD_ID, checks: [{ id: 'identity', status: 'passed', observed: true, evidence: 'Expected synthetic account was observed' }] };
    if (variant === 'failed') result.checks[0].status = 'failed';
    if (variant === 'empty') result.checks = [];
    if (variant === 'missing-check') result.checks[0].id = 'unrelated';
    if (variant === 'duplicate') result.checks.push({ ...result.checks[0] });
    if (variant === 'unobserved') result.checks[0].observed = false;
    if (variant === 'string-boolean') result.checks[0].observed = 'true';
    if (variant === 'old-run') result.runId = 'old-run';
    if (variant === 'other-target') result.target = 'https://other.example/';
    if (variant === 'other-build') result.buildId = 'old-build';
    if (variant !== 'missing-file') await writeFile(process.env.QA_ORACLE_EVIDENCE, JSON.stringify(result));
    if (variant === 'bad-exit') process.exitCode = 7;
  `);
  const config = { schemaVersion: 1, runId: 'run-current', target: 'http://127.0.0.1:4321/', buildId: 'build-current', maxSteps: 18,
    oracle: { command: process.execPath, args: [script], timeoutMs: 3000, requiredChecks: ['identity'] } };
  const agent = { schemaVersion: 1, runId: config.runId, target: config.target, buildId: config.buildId, completed: true, steps: 3 };
  return { config, agent };
}

test('agent gate executes an independent oracle and accepts a complete current result', async t => {
  const { config, agent } = await fixture(t);
  const result = await gateAgentResult(config, agent);
  assert.equal(result.passed, true);
  assert.equal(result.status, 'passed');
  assert.equal(result.checks.length, 1);
  assert.equal(result.execution.code, 0);
});

test('model self-grades, string booleans, zero steps, excess steps and wrong binding do not start the oracle', async t => {
  const { config, agent } = await fixture(t);
  for (const record of [{ passed: true, steps: 3 }, { passed: 'true' }, { ...agent, completed: 'true' },
    { ...agent, steps: 0 }, { ...agent, steps: '3' }, { ...agent, steps: 19 },
    { ...agent, runId: 'old-run' }, { ...agent, target: 'http://other/' }, { ...agent, buildId: 'old-build' }]) {
    const result = await gateAgentResult(config, record);
    assert.equal(result.passed, false);
    assert.equal(result.status, 'blocked');
    assert.equal(result.execution, undefined);
  }
});

test('independent failures override a model success claim and successful process exit', async t => {
  const { config, agent } = await fixture(t);
  for (const variant of ['failed', 'bad-exit']) {
    const result = await gateAgentResult(config, { ...agent, passed: true }, { env: { ...process.env, QA_TEST_VARIANT: variant } });
    assert.equal(result.status, 'failed', variant);
    assert.equal(result.passed, false);
  }
});

test('missing, empty, duplicate, unobserved and mismatched oracle evidence fails closed', async t => {
  const { config, agent } = await fixture(t);
  for (const variant of ['empty', 'missing-file', 'missing-check', 'duplicate', 'unobserved', 'string-boolean', 'old-run', 'other-target', 'other-build']) {
    const result = await gateAgentResult(config, agent, { env: { ...process.env, QA_TEST_VARIANT: variant } });
    assert.equal(result.status, 'blocked', variant);
    assert.equal(result.passed, false, variant);
  }
});

test('a bounded oracle timeout and a missing executable remain blocked', async t => {
  const { config, agent } = await fixture(t);
  const stalled = await gateAgentResult({ ...config, oracle: { ...config.oracle, timeoutMs: 100 } }, agent,
    { env: { ...process.env, QA_TEST_VARIANT: 'stall' } });
  assert.equal(stalled.status, 'blocked');
  assert.equal(stalled.execution.timedOut, true);
  const missing = await gateAgentResult({ ...config, oracle: { ...config.oracle, command: '/no-such-agent-oracle' } }, agent);
  assert.equal(missing.status, 'blocked');
  assert.match(missing.execution.launchError, /ENOENT/);
});

test('invalid oracle contracts are rejected before spawning', async t => {
  const { config, agent } = await fixture(t);
  for (const oracle of [{ ...config.oracle, args: 'shell command' }, { ...config.oracle, timeoutMs: 0 },
    { ...config.oracle, requiredChecks: [] }, { ...config.oracle, requiredChecks: ['identity', 'identity'] }]) {
    await assert.rejects(gateAgentResult({ ...config, oracle }, agent));
  }
  await assert.rejects(gateAgentResult({ ...config, target: 'file:///tmp/page.html' }, agent));
});

test('the published oracle runs real HTTP requests and rejects the wrong account, build and unauthenticated session', async t => {
  const { config, agent } = await fixture(t);
  await writeFile(config.oracle.args[0], snippet('skills/agentic-browser-testing/references/gate-contract.md', 'const { QA_ORACLE_EVIDENCE'));
  let variant = 'healthy';
  const observed = [];
  const server = http.createServer((request, response) => {
    observed.push(request.url);
    response.setHeader('content-type', 'application/json');
    if (request.url === '/health') response.end(JSON.stringify({ status: 'ok', build: variant === 'wrong-build' ? 'other' : config.buildId }));
    else if (request.url === '/api/me' && request.headers.cookie === 'session=synthetic' && variant !== 'unauthenticated') {
      response.end(JSON.stringify({ user: { email: variant === 'wrong-account' ? 'other@example.test' : 'alice@example.test' } }));
    } else {
      response.statusCode = 401;
      response.end(JSON.stringify({ error: 'unauthenticated' }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  config.target = `http://127.0.0.1:${server.address().port}/`;
  agent.target = config.target;
  config.oracle.requiredChecks = ['health', 'build', 'identity'];
  const env = { ...process.env, QA_SESSION_COOKIE: 'session=synthetic', QA_EXPECTED_EMAIL: 'alice@example.test' };
  const healthy = await gateAgentResult(config, agent, { env });
  assert.equal(healthy.passed, true, JSON.stringify(healthy));
  assert.deepEqual(observed, ['/health', '/api/me']);
  for (variant of ['wrong-account', 'wrong-build', 'unauthenticated']) {
    const failed = await gateAgentResult(config, agent, { env });
    assert.equal(failed.status, 'failed', variant);
    assert.equal(failed.passed, false, variant);
    assert.ok(failed.checks.some(check => check.status === 'failed' && check.observed), variant);
  }
});

test('gate CLI writes a typed verdict and removes an earlier success before rejecting malformed input', async t => {
  const { config, agent } = await fixture(t);
  const directory = path.dirname(config.oracle.args[0]);
  const configFile = path.join(directory, 'config.json');
  const agentFile = path.join(directory, 'agent.json');
  const outputFile = path.join(directory, 'gate.json');
  await writeFile(configFile, JSON.stringify(config));
  await writeFile(agentFile, JSON.stringify(agent));
  const cli = fileURLToPath(new URL('../../scripts/agent-result-gate.mjs', import.meta.url));
  const invoke = output => runBounded({ command: process.execPath, args: [cli, '--config', configFile,
    '--agent-result', agentFile, '--output', output], timeoutMs: 5000 });
  const success = await invoke(outputFile);
  assert.equal(success.code, 0, success.log);
  assert.equal(JSON.parse(await readFile(outputFile, 'utf8')).passed, true);
  await writeFile(configFile, 'invalid json');
  const malformed = await invoke(outputFile);
  assert.equal(malformed.code, 2);
  await assert.rejects(readFile(outputFile), { code: 'ENOENT' });
  const overlapping = await invoke(agentFile);
  assert.equal(overlapping.code, 2);
  assert.deepEqual(JSON.parse(await readFile(agentFile, 'utf8')), agent);
});
