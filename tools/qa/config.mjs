import fs from 'node:fs/promises';
import path from 'node:path';

export const defaultBudgetMs = 180_000;
const idPattern = /^[a-z][a-z0-9-]{0,63}$/;
const reporters = new Set(['tap', 'playwright-json', 'junit-xml', 'ctrf-json', 'exit-code']);

function assert(condition, message) { if (!condition) throw new Error(message); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function keys(value, allowed, label) {
  for (const key of Object.keys(value)) assert(allowed.includes(key), `Unknown ${label} field: ${key}`);
}
function duration(value, label, max = 900_000) {
  assert(Number.isInteger(value) && value >= 100 && value <= max, `${label} must be an integer between 100 and ${max} ms`);
}
export function httpUrl(value, label = 'url') {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be an absolute HTTP(S) URL`); }
  assert(['http:', 'https:'].includes(url.protocol), `${label} must be an absolute HTTP(S) URL`);
  assert(!url.username && !url.password, `${label} must not contain credentials; use an application test session`);
  return url.href;
}

export function validateConfig(input) {
  assert(object(input), 'QA config must be a JSON object');
  keys(input, ['version', 'goal', 'url', 'budgetMs', 'checks', 'browser'], 'config');
  assert(input.version === 1, 'QA config version must be 1');
  const config = { ...input };
  if (input.goal !== undefined) assert(typeof input.goal === 'string' && input.goal.length <= 10_000, 'goal must be a string of at most 10000 characters');
  if (input.url !== undefined) config.url = httpUrl(input.url);
  if (input.budgetMs !== undefined) duration(input.budgetMs, 'budgetMs', 3_600_000);
  if (input.checks !== undefined) {
    assert(Array.isArray(input.checks) && input.checks.length <= 30, 'checks must be an array of at most 30 checks');
    const ids = new Set();
    config.checks = input.checks.map((check, i) => {
      assert(object(check), `checks[${i}] must be an object`);
      keys(check, ['id', 'command', 'reporter', 'timeoutMs', 'resultFile'], `checks[${i}]`);
      assert(typeof check.id === 'string' && idPattern.test(check.id), `checks[${i}].id must be a lowercase identifier`);
      assert(!/^browser(?:-|$)/.test(check.id), `checks[${i}].id uses the reserved browser namespace`);
      assert(!ids.has(check.id), `Duplicate check id: ${check.id}`); ids.add(check.id);
      assert(Array.isArray(check.command) && check.command.length > 0 && check.command.length <= 100 &&
        check.command.every(arg => typeof arg === 'string' && arg.length > 0 && arg.length <= 32_768 && !arg.includes('\0')),
      `checks[${i}].command must be a nonempty argv array`);
      assert(reporters.has(check.reporter), `checks[${i}].reporter must be tap, playwright-json, junit-xml, ctrf-json, or exit-code`);
      if (check.resultFile !== undefined) {
        assert(['junit-xml', 'ctrf-json'].includes(check.reporter), `checks[${i}].resultFile is read only by the junit-xml and ctrf-json reporters`);
        assert(typeof check.resultFile === 'string' && check.resultFile.length > 0 && check.resultFile.length <= 1024 && !check.resultFile.includes('\0') &&
          !path.isAbsolute(check.resultFile) && !/^[A-Za-z]:/.test(check.resultFile) && !check.resultFile.split(/[\\/]/).includes('..'),
        `checks[${i}].resultFile must be a relative path inside the project`);
      }
      if (check.reporter === 'ctrf-json') assert(check.resultFile !== undefined, `checks[${i}].resultFile is required for ctrf-json; CTRF reporters write a file`);
      if (check.timeoutMs !== undefined) duration(check.timeoutMs, `checks[${i}].timeoutMs`);
      return { ...check, timeoutMs: check.timeoutMs ?? 90_000 };
    });
  }
  if (input.browser !== undefined) {
    assert(object(input.browser), 'browser must be an object');
    keys(input.browser, ['expectedUrl', 'readySelector', 'accessibility', 'timeoutMs'], 'browser');
    if (input.browser.expectedUrl !== undefined) config.browser = { ...input.browser, expectedUrl: httpUrl(input.browser.expectedUrl, 'browser.expectedUrl') };
    if (input.browser.readySelector !== undefined) assert(typeof input.browser.readySelector === 'string' && input.browser.readySelector.trim().length > 0 && input.browser.readySelector.length < 2000, 'browser.readySelector must be a nonempty Playwright selector');
    if (input.browser.accessibility !== undefined) assert(typeof input.browser.accessibility === 'boolean', 'browser.accessibility must be a boolean');
    if (input.browser.timeoutMs !== undefined) duration(input.browser.timeoutMs, 'browser.timeoutMs', 90_000);
  }
  return config;
}

export async function readConfig(project, explicitPath) {
  const filename = explicitPath ? path.resolve(project, explicitPath) : path.join(project, 'qa.config.json');
  let data;
  try {
    const stat = await fs.stat(filename);
    if (stat.size > 1024 * 1024) throw new Error('QA config exceeds 1 MB');
    data = await fs.readFile(filename, 'utf8');
  } catch (error) {
    if (!explicitPath && error.code === 'ENOENT') return { config: { version: 1 }, path: null };
    throw error;
  }
  let config;
  try { config = JSON.parse(data); } catch { throw new Error(`QA config is not valid JSON: ${filename}`); }
  return { config: validateConfig(config), path: filename };
}
