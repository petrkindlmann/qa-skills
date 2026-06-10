# Cypress Config, Project Structure, and Custom Commands

Runnable scaffolding for a Cypress + TypeScript project. The mental model, decision prose, and principles live in `SKILL.md`; this file holds the implementations.

## Project Structure

```
project-root/
├── cypress.config.ts
├── cypress/
│   ├── e2e/                    # E2E test specs, organized by feature
│   ├── component/              # Component test specs (*.cy.tsx)
│   ├── fixtures/               # Static test data (JSON), including api-responses/
│   ├── support/
│   │   ├── commands.ts         # Custom commands
│   │   ├── e2e.ts              # E2E support file
│   │   ├── component.ts        # Component support file
│   │   └── index.d.ts          # TypeScript declarations for custom commands
│   └── downloads/              # Git-ignored
├── cypress.env.json            # Git-ignored, environment-specific variables
└── tsconfig.json
```

## cypress.config.ts

```typescript
import { defineConfig } from 'cypress';

export default defineConfig({
  projectId: process.env.CYPRESS_PROJECT_ID, // For Cypress Cloud

  e2e: {
    baseUrl: process.env.CYPRESS_BASE_URL ?? 'http://localhost:3000',
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: 'cypress/support/e2e.ts',
    viewportWidth: 1280,
    viewportHeight: 720,
    defaultCommandTimeout: 10000,
    requestTimeout: 15000,
    responseTimeout: 30000,
    video: false,                    // Enable in CI if needed
    screenshotOnRunFailure: true,
    retries: {
      runMode: 2,                    // Retries in CI (cypress run)
      openMode: 0,                   // No retries in interactive mode
    },
    // experimentalRunAllSpecs is no longer needed — stabilized in Cypress 14;
    // the "Run all specs" tab is the default in 15.x.
    setupNodeEvents(on, config) {
      // Task plugins, code coverage, etc.
      return config;
    },
  },

  component: {
    devServer: {
      framework: 'react',           // 'react' | 'vue' | 'angular' | 'svelte'
      bundler: 'vite',              // 'vite' | 'webpack'
    },
    specPattern: 'cypress/component/**/*.cy.tsx',
    supportFile: 'cypress/support/component.ts',
  },
});
```

Add `"types": ["cypress"]` to `tsconfig.json` compilerOptions and include `"cypress/**/*.ts"` in the `include` array.

## Custom Commands

Custom commands encapsulate repeated actions and provide a clean API. Always type them for autocomplete and compile-time safety.

### Defining Commands

```typescript
// cypress/support/commands.ts

// Login command -- avoid UI login in every test
Cypress.Commands.add('login', (email: string, password: string) => {
  cy.session(
    [email, password],
    () => {
      cy.request({
        method: 'POST',
        url: '/api/auth/login',
        body: { email, password },
      }).then((response) => {
        expect(response.status).to.eq(200);
        window.localStorage.setItem('auth_token', response.body.token);
      });
    },
    {
      // Re-verify the cached session before reusing it. Without validate(),
      // a stale/expired token silently reuses a dead session.
      validate() {
        cy.request('/api/me').its('status').should('eq', 200);
      },
    },
  );
});

// Data attribute selector shorthand
Cypress.Commands.add('getByTestId', (testId: string) => {
  return cy.get(`[data-testid="${testId}"]`);
});

// Assert toast notification appears and disappears
Cypress.Commands.add('shouldShowToast', (message: string) => {
  cy.get('[role="alert"]')
    .should('be.visible')
    .and('contain.text', message);
  cy.get('[role="alert"]').should('not.exist');
});
```

### TypeScript Declarations

```typescript
// cypress/support/index.d.ts

declare namespace Cypress {
  interface Chainable {
    /**
     * Log in via API and cache the session.
     * @example cy.login('user@example.com', 'password123')
     */
    login(email: string, password: string): Chainable<void>;

    /**
     * Select element by data-testid attribute.
     * @example cy.getByTestId('submit-button').click()
     */
    getByTestId(testId: string): Chainable<JQuery<HTMLElement>>;

    /**
     * Assert a toast notification appears with the given message.
     * @example cy.shouldShowToast('Profile updated')
     */
    shouldShowToast(message: string): Chainable<void>;
  }
}
```

### Retryable Custom Queries

For retryable element lookups, use `Cypress.Commands.addQuery()` instead of `Cypress.Commands.add()` -- custom queries retry automatically like built-in queries. The query callback **must** be a non-arrow `function () {}`: Cypress binds `this` to apply the command timeout, and an arrow function silently breaks retry-ability.

```typescript
// cypress/support/commands.ts
Cypress.Commands.addQuery('getByTestId', function (testId: string) {
  const getFn = cy.now('get', `[data-testid="${testId}"]`);
  return (subject) => getFn(subject);
});
```

This is the opposite rule from `cy.intercept` handlers, where an arrow function `(req) => { ... }` is fine -- intercept handlers do not rely on `this`.
