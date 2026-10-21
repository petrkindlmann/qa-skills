import { test as base, expect } from '../../../../support/fixtures.mjs';
import { openScope } from './scope.mjs';

// `scopes` is the dynamic data fixture of this suite. It hands a test its own
// scopes, closes their HTTP contexts afterwards, and attaches every ledger to
// the test result so what a test created is on record even without deletion.
export const test = base.extend({
  scopes: async ({}, use, testInfo) => {
    const opened = [];
    const api = {
      async open({ app, mailpit, user, name, seed }) {
        const scope = await openScope({ app, mailpit, user, name, seed });
        opened.push(scope);
        return scope;
      },
      all: () => [...opened],
    };
    await use(api);
    for (const scope of opened) {
      await testInfo.attach(`ledger-${scope.name}.json`, {
        contentType: 'application/json',
        body: JSON.stringify(scope.ledger, null, 2),
      });
      await scope.close();
    }
  },
});

export { expect };
