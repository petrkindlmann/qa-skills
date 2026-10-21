const { expect } = require('@playwright/test');

function exactRecipient(message, recipient) {
  if (!Array.isArray(message.To)) throw new Error('Mailpit message has no To array');
  return message.To.some(address => typeof address.Address === 'string' &&
    address.Address.toLowerCase() === recipient.toLowerCase());
}

function validateRecipient(recipient) {
  if (!/^[a-z0-9.+_-]+@example\.test$/i.test(recipient)) {
    throw new Error('Use a simple isolated @example.test recipient');
  }
}

function validateBaseURL(baseURL) {
  const url = new URL(baseURL);
  if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:' || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Mailpit URL must be an http://127.0.0.1:<port> origin');
  }
  return url.origin;
}

function createMailpit(api, baseURL, log = () => {}) {
  const base = validateBaseURL(baseURL);
  const requestTimeout = 3000;

  async function json(path) {
    const response = await api.get(base + path, { timeout: requestTimeout });
    log({ event: 'http', method: 'GET', path, status: response.status() });
    if (!response.ok()) throw new Error(`Mailpit HTTP ${response.status()} for ${path}`);
    const data = await response.json();
    if (!data || typeof data !== 'object') throw new Error(`Invalid Mailpit JSON for ${path}`);
    return data;
  }

  async function list(recipient) {
    validateRecipient(recipient);
    const matches = new Map();
    for (let start = 0; start < 1000; start += 50) {
      const query = new URLSearchParams({ query: `to:${recipient}`, start: String(start), limit: '50' });
      const data = await json(`/api/v1/search?${query}`);
      if (!Array.isArray(data.messages) || !Number.isInteger(data.messages_count)) {
        throw new Error('Mailpit search has an invalid messages/messages_count schema');
      }
      for (const summary of data.messages) {
        if (typeof summary.ID !== 'string' || !summary.ID) throw new Error('Mailpit summary has no ID');
        if (exactRecipient(summary, recipient)) matches.set(summary.ID, summary);
      }
      if (start + data.messages.length >= data.messages_count) return [...matches.values()];
      if (!data.messages.length) throw new Error('Mailpit search returned an empty incomplete page');
    }
    throw new Error('Mailpit per-recipient result exceeded the bounded 1000-message scan');
  }

  async function get(id, recipient) {
    if (typeof id !== 'string' || !/^[a-z0-9-]+$/i.test(id)) throw new Error('Expected an explicit message ID');
    if (id === 'latest') throw new Error('The unscoped latest message is forbidden');
    const message = await json(`/api/v1/message/${encodeURIComponent(id)}`);
    if (message.ID !== id || (recipient && !exactRecipient(message, recipient))) {
      throw new Error('Mailpit returned another message or recipient');
    }
    if (typeof message.Subject !== 'string' || typeof message.HTML !== 'string' ||
        typeof message.Text !== 'string' || typeof message.From?.Address !== 'string') {
      throw new Error('Mailpit message detail schema is incomplete');
    }
    return message;
  }

  async function waitForEmail(recipient, { timeout = 5000, intervals = [50, 100, 250], excludeIds = [] } = {}) {
    validateRecipient(recipient);
    const excluded = new Set(excludeIds);
    let found, fatal;
    let attempts = 0;
    await expect.poll(async () => {
      attempts += 1;
      try {
        found = (await list(recipient)).find(message => !excluded.has(message.ID));
        log({ event: 'poll', recipient, attempts, found: found?.ID ?? null });
        return Boolean(found);
      } catch (error) {
        // HTTP/schema errors are infrastructure failures, never silently treated as "not arrived".
        fatal = error;
        return true;
      }
    }, { timeout, intervals, message: `No new email for ${recipient}` }).toBe(true);
    if (fatal) throw fatal;
    const message = await get(found.ID, recipient);
    log({ event: 'captured', recipient, id: message.ID, attempts });
    return message;
  }

  async function headers(id) {
    return json(`/api/v1/message/${encodeURIComponent(id)}/headers`);
  }

  async function deleteOwned(recipient, ids, runId) {
    validateRecipient(recipient);
    if (!Array.isArray(ids)) throw new Error('Cleanup requires an explicit array of message IDs');
    const unique = [...new Set(ids)];
    // An empty body or IDs:[] would delete all Mailpit messages. Never issue that request.
    if (!unique.length) return [];
    if (typeof runId !== 'string' || !runId) throw new Error('Cleanup requires the owning run ID');
    for (const id of unique) {
      const message = await get(id, recipient);
      if (message.To.length !== 1 || (message.Cc?.length ?? 0) || (message.Bcc?.length ?? 0)) {
        throw new Error('Refusing to delete a message shared with other recipients');
      }
      const values = await headers(id);
      const key = Object.keys(values).find(name => name.toLowerCase() === 'x-test-run');
      if (!key || !Array.isArray(values[key]) || values[key].length !== 1 || values[key][0] !== runId) {
        throw new Error('Refusing cleanup without the matching X-Test-Run owner');
      }
    }
    const response = await api.delete(base + '/api/v1/messages', {
      data: { IDs: unique }, timeout: requestTimeout,
    });
    log({ event: 'delete-owned', recipient, ids: unique, status: response.status() });
    if (!response.ok()) throw new Error(`Mailpit cleanup HTTP ${response.status()}`);
    for (const id of unique) {
      const missing = await api.get(`${base}/api/v1/message/${encodeURIComponent(id)}`, { timeout: requestTimeout });
      if (missing.status() !== 404) throw new Error(`Message ${id} still exists after cleanup`);
    }
    return unique;
  }

  async function cleanupRecipient(recipient, runId) {
    const messages = await list(recipient);
    return deleteOwned(recipient, messages.map(message => message.ID), runId);
  }

  return { list, get, waitForEmail, headers, deleteOwned, cleanupRecipient };
}

async function extractResetLink(page, message, expectedOrigin) {
  const origin = new URL(expectedOrigin).origin;
  const hrefs = await page.evaluate(html => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    return [...parsed.querySelectorAll('a[href]')].map(anchor => anchor.getAttribute('href'));
  }, message.HTML);
  const links = new Set();
  for (const href of hrefs) {
    let url;
    try { url = new URL(href); } catch { continue; }
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
    if (url.pathname !== '/reset' || url.searchParams.getAll('token').length !== 1 ||
        !url.searchParams.get('token')?.trim()) continue;
    links.add(url.href);
  }
  if (links.size !== 1) throw new Error('Expected exactly one reset link at the approved origin with one nonempty token');
  return [...links][0];
}

module.exports = { createMailpit, extractResetLink };
