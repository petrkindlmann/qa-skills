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

const xmlEntities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeXml(value) {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (match, entity) => {
    if (entity[0] !== '#') return xmlEntities[entity] ?? match;
    const code = entity[1] === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

// The element tree of an XML document. CDATA sections, comments, processing
// instructions and a DOCTYPE are removed first, so a stack trace inside a failure
// body cannot open or close an element. Only the five predefined entities and
// numeric references are decoded; nothing external is fetched or expanded.
function xmlElements(text) {
  const cleaned = text.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?[^>]*>/gi, '');
  const roots = [], stack = [];
  const tags = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  for (const [, closing, name, attributeText, selfClosing] of cleaned.matchAll(tags)) {
    if (closing) {
      if (stack.pop()?.name !== name) throw new Error(`Unbalanced element ${name}`);
      continue;
    }
    const attributes = {};
    for (const match of attributeText.matchAll(/([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attributes[match[1]] = decodeXml(match[2] ?? match[3]);
    const element = { name, attributes, children: [] };
    (stack.at(-1)?.children ?? roots).push(element);
    if (!selfClosing) stack.push(element);
  }
  if (stack.length) throw new Error(`Unterminated element ${stack.at(-1).name}`);
  return roots;
}

// JUnit XML as pytest, Vitest, jest-junit, mocha-junit-reporter, gotestsum and
// Surefire write it: a <testsuites> or <testsuite> root, one <testcase> per test,
// <failure>/<error>/<skipped> children for the outcome and Surefire's flaky/rerun
// children for retries. Every suite counter that is present must reconcile with
// the test cases recorded under it.
export function parseJunit(text) {
  text = text.replaceAll('\r\n', '\n');
  const start = text.search(/<testsuites?(?=[\s/>])/);
  const end = Math.max(text.lastIndexOf('</testsuites>'), text.lastIndexOf('</testsuite>'));
  if (start < 0 || end < start) return incomplete('No complete JUnit XML report was emitted.');
  let roots;
  try { roots = xmlElements(text.slice(start, text.indexOf('>', end) + 1)).filter(element => ['testsuites', 'testsuite'].includes(element.name)); }
  catch { return incomplete('The JUnit XML report is not well formed.'); }
  if (roots.length !== 1) return incomplete(roots.length ? 'More than one JUnit report was found. Use a single test process per check.' : 'No JUnit XML report was found.');
  const counts = { total: 0, passed: 0, failed: 0, skipped: 0, cancelled: 0, todo: 0, retried: 0, observed: 0 };
  let unsupported = 0, mismatch = false;
  const declared = (element, name) => {
    if (!(name in element.attributes)) return null;
    const value = Number(element.attributes[name]);
    return Number.isSafeInteger(value) && value >= 0 ? value : NaN;
  };
  const walk = (element, inSuite) => {
    if (element.name === 'testcase') {
      if (!inSuite) { unsupported++; return null; }
      const kinds = new Set(element.children.map(child => child.name));
      const subtotal = { tests: 1, failed: 0, skipped: 0 };
      if (['flakyFailure', 'flakyError', 'rerunFailure', 'rerunError'].some(kind => kinds.has(kind))) counts.retried++;
      if (kinds.has('failure') || kinds.has('error')) { counts.failed++; subtotal.failed = 1; }
      else if (kinds.has('skipped')) { counts.skipped++; subtotal.skipped = 1; }
      else counts.passed++;
      counts.total++;
      return subtotal;
    }
    if (element.name !== 'testsuite' && element.name !== 'testsuites') return null;
    const subtotal = { tests: 0, failed: 0, skipped: 0 };
    for (const child of element.children) {
      const result = walk(child, element.name === 'testsuite');
      if (result) for (const key of Object.keys(subtotal)) subtotal[key] += result[key];
    }
    const tests = declared(element, 'tests'), failures = declared(element, 'failures'), errors = declared(element, 'errors'), skipped = declared(element, 'skipped');
    if ([tests, failures, errors, skipped].some(Number.isNaN)) mismatch = true;
    if (tests !== null && tests !== subtotal.tests) mismatch = true;
    if ((failures !== null || errors !== null) && (failures ?? 0) + (errors ?? 0) !== subtotal.failed) mismatch = true;
    if (skipped !== null && skipped !== subtotal.skipped) mismatch = true;
    return subtotal;
  };
  walk(roots[0], false);
  counts.observed = counts.passed + counts.failed;
  if (counts.failed) return { status: 'failed', reason: `${counts.failed} test${counts.failed === 1 ? '' : 's'} failed.`, counts };
  if (mismatch) return { status: 'incomplete', reason: 'JUnit suite counters do not reconcile with the recorded test cases.', counts };
  if (unsupported || counts.skipped || counts.retried || !counts.observed) return { status: 'incomplete', reason: 'The report contains skipped, rerun, misplaced, or no test cases.', counts };
  return { status: 'passed', reason: 'Every recorded test case passed with no skips or reruns.', counts };
}

// A check that names a resultFile is judged by that file, never by its output,
// so a report written by an earlier run cannot stand in for this one.
function assessJunit(check, processResult) {
  if (!check.resultFile) return parseJunit(processResult.log);
  if (!processResult.resultFile) return incomplete('The declared result file was not read after the command.');
  if (processResult.resultFile.error) return incomplete(processResult.resultFile.error);
  return parseJunit(processResult.resultFile.text);
}

export function assessCommand(check, processResult) {
  if (processResult.launchError) return { status: 'blocked', reason: `Could not start the declared command: ${processResult.launchError}`, counts: null };
  if (processResult.timedOut || processResult.forcedSettlement) return { status: 'blocked', reason: 'The command exceeded its execution budget and was terminated.', counts: null };
  if (processResult.signal) return { status: 'blocked', reason: `The command terminated with signal ${processResult.signal}.`, counts: null };
  if (processResult.outputTruncated) return { status: 'incomplete', reason: 'Command output exceeded the evidence size limit. Narrow the check or use a smaller reporter.', counts: null };
  const assessment = check.reporter === 'tap' ? parseTap(processResult.log) :
    check.reporter === 'playwright-json' ? parsePlaywright(processResult.log) :
    check.reporter === 'junit-xml' ? assessJunit(check, processResult) :
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
