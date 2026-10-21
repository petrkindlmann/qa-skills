export default class MinimalReporter {
  attempts = [];
  onBegin(_config, suite) { process.stdout.write(`WORKFLOW RUN: ${suite.allTests().length} scheduled cases\n`); }
  onTestEnd(test, result) {
    this.attempts.push({ title: test.titlePath().join(' / '), status: result.status, retry: result.retry });
    if (result.status !== 'passed') {
      process.stdout.write(`${result.status.toUpperCase()}: ${test.titlePath().join(' / ')} (attempt ${result.retry + 1})\n`);
      for (const error of result.errors ?? []) process.stdout.write(`${String(error.message ?? error.value).slice(0,1200)}\n`);
    }
  }
  onError(error) { process.stdout.write(`RUN ERROR: ${error.message ?? error.value}\n`); }
  onEnd(result) {
    const counts = {};
    for (const attempt of this.attempts) counts[attempt.status] = (counts[attempt.status] ?? 0) + 1;
    process.stdout.write(`WORKFLOW RESULT: ${result.status}; attempts=${this.attempts.length}; ${JSON.stringify(counts)}\n`);
  }
}
