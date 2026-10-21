import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

export async function prepareRunDirectory(directory) {
  await mkdir(directory, { recursive: true });
  // A CLI can exit before the reporter starts. Never read an earlier run's result.
  await rm(path.join(directory, 'verbose.json'), { force: true });
  await rm(path.join(directory, 'minimal.txt'), { force: true });
}

export function testsFrom(report) {
  const tests = [];
  function visit(suite) {
    for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
      tests.push({ title: spec.title, outcome: test.status, expectedStatus: test.expectedStatus,
        results: (test.results ?? []).map(result => ({
          status: result.status, retry: result.retry, duration: result.duration,
          errors: (result.errors ?? []).map(error => error.message ?? error.value ?? String(error)),
        })) });
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  for (const suite of report?.suites ?? []) visit(suite);
  return tests;
}

export function assessRun(scenario, processResult, report) {
  const tests = testsFrom(report);
  const failed = tests.filter(test => test.outcome === 'unexpected');
  const timedOut = Boolean(processResult.timedOut) || tests.some(test => test.results.some(result =>
    result.status === 'timedOut' || result.status === 'interrupted'));
  const infrastructureError = Boolean(processResult.launchError || processResult.forcedSettlement) ||
    tests.some(test => test.results.some(result => result.errors.some(error =>
      /browserType\.launch|before readiness|did not become ready|ECONNREFUSED|Cannot find module|No tests found/.test(error))));
  const shape = report && Array.isArray(report.suites) && Array.isArray(report.errors);
  const complete = shape && Number.isInteger(scenario.count) && scenario.count > 0 && tests.length === scenario.count &&
    tests.every(test => test.expectedStatus === 'passed' && test.results.length === 1 &&
      test.results[0].retry === 0 && ['passed', 'failed'].includes(test.results[0].status));
  const cleanProcess = !processResult.signal && !timedOut && !infrastructureError;
  const healthy = complete && cleanProcess && report.errors.length === 0 && processResult.code === 0 &&
    tests.every(test => test.outcome === 'expected' && test.results[0].status === 'passed' && test.results[0].errors.length === 0);
  const target = failed.filter(test => test.title.includes(scenario.title ?? '\u0000') &&
    test.results[0]?.status === 'failed' && test.results[0].errors.length > 0);
  const detected = complete && cleanProcess && report.errors.length === 0 && processResult.code === 1 && target.length > 0;
  const acceptable = Boolean(scenario.healthy || scenario.expectedGap ? healthy : detected);
  return { tests, failed, timedOut, infrastructureError, acceptable,
    outcome: scenario.healthy ? (acceptable ? 'healthy_pass' : 'healthy_failure')
      : scenario.expectedGap ? (acceptable ? 'coverage_gap_confirmed' : 'gap_not_confirmed')
      : (acceptable ? 'assertion_detection_candidate' : 'not_established') };
}
