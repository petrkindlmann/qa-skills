// Port of references/recovery-scripts.md §3 "scripts/failure-inventory.ts" to ESM JavaScript
// (type annotations removed, logic unchanged).
const record = (value, field) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value;
};
const list = (value, field) => {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return value;
};

export function collectFailureInventory(input) {
  const report = record(input, 'report');
  const runErrors = list(report.errors, 'report.errors')
    .map((error, index) => record(error, `report.errors[${index}]`));
  const attempts = [];
  let observedResults = 0;
  const statuses = new Set(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']);
  const visit = (rawSuite, suitePath, parents) => {
    const suite = record(rawSuite, suitePath);
    const suiteTitles = [...parents, suite.title ?? null];
    list(suite.specs, `${suitePath}.specs`).forEach((rawSpec, specIndex) => {
      const specPath = `${suitePath}.specs[${specIndex}]`;
      const spec = record(rawSpec, specPath);
      list(spec.tests, `${specPath}.tests`).forEach((rawTest, testIndex) => {
        const testPath = `${specPath}.tests[${testIndex}]`;
        const test = record(rawTest, testPath);
        list(test.results, `${testPath}.results`).forEach((rawResult, resultIndex) => {
          const attemptId = `${testPath}.results[${resultIndex}]`;
          const result = record(rawResult, attemptId);
          const status = result.status ?? null;
          if (status !== null && !statuses.has(status)) throw new Error(`${attemptId}: unknown status`);
          observedResults++;
          if (status === 'passed' || status === 'skipped') return;
          const retry = result.retry ?? null;
          if (retry !== null && (!Number.isInteger(retry) || retry < 0)) {
            throw new Error(`${attemptId}: retry must be a nonnegative integer when supplied`);
          }
          attempts.push({
            attemptId, testId: spec.id ?? null, testTitle: spec.title ?? null,
            suiteTitles, projectName: test.projectName ?? null, projectId: test.projectId ?? null,
            expectedStatus: test.expectedStatus ?? null, testOutcome: test.status ?? null,
            status, retry,
            reportedTestLocation: { file: spec.file ?? null, line: spec.line ?? null, column: spec.column ?? null },
            reporterResult: result,
            triage: 'unreviewed', triageEvidence: null,
            file: null, line: null, column: null, oldLocator: null, intent: null, pageRoute: null,
          });
        });
      });
    });
    list(suite.suites === undefined ? [] : suite.suites, `${suitePath}.suites`)
      .forEach((child, index) => visit(child, `${suitePath}.suites[${index}]`, suiteTitles));
  };
  list(report.suites, 'report.suites').forEach((suite, index) => visit(suite, `suites[${index}]`, []));
  if (!observedResults && !runErrors.length) throw new Error('Report contains no test attempts or run-level errors');
  return { observedResults, runErrors, attempts };
}

// This checks the completeness of an inspected record, not the truth of its claims.
export function requireVerifiedDrift(input) {
  const row = record(input, 'reviewed failure');
  if (row.triage !== 'confirmed-selector-drift') throw new Error('Manual drift triage is required');
  for (const field of ['attemptId', 'file', 'oldLocator', 'intent', 'pageRoute', 'triageEvidence']) {
    if (typeof row[field] !== 'string' || !row[field].trim()) throw new Error(`Verified ${field} is required`);
  }
  if (!Number.isInteger(row.line) || row.line < 1) throw new Error('Verified source line is required');
  if (row.column !== null && row.column !== undefined && (!Number.isInteger(row.column) || row.column < 1)) {
    throw new Error('Source column must be a positive integer when supplied');
  }
  return row;
}
