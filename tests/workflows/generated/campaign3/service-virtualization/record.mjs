// Record the Shop's real responses for every step in scenario.mjs. Foreground only:
//   QA_RECORD_WORKDIR=<scratch dir> node tests/workflows/generated/campaign3/service-virtualization/record.mjs
// Starts a real Mailpit and a real Shop, drives the scenario through a Playwright
// APIRequestContext (its cookie jar carries the session) and writes recordings/<step>.json.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { startMailpit, startShop } from '../../../support/runtime.mjs';
import { runScenario, playwrightSender } from './scenario.mjs';

const { request } = createRequire('/Users/petr/projects/qa-skills/package.json')('@playwright/test');
const workdir = process.env.QA_RECORD_WORKDIR ?? path.join(os.tmpdir(), `qa-record-${process.pid}`);
const recordingsDir = fileURLToPath(new URL('./recordings/', import.meta.url));
await mkdir(recordingsDir, { recursive: true });

const mailpit = await startMailpit(path.join(workdir, 'mailpit'));
const shop = await startShop({ directory: path.join(workdir, 'shop'), smtpPort: mailpit.smtpPort });
const api = await request.newContext();
try {
  const recordedAt = new Date().toISOString();
  const health = await (await api.get(shop.baseURL + '/health')).json();
  let count = 0;
  await runScenario({
    send: playwrightSender(api, shop.baseURL), users: shop.users,
    onStep: async (step, req, response) => {
      const cassette = { name: step.name, recordedAt, build: health.build, source: 'live Shop (fixture-app) started by record.mjs',
        request: req, response };
      await writeFile(path.join(recordingsDir, `${step.name}.json`), JSON.stringify(cassette, null, 2) + '\n');
      count++;
      console.log(`${step.name.padEnd(24)} ${req.method} ${req.path} -> ${response.status} ${JSON.stringify(response.body)?.slice(0, 90) ?? ''}`);
    },
  });
  console.log(`recorded ${count} responses at ${recordedAt} from ${shop.baseURL} (build ${health.build})`);
} finally {
  await api.dispose();
  await shop.stop();
  await mailpit.stop();
}
