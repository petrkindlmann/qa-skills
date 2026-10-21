#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runBounded } from '../tests/workflows/support/process.mjs';

export function pythonExecutable(env = process.env, platform = process.platform) {
  if (env.QA_PYTHON !== undefined) {
    if (typeof env.QA_PYTHON !== 'string' || env.QA_PYTHON.trim() === '') throw new Error('QA_PYTHON must name a Python executable');
    return env.QA_PYTHON; // One executable path, including spaces; never split it into shell words.
  }
  return platform === 'win32' ? 'python' : 'python3';
}

export async function runPython(args, { env = process.env, timeoutMs = 600000, cwd = process.cwd() } = {}) {
  if (!args.length) throw new Error('Usage: node scripts/run-python.mjs SCRIPT [ARG ...]');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1800000) throw new Error('Python timeout must be 1..1800000 milliseconds');
  return runBounded({ command: pythonExecutable(env), args, env, cwd, timeoutMs });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const timeoutMs = process.env.QA_PYTHON_TIMEOUT_MS === undefined ? 600000 : Number(process.env.QA_PYTHON_TIMEOUT_MS);
    const result = await runPython(process.argv.slice(2), { timeoutMs });
    if (result.log) process.stdout.write(result.log);
    if (result.launchError) console.error(`Python could not start: ${result.launchError}`);
    if (result.timedOut) console.error(`Python exceeded ${timeoutMs}ms and was stopped`);
    if (result.outputTruncated) console.error('Python output exceeded the 8 MiB capture limit');
    process.exitCode = result.launchError ? 127 : result.timedOut ? 124 : result.signal ? 130 : result.code ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
