import { createServer } from 'node:net';
import axe from '@axe-core/playwright';
import { startShop } from '../../support/runtime.mjs';

// The Shop request helpers already exist for the baseline suite; reuse them rather than
// carrying a second copy of the contract (same pattern as importing todoUI from baseline-todo).
export { test, expect, json, basket, state, payment, signature, deliver } from '../baseline-shop/helpers.mjs';
import { expect } from '../baseline-shop/helpers.mjs';

// The package ships CommonJS; Node's ESM default import is module.exports.
const AxeBuilder = axe.default ?? axe;

export const adminHeaders = app => ({ 'X-Test-Admin-Key': app.testAdminKey });

export async function sessionCookie(context) {
  const cookies = (await context.storageState()).cookies.filter(cookie => cookie.name === 'shop_session');
  expect(cookies).toHaveLength(1);
  expect(cookies[0].value.length).toBeGreaterThan(20);
  return cookies[0].value;
}

// Workflow adapter of the documented helper, with the same target/readiness contract.
export async function scanAccessibility(page, testInfo, options) {
  if (!options?.expectedURL || typeof options.ready !== 'function') {
    throw new Error('Accessibility scan requires expectedURL and an application readiness assertion');
  }
  await expect(page).toHaveURL(options.expectedURL);
  await options.ready();
  const { label, tags, exclude = [], disableRules = [] } = options;
  let builder = new AxeBuilder({ page }).withTags(tags ?? ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
  for (const selector of exclude) builder = builder.exclude(selector);
  if (disableRules.length) builder = builder.disableRules(disableRules);
  const results = await builder.analyze();
  await testInfo.attach(`a11y-results-${label ?? 'page'}`, {
    body: JSON.stringify(results, null, 2), contentType: 'application/json',
  });
  // A scan that evaluated nothing is not a clean page.
  expect(results.passes.length + results.violations.length + results.incomplete.length, 'axe evaluated no rules').toBeGreaterThan(0);
  return results.violations.map(violation => ({
    rule: violation.id, impact: violation.impact, description: violation.description,
    helpUrl: violation.helpUrl, elements: violation.nodes.map(node => node.html).slice(0, 5),
  }));
}

export async function checkAccessibility(page, testInfo, options) {
  const violations = await scanAccessibility(page, testInfo, options);
  expect(violations, `${violations.length} a11y violations on ${options.label ?? 'page'}:\n${JSON.stringify(violations, null, 2)}`)
    .toHaveLength(0);
}

// A loopback port that nothing listens on: the kernel refuses connections immediately.
export async function closedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

// A Shop whose SMTP target is unreachable. Callers own stop().
export async function startShopWithoutMail(testInfo) {
  return startShop({ directory: testInfo.outputPath('shop-no-mail'), smtpPort: await closedPort() });
}
