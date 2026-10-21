// Shared plumbing for the Shop synthetic probes: budgets, warning semantics,
// result tagging and a recipient-scoped Mailpit client. Probe bodies live in
// probes.mjs; the *.probe.spec.mjs files only wire fixtures to them.
import { expect } from '../../../support/fixtures.mjs';
import { oracle } from '../../../support/oracle.mjs';

// Every number here comes from tests/workflows/fixture-app-contract.md.
export const CONTRACT = {
  build: 'shop-lab-v1',
  healthBudgetMs: 500,
  catalog: { 'TEA-50': 1200, 'CUP-01': 1800 },
  currency: 'EUR',
  resetSubject: 'Reset your Shop password',
  resetPath: '/reset-password?token=',
};

// Fixture startup (a fresh Shop process plus a browser context) is outside the
// probe's own wall clock, so the harness timeout gets this allowance on top.
const FIXTURE_ALLOWANCE_MS = 10_000;

export function startProbe(testInfo, { name, route, wallClockMs }) {
  const startedAt = performance.now();
  const result = { probe: name, route, wallClockBudgetMs: wallClockMs, timings: {}, notes: {}, warnings: [] };
  testInfo.setTimeout(wallClockMs + FIXTURE_ALLOWANCE_MS);
  testInfo.annotations.push({ type: 'probe', description: name }, { type: 'alert-route', description: route });

  function warn(message) {
    result.warnings.push(message);
    testInfo.annotations.push({ type: 'warning', description: message });
    console.warn(`[warning] ${name}: ${message}`);
  }

  return {
    warn,
    note(key, value) { result.notes[key] = value; },
    async timed(label, fn) {
      const start = performance.now();
      const value = await fn();
      const ms = Math.round(performance.now() - start);
      result.timings[label] = ms;
      return { value, ms };
    },
    // Hard budget fails the probe; the warning line only annotates it. An oracleId marks the
    // same assertion for the lab's fault matrix (post-authoring edit, no semantic change).
    async budget(label, ms, { warnAt, failAt, oracleId }) {
      testInfo.annotations.push({ type: 'timing', description: `${label}: ${ms} ms (warn > ${warnAt}, fail > ${failAt})` });
      const check = () => expect(ms, `${label} took ${ms} ms, over the hard budget of ${failAt} ms`).toBeLessThanOrEqual(failAt);
      if (oracleId) await oracle(oracleId, 'toBeLessThanOrEqual', check); else check();
      if (ms > warnAt) warn(`${label} took ${ms} ms, above the ${warnAt} ms warning line`);
    },
    async finish() {
      result.wallClockMs = Math.round(performance.now() - startedAt);
      result.status = testInfo.errors.length ? 'failed' : 'passed';
      await testInfo.attach('probe-result.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
      expect.soft(result.wallClockMs, `probe wall clock ${result.wallClockMs} ms exceeded ${wallClockMs} ms`)
        .toBeLessThanOrEqual(wallClockMs);
    },
  };
}

export async function json(response, label) {
  const text = await response.text();
  try { return JSON.parse(text); }
  catch { throw new Error(`${label}: expected JSON, got ${response.status()} ${text.slice(0, 200)}`); }
}

// Mailpit access scoped to one recipient. Listing filters on the exact To
// address and deletion only ever takes explicit message IDs; an empty ID list
// would wipe the whole inbox, so it is refused.
export function mailbox(request, mailpitURL, recipient) {
  const base = new URL(mailpitURL).origin;
  const wanted = recipient.toLowerCase();
  const addressedToRecipient = message => Array.isArray(message.To)
    && message.To.some(address => address.Address?.toLowerCase() === wanted);

  return {
    async list() {
      const query = new URLSearchParams({ query: `to:${recipient}`, start: '0', limit: '50' });
      const response = await request.get(`${base}/api/v1/search?${query}`, { timeout: 3000 });
      expect(response.status(), 'Mailpit search').toBe(200);
      const data = await json(response, 'Mailpit search');
      expect(Array.isArray(data.messages), 'Mailpit search schema').toBe(true);
      return data.messages.filter(addressedToRecipient);
    },
    async message(id) {
      const response = await request.get(`${base}/api/v1/message/${encodeURIComponent(id)}`, { timeout: 3000 });
      expect(response.status(), `Mailpit message ${id}`).toBe(200);
      const message = await json(response, 'Mailpit message');
      expect(message.ID).toBe(id);
      expect(addressedToRecipient(message), 'message belongs to the probe recipient').toBe(true);
      return message;
    },
    async remove(ids) {
      const unique = [...new Set(ids)];
      if (!unique.length) throw new Error('refusing a Mailpit delete without explicit IDs');
      const response = await request.delete(`${base}/api/v1/messages`, { data: { IDs: unique }, timeout: 3000 });
      expect(response.status(), 'Mailpit delete').toBe(200);
      const remaining = (await this.list()).map(message => message.ID).filter(id => unique.includes(id));
      expect(remaining, 'captured messages still present after cleanup').toEqual([]);
    },
  };
}
