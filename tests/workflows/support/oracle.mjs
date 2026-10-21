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
      const originalStack = error.stack;
      error.message = `${marker}\n${error.message}`;
      error.stack = `${error.name}: ${error.message}\n${originalStack?.split('\n').slice(1).join('\n') ?? ''}`;
      test.info().annotations.push({ type: 'qa-oracle-failure', description: JSON.stringify({
        schemaVersion: 1, id, matcher, token, runId: process.env.QA_MATRIX_RUN_ID ?? null,
      }) });
    }
    throw error;
  }
}
