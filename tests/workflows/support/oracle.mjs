import { randomUUID } from 'node:crypto';
import { test } from '@playwright/test';

// Mark only the contract assertion chosen before the fault run. A setup exception,
// failed click, SQL error, or a different matcher cannot become this oracle.
export async function oracle(id, matcher, assertion) {
  try {
    return await assertion();
  } catch (error) {
    if (error?.matcherResult?.name === matcher && typeof error.matcherResult.pass === 'boolean') {
      const token = randomUUID();
      const marker = `QA_ORACLE:${id}:${token}`;
      const originalMessage = error.message;
      const originalStack = error.stack ?? '';
      // Playwright messages span several lines; keep only the frames after the full header.
      const header = `${error.name}: ${originalMessage}`;
      const frames = originalStack.startsWith(header) ? originalStack.slice(header.length) : `\n${originalStack.split('\n').slice(1).join('\n')}`;
      error.message = `${marker}\n${originalMessage}`;
      error.stack = `${error.name}: ${error.message}${frames}`;
      // Outside a running test (hooks, fixtures) there is no record to annotate. The
      // marker still names the assertion; the matrix treats such a run as unverified.
      let info = null;
      try { info = test.info(); } catch {}
      info?.annotations.push({ type: 'qa-oracle-failure', description: JSON.stringify({
        schemaVersion: 1, id, matcher, token, runId: process.env.QA_MATRIX_RUN_ID ?? null,
      }) });
    }
    throw error;
  }
}
