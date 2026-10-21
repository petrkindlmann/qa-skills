import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snippet } from '../examples/snippets.mjs';
import { runBounded } from '../workflows/support/process.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const main = 'skills/playwright-automation/SKILL.md';
const fixtures = 'skills/playwright-automation/references/fixtures-and-projects.md';
let server;
let origin;
let directory;

// A real HTTP login service gives the documented recipes a small public contract.
// It does not inject cookies into the browser or fulfill Playwright routes.
before(async () => {
  await mkdir(path.join(root, 'tests/workflows/artifacts/recipes'), { recursive: true });
  directory = await mkdtemp(path.join(root, 'tests/workflows/artifacts/recipes/run-'));
  server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const authenticated = /session=(user|admin)/.exec(request.headers.cookie ?? '')?.[1];
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (url.pathname === '/login') {
      response.end('<form action="/session" method="post"><label>Email<input name="email"></label><label>Password<input name="password" type="password"></label><button>Sign in</button></form>');
    } else if (url.pathname === '/session' && request.method === 'POST') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const fields = new URLSearchParams(body);
      if (fields.get('password') !== 'local-secret') { response.statusCode = 401; response.end('Invalid login'); return; }
      const role = fields.get('email') === 'admin@example.test' ? 'admin' : 'user';
      response.writeHead(303, { 'Set-Cookie': `session=${role}; HttpOnly; SameSite=Lax; Path=/`, Location: role === 'admin' ? '/admin/home' : '/dashboard' });
      response.end();
    } else if (!authenticated) {
      response.statusCode = 401;
      response.end('<h1>Sign in required</h1>');
    } else if (url.pathname.startsWith('/admin/') && authenticated !== 'admin') {
      response.statusCode = 403;
      response.end('<h1>Forbidden</h1>');
    } else {
      response.end(`<h1>${authenticated === 'admin' ? 'Admin workspace' : 'User workspace'}</h1>`);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(resolve => server?.close(resolve)); });

async function runRecipe(name, files, config, extra = []) {
  const cwd = path.join(directory, name);
  for (const [filename, contents] of Object.entries({ ...files, 'playwright.config.ts': config })) {
    await mkdir(path.dirname(path.join(cwd, filename)), { recursive: true });
    await writeFile(path.join(cwd, filename), contents);
  }
  const args = [path.join(root, 'node_modules/playwright/cli.js'), 'test', '--config', 'playwright.config.ts', '--reporter=line', '--workers=1', '--retries=0', ...extra];
  const result = await runBounded({ command: process.execPath, args, cwd, timeoutMs: 30000, env: {
      ...process.env, CI: '', BASE_URL: origin,
      TEST_USER_EMAIL: 'user@example.test', TEST_USER_PASSWORD: 'local-secret',
      ADMIN_EMAIL: 'admin@example.test', ADMIN_PASSWORD: 'local-secret',
      USER_EMAIL: 'user@example.test', USER_PASSWORD: 'local-secret',
  } });
  result.output = result.log;
  await writeFile(path.join(cwd, 'execution.log'), JSON.stringify({ command: [process.execPath, ...args], ...result }, null, 2));
  assert.equal(result.code, 0, `${name} failed (signal ${result.signal}); ${result.output}`);
  assert.equal(result.timedOut, false);
  assert.match(result.output, /\d+ passed/);
  return result;
}

const launchOptions = JSON.stringify(process.env.QA_BROWSER_EXECUTABLE
  ? { executablePath: process.env.QA_BROWSER_EXECUTABLE } : {});
function ordinaryConfig() {
  return `import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './e2e', testMatch: '**/*.spec.ts', timeout: 8000,
expect: { timeout: 1500 }, use: { baseURL: ${JSON.stringify(origin)}, launchOptions: ${launchOptions} } });`;
}
const userTest = `import { test, expect } from '@playwright/test';
test('saved session opens an authenticated page', async ({ page }) => {
  const response = await page.goto('/dashboard');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'User workspace' })).toBeVisible();
});`;

test('healthy HTTP control authenticates through the actual browser and runner', async () => {
  const result = await runRecipe('control', {
    'e2e/control.spec.ts': `import { test, expect } from '@playwright/test';
test('real login', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('user@example.test');
  await page.getByLabel('Password').fill('local-secret');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\\/dashboard$/);
  await expect(page.getByRole('heading')).toHaveText('User workspace');
});`,
  }, ordinaryConfig());
  assert.match(result.output, /1 passed/);
});

test('documented starter discovers its setup and loads the resulting session', async () => {
  const original = snippet(main, 'const isCI');
  await runRecipe('starter', {
    'documented.config.ts': original,
    'e2e/global-setup.ts': snippet(main, "setup('authenticate as default user'"),
    'e2e/tests/auth.spec.ts': userTest,
  }, `import config from './documented.config';
export default { ...config, webServer: undefined, timeout: 8000, expect: {timeout:1500},
  use: { ...config.use, baseURL: ${JSON.stringify(origin)}, launchOptions: ${launchOptions} } };`, ['--project=chromium']);
});

test('documented worker fixture authenticates the builtin page without explicit fixture use', async () => {
  await runRecipe('worker', {
    'e2e/fixture.ts': snippet(fixtures, 'type WorkerFixtures'),
    'e2e/auth.spec.ts': userTest.replace("import { test, expect } from '@playwright/test';", "import { test } from './fixture';\nimport { expect } from '@playwright/test';"),
  }, ordinaryConfig());
});

test('documented worker login supports a configured relative URL and writes usable state', async () => {
  await runRecipe('worker-explicit', {
    'e2e/fixture.ts': snippet(fixtures, 'type WorkerFixtures'),
    'e2e/auth.spec.ts': userTest.replace("import { test, expect } from '@playwright/test';", "import { test } from './fixture';\nimport { expect } from '@playwright/test';")
      .replace('async ({ page })', 'async ({ page, authState })'),
  }, ordinaryConfig());
});

test('documented role fixtures authenticate both roles and isolate their cookies', async () => {
  await runRecipe('roles', {
    'e2e/fixture.ts': snippet(fixtures, 'type AuthFixtures'),
    'e2e/roles.spec.ts': `import { test, expect } from './fixture';
test('separate roles', async ({ adminPage, userPage }) => {
  await adminPage.goto('/admin/home');
  await userPage.goto('/dashboard');
  await expect(adminPage.getByRole('heading')).toHaveText('Admin workspace');
  await expect(userPage.getByRole('heading')).toHaveText('User workspace');
  const denied = await userPage.goto('/admin/home');
  expect(denied?.status()).toBe(403);
  await expect(userPage.getByRole('heading')).toHaveText('Forbidden');
});`,
  }, ordinaryConfig());
});
