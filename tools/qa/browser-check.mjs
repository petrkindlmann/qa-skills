import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

// Observations are published after every phase so a late timeout in the parent keeps
// the HTTP and readiness results instead of replacing them with one blocked record.
export async function browserCheck(input, publish = async () => {}) {
  const started = Date.now();
  const checks = [];
  let phaseStarted = started;
  const record = async check => {
    checks.push({ ...check, durationMs: Date.now() - phaseStarted });
    phaseStarted = Date.now();
    await publish(checks);
  };
  let browser;
  const timeout = input.timeoutMs ?? 15_000;
  const remaining = () => Math.max(1, timeout - (Date.now() - started));
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.QA_BROWSER_EXECUTABLE || undefined, timeout: remaining() });
  } catch (error) {
    await record({ id: 'browser-launch', status: 'blocked', reason: error.message, counts: null });
    return checks;
  }
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();
    page.setDefaultTimeout(remaining());
    page.setDefaultNavigationTimeout(remaining());
    const response = await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: remaining() });
    const httpOkay = response && response.ok();
    const resolvedUrl = page.url();
    await record({ id: 'http-response', status: httpOkay ? 'passed' : 'failed',
      reason: response ? `Main document returned HTTP ${response.status()}.` : 'No main document HTTP response was observed.',
      observed: { status: response?.status() ?? null, url: resolvedUrl, title: await page.title() }, counts: null });
    if (!httpOkay) return checks;
    if (!input.readySelector) {
      await record({ id: 'application-readiness', status: 'blocked', reason: 'No application-owned readiness selector was supplied. Add browser.readySelector or --ready-selector before claiming the page or its accessibility was checked.', counts: null });
      return checks;
    }
    const expectedUrl = new URL(input.expectedUrl ?? input.url).href;
    if (resolvedUrl !== expectedUrl) {
      await record({ id: 'application-readiness', status: 'failed', reason: 'The browser reached a different URL from the configured target.', observed: { expectedUrl, actualUrl: resolvedUrl }, counts: null });
      return checks;
    }
    try {
      await page.locator(input.readySelector).first().waitFor({ state: 'visible', timeout: remaining() });
      if (page.url() !== expectedUrl) throw new Error('The page navigated away while waiting for application readiness.');
      const content = await page.locator(input.readySelector).first().evaluate(element => ({ text: element.textContent?.trim() ?? '', children: element.childElementCount, tag: element.tagName }));
      if (!content.text && !content.children && !['INPUT', 'BUTTON', 'IMG', 'CANVAS', 'VIDEO', 'SELECT', 'TEXTAREA'].includes(content.tag)) {
        throw new Error('The readiness element has no content. Choose a meaningful application-owned state.');
      }
      await record({ id: 'application-readiness', status: 'passed', reason: 'The expected URL and visible application-owned readiness element were observed.', observed: { url: page.url(), selector: input.readySelector }, counts: null });
    } catch (error) {
      await record({ id: 'application-readiness', status: 'failed', reason: `Application readiness was not observed: ${error.message}`, counts: null });
      return checks;
    }
    if (input.accessibility !== false) {
      // axe has no deadline of its own; race it against what is left of the budget so an
      // overrun becomes an incomplete scan rather than a lost HTTP and readiness result.
      const scan = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      scan.catch(() => {});
      let timer;
      const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('The accessibility scan exceeded the remaining browser budget.')), remaining()); });
      let result;
      try { result = await Promise.race([scan, deadline]); }
      catch (error) {
        await record({ id: 'accessibility', status: 'incomplete', reason: error.message, counts: null });
        return checks;
      } finally { clearTimeout(timer); }
      const evaluated = result.passes.length + result.violations.length + result.incomplete.length;
      const status = result.violations.length ? 'failed' : !evaluated || result.incomplete.length ? 'incomplete' : 'passed';
      await record({ id: 'accessibility', status, reason: result.violations.length ? `${result.violations.length} accessibility rule violations were reported.` : result.incomplete.length ? `${result.incomplete.length} accessibility rules need human review.` : evaluated ? 'No violations were reported by the configured automated rules.' : 'No accessibility rules evaluated the page.', counts: null,
        observed: { engine: result.testEngine, evaluatedRules: evaluated, passedRules: result.passes.length,
          needsReview: result.incomplete.map(item => ({ id: item.id, impact: item.impact, help: item.help })),
          violations: result.violations.map(item => ({ id: item.id, impact: item.impact, help: item.help,
            nodes: item.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) })) } });
    }
    return checks;
  } catch (error) {
    await record({ id: 'browser-observation', status: 'blocked', reason: error.message, counts: null });
    return checks;
  } finally { await browser.close(); }
}

if (process.env.QA_BROWSER_INPUT && process.env.QA_BROWSER_RESULT) {
  const publish = checks => fs.writeFile(process.env.QA_BROWSER_RESULT, JSON.stringify(checks));
  let result;
  try { result = await browserCheck(JSON.parse(process.env.QA_BROWSER_INPUT), publish); }
  catch (error) { result = [{ id: 'browser-observation', status: 'blocked', reason: error.message, counts: null }]; }
  await publish(result);
}
