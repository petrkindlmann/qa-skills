// The shipped retryAfterLostReply against the official MCP TypeScript SDK client and server.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadFunctions } from '../../../../tests/examples/snippets.mjs';

const { retryAfterLostReply } = loadFunctions('skills/api-testing/references/lost-reply-retry.md', 'function retryAfterLostReply(',
  ['startReplyDroppingProxy', 'retryAfterLostReply'], { http, https });

async function scenario(label, mode, { key = false, restart = false } = {}) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-notes-')), 'notes.jsonl');
  let child, port = 0;
  const start = () => new Promise((resolve, reject) => {
    child = spawn('node', ['server.mjs', file, mode, String(port)], { cwd: import.meta.dirname, stdio: ['ignore', 'pipe', 'inherit'] });
    child.stdout.on('data', data => { const match = /listening (\d+)/.exec(String(data)); if (match) { port = Number(match[1]); resolve(); } });
    child.on('error', reject);
  });
  const stop = () => new Promise(resolve => { child.once('exit', resolve); child.kill(); });
  await start();

  const args = { text: `lost-reply ${label}`, ...(key ? { idempotency_key: 'k-7f3a' } : {}) };
  // What an agent host does: connect, call the tool, read the result.
  const callTool = async baseUrl => {
    const client = new Client({ name: 'agent', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    try {
      await client.connect(transport);
      const result = await client.callTool({ name: 'create_note', arguments: args });
      return result.content[0].text;
    } finally {
      await client.close().catch(() => {});
    }
  };
  let lostOnce = false;
  const outcome = await retryAfterLostReply({
    target: `http://127.0.0.1:${port}`,
    send: callTool,
    countEffects: async () => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0,
    drop: exchange => !lostOnce && /"method":"tools\/call"/.test(exchange.requestBody) && (lostOnce = true),
    restart: restart ? async () => { await stop(); await start(); } : null,
  });
  await stop();
  console.log(`${label.padEnd(44)} ${outcome.verdict.padEnd(12)} effects=${outcome.effects ?? '-'} clientRetried=${outcome.clientRetried ?? '-'} result=${JSON.stringify(outcome.result ?? null)} retryError=${outcome.retryError?.message ?? null}`);
  if (outcome.verdict === 'inconclusive') console.log(`   ${outcome.reason}`);
  if (outcome.lost) console.log(`   lost reply: HTTP ${outcome.lost.status} ${outcome.lost.body.replace(/\s+/g, ' ').slice(0, 130)}`);
  return outcome;
}

await scenario('tool as written, agent calls it again', 'plain');
await scenario('agent sends idempotency_key, tool ignores it', 'plain', { key: true });
await scenario('key remembered in memory', 'memory', { key: true });
await scenario('key remembered in memory, server restarted', 'memory', { key: true, restart: true });
await scenario('key remembered on disk, server restarted', 'durable', { key: true, restart: true });
