const { defineConfig } = require('@playwright/test');
const path = require('node:path');

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: 'mailpit.spec.cjs',
  fullyParallel: true,
  workers: 4,
  retries: 0,
  timeout: 30000,
  globalTimeout: 180000,
  expect: { timeout: 5000 },
  outputDir: process.env.MAILPIT_OUTPUT_DIR || path.join(__dirname, 'artifacts', 'test-results'),
  reporter: [['list'], ['json', { outputFile: process.env.MAILPIT_JSON_REPORT || path.join(__dirname, 'artifacts', 'results.json') }]],
  use: {
    headless: true,
    launchOptions: process.env.QA_BROWSER_EXECUTABLE ? { executablePath: process.env.QA_BROWSER_EXECUTABLE } : {},
    trace: 'retain-on-failure', screenshot: 'only-on-failure',
  },
});
