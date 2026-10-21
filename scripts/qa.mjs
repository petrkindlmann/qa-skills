#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { initialize, makePlan, runPlan } from '../tools/qa/run.mjs';
import { sanitized, secretValues, redactText } from '../tools/qa/privacy.mjs';

const help = `QA Skills: bounded checks, skill routing, and evidence reports

Usage:
  node scripts/qa.mjs plan [--project PATH] [--goal TEXT]
  node scripts/qa.mjs run [--project PATH] [--config PATH] [--goal TEXT]
  node scripts/qa.mjs run --url URL --ready-selector SELECTOR [--expected-url URL]
  node scripts/qa.mjs init [--project PATH] [--wire-agent]

Options:
  --project PATH       Project directory (default: current directory)
  --config PATH        QA config, relative to project or absolute
  --goal TEXT          User goal for routing; does not authorize extra commands
  --url URL            HTTP(S) application target; also passed as BASE_URL
  --ready-selector CSS Application-owned visible ready state for browser checks
  --expected-url URL   Exact post-navigation URL (default: --url)
  --output PATH        Parent directory for a unique run folder
  --verbose            Print the redacted command log after the run
  --wire-agent         Explicitly add/update a bounded project AGENTS.md workflow
  --help               Show this help

plan writes nothing and executes no tests. run discovers package.json scripts.test
when checks are not configured. It never installs tools, starts your app, or deploys.
init preserves an existing qa.config.json. --wire-agent changes only that project's
AGENTS.md. Run reports: report.html, result.json, plan.json, agent-handoff.md,
minimal.log, verbose.log, and per-command evidence.

Exit codes: 0 = observed configured checks passed; 1 = failure; 2 = blocked/incomplete.
The host agent reads skills and makes authorized repairs; this CLI does not call a model.
`;

export function parseArgs(argv) {
  const args = [...argv];
  const command = args[0] && !args[0].startsWith('-') ? args.shift() : 'run';
  if (!['run', 'plan', 'init'].includes(command)) throw new Error(`Unknown command: ${command}`);
  const options = {};
  const valued = new Map([['--project', 'project'], ['--config', 'config'], ['--goal', 'goal'], ['--url', 'url'], ['--ready-selector', 'readySelector'], ['--expected-url', 'expectedUrl'], ['--output', 'output']]);
  const flags = new Map([['--verbose', 'verbose'], ['--wire-agent', 'wireAgent'], ['--help', 'help']]);
  for (let i = 0; i < args.length; i++) {
    const name = valued.get(args[i]) ?? flags.get(args[i]);
    if (!name) throw new Error(`Unknown option: ${args[i]}`);
    if (options[name] !== undefined) throw new Error(`Option repeated: ${args[i]}`);
    if (flags.has(args[i])) options[name] = true;
    else { if (i + 1 >= args.length || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${args[i]}`); options[name] = args[++i]; }
  }
  if (options.wireAgent && command !== 'init') throw new Error('--wire-agent is only valid with init');
  if (command === 'init' && options.config) throw new Error('init writes qa.config.json; --config is only valid for plan or run');
  return { command, options };
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const { command, options } = parseArgs(argv);
    if (options.help) { process.stdout.write(help); return 0; }
    if (command === 'init') {
      const result = await initialize(options);
      process.stdout.write(`${result.created ? 'Created' : 'Preserved'} ${result.config}\n${result.agentFile ? `QA workflow: ${result.agentFile}\n` : ''}`);
      return 0;
    }
    const plan = await makePlan(options);
    if (command === 'plan') {
      process.stdout.write(`${JSON.stringify(sanitized(plan, secretValues(process.env, [plan.url].filter(Boolean))), null, 2)}\n`);
      return 0;
    }
    const { result, directory } = await runPlan(plan, { ...options, onLog: message => process.stdout.write(`${message}\n`) });
    process.stdout.write(`Report: ${path.join(directory, 'report.html')}\nResult: ${path.join(directory, 'result.json')}\n`);
    if (options.verbose) process.stdout.write(await fs.readFile(path.join(directory, 'verbose.log'), 'utf8'));
    return result.summary.exitCode;
  } catch (error) {
    process.stderr.write(`QA blocked: ${redactText(error.message, secretValues())}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
