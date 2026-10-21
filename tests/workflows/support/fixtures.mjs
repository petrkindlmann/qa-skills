import { test as base, expect } from '@playwright/test';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { startMailpit, startShop, startTodo } from './runtime.mjs';

export const test = base.extend({
  mailpit: [async ({}, use, workerInfo) => {
    const directory = path.join(workerInfo.project.outputDir, `mailpit-${workerInfo.workerIndex}-${randomUUID()}`);
    const service = await startMailpit(directory);
    try { await use(service); } finally { await service.stop(); }
  }, { scope: 'worker' }],
  app: async ({ mailpit }, use, testInfo) => {
    const service = await startShop({ directory: testInfo.outputPath('shop'), smtpPort: mailpit.smtpPort });
    try { await use(service); } finally { await service.stop(); }
  },
  todo: [async ({}, use, workerInfo) => {
    const directory = path.join(workerInfo.project.outputDir, `todo-${workerInfo.workerIndex}-${randomUUID()}`);
    const service = await startTodo(directory);
    try { await use(service); } finally { await service.stop(); }
  }, { scope: 'worker' }],
});

export { expect };
