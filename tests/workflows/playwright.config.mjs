import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const output = process.env.QA_WORKFLOW_OUTPUT ?? path.join(here, 'artifacts', 'current');
const executablePath = process.env.QA_BROWSER_EXECUTABLE;
const generated = path.join(here, 'generated');
const testDir = path.resolve(here, process.env.QA_WORKFLOW_SUITE ?? generated);
// The whole generated tree is the released suite set that the final controls matrix counts.
// Campaign-3 suites and the with-versus-without takes are scored by their own matrix phase
// and by run-experiment.mjs; run them by pointing QA_WORKFLOW_SUITE at their folder.
const separatelyScored = ['campaign3/**', 'experiment/**'];

export default defineConfig({
  testDir,
  testMatch: '**/*.spec.mjs',
  testIgnore: testDir === generated ? separatelyScored : [],
  outputDir: path.join(output, 'test-results'),
  fullyParallel: true,
  forbidOnly: true,
  workers: 2,
  retries: 0,
  timeout: 30000,
  expect: { timeout: 4000 },
  reporter: [
    [path.join(here, 'reporters', 'minimal.mjs')],
    ['json', { outputFile: path.join(output, 'verbose.json') }],
    ['html', { outputFolder: path.join(output, 'html'), open: 'never' }],
  ],
  use: {
    ...devices['Desktop Chrome'],
    viewport: process.env.QA_WORKFLOW_VIEWPORT === 'mobile'
      ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    launchOptions: executablePath ? { executablePath } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 8000,
    navigationTimeout: 10000,
  },
});
