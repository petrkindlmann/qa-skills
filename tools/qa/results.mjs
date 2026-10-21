function incomplete(reason) { return { status: 'incomplete', reason, counts: null }; }

export function parseTap(text) {
  text = text.replaceAll('\r\n', '\n');
  const values = {};
  for (const field of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const matches = [...text.matchAll(new RegExp(`^# ${field} (\\d+)\\s*$`, 'gm'))];
    if (matches.length !== 1) return incomplete(`Expected one TAP summary for ${field}; received ${matches.length}. Use a single test process per check.`);
    values[field] = Number(matches[0][1]);
    if (!Number.isSafeInteger(values[field])) return incomplete(`TAP ${field} counter is not a safe integer.`);
  }
  if (!/^TAP version 13\s*$/m.test(text)) return incomplete('No TAP v13 header was emitted.');
  const { tests: total, pass: passed, fail: failed, cancelled, skipped, todo } = values;
  if (total !== passed + failed + cancelled + skipped + todo) return incomplete('TAP counters do not reconcile.');
  const observations = [...text.matchAll(/^[ \t]*(not )?ok (\d+)([^\n]*)$/gm)];
  const rootObservations = [...text.matchAll(/^(not )?ok (\d+)([^\n]*)$/gm)];
  const plans = [...text.matchAll(/^1\.\.(\d+)(?:[ \t]+#[^\n]*)?[ \t]*$/gm)];
  if (plans.length !== 1 || rootObservations.length !== Number(plans[0][1]) ||
    rootObservations.some((record, i) => Number(record[2]) !== i + 1) || observations.length < total) {
    return incomplete('TAP summaries have no matching test observations and root plan.');
  }
  if (!failed && observations.some(record => record[1] && !/\s#\s*(?:TODO|SKIP)\b/i.test(record[3]))) return incomplete('TAP reports a failed assertion but its failure counter is zero.');
  if (!skipped && observations.some(record => /\s#\s*SKIP\b/i.test(record[3]))) return incomplete('TAP reports a skipped assertion but its skipped counter is zero.');
  if (!todo && observations.some(record => /\s#\s*TODO\b/i.test(record[3]))) return incomplete('TAP reports a TODO assertion but its TODO counter is zero.');
  const counts = { total, passed, failed, skipped, cancelled, todo, retried: 0, observed: passed + failed };
  if (failed) return { status: 'failed', reason: `${failed} test${failed === 1 ? '' : 's'} failed.`, counts };
  if (!total || !counts.observed || cancelled || skipped || todo) return { status: 'incomplete', reason: 'The run contains zero observations or skipped, cancelled, or TODO tests.', counts };
  return { status: 'passed', reason: 'All observed tests passed with no skips or cancellations.', counts };
}

// Every complete top-level JSON object in a command log. Package managers print a
// preamble before the reporter and, on failure, a trailing line after it (pnpm's
// ELIFECYCLE, bun's "script exited"). Text outside an object is ignored; an object
// cut off by truncation is dropped rather than guessed at.
function topLevelObjects(text) {
  const objects = [];
  let depth = 0, start = -1, inString = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (depth === 0) { if (char === '{') { depth = 1; start = i; } continue; }
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') { depth--; if (depth === 0) objects.push(text.slice(start, i + 1)); }
  }
  return objects;
}

function playwrightObject(text) {
  // Exactly one report may be accepted. Two reports in one log (a rerun appended to
  // the first attempt) must not be merged into one apparent result.
  const reports = [];
  for (const candidate of topLevelObjects(text)) {
    try {
      const report = JSON.parse(candidate);
      if (report && Array.isArray(report.suites) && Array.isArray(report.errors)) reports.push(report);
    } catch {}
  }
  return reports.length === 1 ? reports[0] : null;
}

export function parsePlaywright(text) {
  const report = playwrightObject(text);
  if (!report) return incomplete('No complete Playwright JSON report was emitted.');
  if (report.errors.length) return { status: 'blocked', reason: 'Playwright reported a runner or global setup error.', counts: null };
  const tests = [];
  function walk(suite) {
    if (!suite || typeof suite !== 'object') throw new Error('Invalid suite');
    if (suite.specs !== undefined && !Array.isArray(suite.specs) || suite.suites !== undefined && !Array.isArray(suite.suites)) throw new Error('Invalid children');
    for (const spec of suite.specs ?? []) {
      if (!spec || !Array.isArray(spec.tests)) throw new Error('Invalid spec');
      for (const test of spec.tests) {
        if (!test || typeof test !== 'object') throw new Error('Invalid test');
        tests.push(test);
      }
    }
    for (const child of suite.suites ?? []) walk(child);
  }
  try { for (const suite of report.suites) walk(suite); } catch { return incomplete('Playwright report has an invalid suite shape.'); }
  if (!tests.length) return incomplete('Playwright reported no tests.');
  const counts = { total: tests.length, passed: 0, failed: 0, skipped: 0, cancelled: 0, todo: 0, retried: 0, observed: 0 };
  let unsupported = 0;
  for (const test of tests) {
    if (!Array.isArray(test.results)) { unsupported++; continue; }
    if (test.status === 'skipped' || (test.results.length === 1 && test.results[0]?.status === 'skipped')) { counts.skipped++; continue; }
    if (!test.results.length) { unsupported++; continue; }
    if (test.results.some(result => !result || !Number.isInteger(result.retry) || result.retry < 0 || !Array.isArray(result.errors))) { unsupported++; continue; }
    const final = test.results.at(-1);
    if (test.results.length > 1 || test.results.some(result => result.retry > 0) || test.status === 'flaky') counts.retried++;
    if (test.expectedStatus !== 'passed') { unsupported++; continue; }
    if (final.status === 'passed' && test.status === 'expected' && !(final.errors?.length)) counts.passed++;
    else if (['failed', 'timedOut'].includes(final.status)) counts.failed++;
    else if (final.status === 'interrupted') counts.cancelled++;
    else unsupported++;
  }
  counts.observed = counts.passed + counts.failed;
  if (counts.failed) return { status: 'failed', reason: `${counts.failed} browser test${counts.failed === 1 ? '' : 's'} failed.`, counts };
  if (unsupported || counts.skipped || counts.cancelled || counts.retried || !counts.observed) return { status: 'incomplete', reason: 'The report contains skipped, retried, expected-failure, interrupted, or unsupported results.', counts };
  return { status: 'passed', reason: 'Every browser test passed on its first attempt.', counts };
}

export function assessCommand(check, processResult) {
  if (processResult.launchError) return { status: 'blocked', reason: `Could not start the declared command: ${processResult.launchError}`, counts: null };
  if (processResult.timedOut || processResult.forcedSettlement) return { status: 'blocked', reason: 'The command exceeded its execution budget and was terminated.', counts: null };
  if (processResult.signal) return { status: 'blocked', reason: `The command terminated with signal ${processResult.signal}.`, counts: null };
  if (processResult.outputTruncated) return { status: 'incomplete', reason: 'Command output exceeded the evidence size limit. Narrow the check or use a smaller reporter.', counts: null };
  const assessment = check.reporter === 'tap' ? parseTap(processResult.log) :
    check.reporter === 'playwright-json' ? parsePlaywright(processResult.log) :
      { status: 'unverified', reason: 'The command completed, but exit status alone does not establish a test result. Configure a supported reporter.', counts: null };
  if (processResult.code !== 0 && assessment.status !== 'blocked') {
    return { ...assessment, status: 'failed', reason: `${assessment.counts?.failed ? assessment.reason : 'The declared command failed without a complete test verdict.'} Exit code ${processResult.code}.` };
  }
  if (processResult.code === 0 && assessment.status === 'failed') return { ...assessment, reason: `${assessment.reason} The command returned zero despite the failures.` };
  return assessment;
}

export function summarize(checks) {
  const statuses = { passed: 0, failed: 0, blocked: 0, incomplete: 0, unverified: 0 };
  const tests = { total: 0, passed: 0, failed: 0, skipped: 0, cancelled: 0, todo: 0, retried: 0, observed: 0 };
  for (const check of checks) {
    statuses[check.status]++;
    if (check.counts) for (const field of Object.keys(tests)) tests[field] += check.counts[field] ?? 0;
  }
  const status = statuses.failed ? 'failed' : statuses.blocked ? 'blocked' :
    statuses.incomplete || statuses.unverified || !checks.length ? 'incomplete' : 'passed';
  return { status, checks: { total: checks.length, ...statuses }, tests,
    exitCode: status === 'passed' ? 0 : status === 'failed' ? 1 : 2 };
}
