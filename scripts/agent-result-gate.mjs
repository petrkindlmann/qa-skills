#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runBounded } from '../tests/workflows/support/process.mjs';

const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const bindingKeys = ['runId', 'target', 'buildId'];

function requireConfig(config) {
  if (config?.schemaVersion !== 1 || !bindingKeys.every(key => nonempty(config[key]))) throw new Error('Config requires schemaVersion 1, runId, target and buildId');
  const target = new URL(config.target);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('Target must be an HTTP(S) URL without embedded credentials');
  if (!Number.isInteger(config.maxSteps) || config.maxSteps < 1 || config.maxSteps > 1000) throw new Error('maxSteps must be an integer from 1 to 1000');
  const oracle = config.oracle;
  if (!oracle || !nonempty(oracle.command) || !Array.isArray(oracle.args) || !oracle.args.every(value => typeof value === 'string')) throw new Error('Oracle requires an executable command and argument array');
  if (!Number.isInteger(oracle.timeoutMs) || oracle.timeoutMs < 1 || oracle.timeoutMs > 600000) throw new Error('Oracle timeoutMs must be 1..600000');
  if (!Array.isArray(oracle.requiredChecks) || oracle.requiredChecks.length === 0 || oracle.requiredChecks.length > 200 ||
      !oracle.requiredChecks.every(nonempty) || new Set(oracle.requiredChecks).size !== oracle.requiredChecks.length) throw new Error('Oracle requires unique nonempty requiredChecks');
}

export async function gateAgentResult(config, agentResult, { cwd = process.cwd(), env = process.env } = {}) {
  requireConfig(config);
  const output = { schemaVersion: 1, ...Object.fromEntries(bindingKeys.map(key => [key, config[key]])),
    passed: false, status: 'blocked', reasons: [], checks: [], startedAt: new Date().toISOString() };
  const reject = reason => ({ ...output, reasons: [reason], finishedAt: new Date().toISOString() });
  if (agentResult?.schemaVersion !== 1 || agentResult.completed !== true) return reject('Agent adapter must report completed:true as a boolean in schemaVersion 1');
  if (!bindingKeys.every(key => agentResult[key] === config[key])) return reject('Agent result is for a different run, target or build');
  if (!Number.isInteger(agentResult.steps) || agentResult.steps < 1 || agentResult.steps > config.maxSteps) return reject('Agent step count is missing, zero or outside its budget');

  // The gate executes the project-owned oracle itself. Model prose and a model's
  // "passed" field never create passing evidence. A fresh private path prevents reuse.
  const directory = await mkdtemp(path.join(os.tmpdir(), 'qa-agent-oracle-'));
  try {
    const evidenceFile = path.join(directory, 'oracle.json');
    const execution = await runBounded({ command: config.oracle.command, args: config.oracle.args,
      cwd: path.resolve(cwd, config.oracle.cwd ?? '.'), timeoutMs: config.oracle.timeoutMs,
      env: { ...env, QA_ORACLE_EVIDENCE: evidenceFile, QA_RUN_ID: config.runId, QA_TARGET: config.target, QA_BUILD_ID: config.buildId } });
    output.execution = { command: [config.oracle.command, ...config.oracle.args], code: execution.code,
      signal: execution.signal, timedOut: execution.timedOut, launchError: execution.launchError,
      forcedSettlement: execution.forcedSettlement, outputTruncated: execution.outputTruncated };
    if (execution.timedOut || execution.signal || execution.launchError || execution.forcedSettlement) return reject('Independent oracle could not finish normally');
    let evidence;
    try { evidence = JSON.parse(await readFile(evidenceFile, 'utf8')); }
    catch { return reject('Independent oracle did not write a fresh JSON evidence file'); }
    if (evidence?.schemaVersion !== 1 || !bindingKeys.every(key => evidence[key] === config[key])) return reject('Oracle evidence is for a different run, target or build');
    if (!Array.isArray(evidence.checks) || evidence.checks.length === 0 || evidence.checks.length > 200 ||
        !evidence.checks.every(check => nonempty(check?.id) && ['passed', 'failed'].includes(check.status) &&
          typeof check.observed === 'boolean' && nonempty(check.evidence)) ||
        new Set(evidence.checks.map(check => check.id)).size !== evidence.checks.length) return reject('Oracle checks are empty, duplicated or malformed');
    output.checks = evidence.checks;
    if (!config.oracle.requiredChecks.every(id => evidence.checks.some(check => check.id === id))) return reject('Required independent checks are missing');
    if (evidence.checks.some(check => !check.observed)) return reject('An oracle check did not observe its target');
    if (execution.code !== 0 || evidence.checks.some(check => check.status !== 'passed')) {
      return { ...output, status: 'failed', reasons: ['Independent oracle reported a failed check or nonzero exit'], finishedAt: new Date().toISOString() };
    }
    return { ...output, passed: true, status: 'passed', finishedAt: new Date().toISOString() };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!['--config', '--agent-result', '--output'].includes(args[i]) || !args[i + 1] || options[args[i]]) throw new Error('Usage: node scripts/agent-result-gate.mjs --config FILE --agent-result FILE --output FILE');
      options[args[i]] = args[i + 1];
    }
    if (!options['--config'] || !options['--agent-result'] || !options['--output']) throw new Error('Provide --config, --agent-result and --output');
    if ([options['--config'], options['--agent-result']].some(file => path.resolve(file) === path.resolve(options['--output']))) throw new Error('Output must not replace a gate input');
    await rm(options['--output'], { force: true });
    const config = JSON.parse(await readFile(options['--config'], 'utf8'));
    const agent = JSON.parse(await readFile(options['--agent-result'], 'utf8'));
    const result = await gateAgentResult(config, agent, { cwd: path.dirname(path.resolve(options['--config'])) });
    await writeFile(options['--output'], JSON.stringify(result, null, 2) + '\n');
    console.log(`${result.status}: ${result.reasons.join('; ') || `${result.checks.length} independent checks passed`}`);
    process.exitCode = result.passed ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
