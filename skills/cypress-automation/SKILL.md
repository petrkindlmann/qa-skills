---
name: cypress-automation
description: >-
  Build Cypress test suites with component testing, E2E testing, custom commands,
  cy.intercept for network control, Cypress Cloud integration, and TypeScript
  configuration. Covers retry-ability, command queue concepts, and data-driven
  testing with fixtures. Use when: "Cypress," "cy.," "component test," "Cypress Cloud,"
  "cy.intercept."
  Related: ci-cd-integration, visual-testing, unit-testing.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: automation
---

<objective>
Production-grade Cypress test suites in TypeScript. This skill covers the mental model (command queue, retry-ability), project structure, custom commands, network control with `cy.intercept`, component testing, and Cypress Cloud integration.
</objective>

---

## Discovery Questions

Before generating Cypress tests, ask. Check `.agents/qa-project-context.md` first -- if it exists, use it and skip questions already answered there.

1. **Component testing, E2E, or both?** Component testing mounts individual components in isolation. E2E tests the full application through the browser. Most projects need both. Component testing requires a framework-specific mount (React, Vue, Angular, Svelte).
2. **Cypress Cloud?** Cloud provides parallelization, flake detection, analytics, and test replay. If the team uses it, configure the `projectId` and `record` key. If not, everything runs locally or in CI without Cloud.
3. **TypeScript?** Strongly recommended. Cypress supports TypeScript natively since v13. All examples in this skill use TypeScript.
4. **Framework and bundler?** React + Vite, Next.js + Webpack, Vue + Vite, Angular -- component testing configuration depends on this.
5. **Existing test suite or fresh start?** If migrating from another tool, start with the flakiest or most critical tests, not a big-bang rewrite.

---

## Core Principles

### 1. Commands Are Enqueued, Not Executed Immediately

This is the single most important concept in Cypress. Cypress commands (`cy.get`, `cy.click`, `cy.type`) do not execute when called. They are added to a queue and executed serially, asynchronously. You cannot use `async/await` with Cypress commands. You cannot store the return value in a variable.

```typescript
// WRONG -- this looks like synchronous code but it is not
const button = cy.get('[data-testid="submit"]'); // button is a Chainable, not an element
button.click(); // this works only by accident because of chaining

// CORRECT -- chain commands, use .then() for values
cy.get('[data-testid="submit"]').click();

// CORRECT -- when you need a value, use .then() or .as()
cy.get('[data-testid="price"]').invoke('text').then((text) => {
  const price = parseFloat(text.replace('$', ''));
  expect(price).to.be.greaterThan(0);
});
```

### 2. Retry-ability Is Built-In (For Queries, Not Actions)

Cypress automatically retries **queries** (`cy.get`, `cy.find`, `cy.contains`) and **assertions** until they pass or time out. It does **not** retry **actions** (`cy.click`, `cy.type`, `cy.select`). This means:

- `cy.get('.loading').should('not.exist')` will wait for the loading indicator to disappear
- `cy.get('.item').should('have.length', 5)` will wait for 5 items to appear
- `cy.click()` executes once -- if the element is not actionable, it fails

### 3. Network Control with cy.intercept

`cy.intercept` is the most powerful tool in Cypress. It intercepts HTTP requests at the network layer, allowing you to stub responses, wait for requests to complete, and assert on request bodies. Mastering `cy.intercept` is the difference between flaky and stable tests.

### 4. Isolation: Each Test Starts Clean

Every `it()` block runs in a fresh browser state. Cypress clears cookies, localStorage, and sessionStorage between tests by default. Tests must not depend on other tests' state or execution order. Use `beforeEach` hooks for shared setup, not inter-test dependencies.

### 5. Data Attributes for Test Selectors

Use `data-testid`, `data-cy`, or `data-test` attributes for selectors. They are immune to CSS refactors, class name changes, and content localization. Configure the preferred attribute in `cypress.config.ts`.

---

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

### cypress.config.ts

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

---

## Custom Commands

Custom commands encapsulate repeated actions and provide a clean API. Always type them for autocomplete and compile-time safety.

### Defining Commands

```typescript
// cypress/support/commands.ts

// Login command -- avoid UI login in every test
Cypress.Commands.add('login', (email: string, password: string) => {
  cy.session([email, password], () => {
    cy.request({
      method: 'POST',
      url: '/api/auth/login',
      body: { email, password },
    }).then((response) => {
      expect(response.status).to.eq(200);
      window.localStorage.setItem('auth_token', response.body.token);
    });
  });
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

For retryable element lookups, use `Cypress.Commands.addQuery()` (Cypress 12+) instead of `Cypress.Commands.add()` -- custom queries retry automatically like built-in queries.

---

## cy.intercept Patterns

### Stub a Response

```typescript
cy.intercept('GET', '/api/products', {
  statusCode: 200,
  body: { products: [{ id: '1', name: 'Widget', price: 29.99 }] },
}).as('getProducts');

cy.visit('/products');
cy.wait('@getProducts');
cy.getByTestId('product-card').should('have.length', 1);
```

### Spy on Requests (No Stubbing)

```typescript
cy.intercept('POST', '/api/orders').as('createOrder');

cy.getByTestId('place-order').click();
cy.wait('@createOrder').then((interception) => {
  expect(interception.request.body).to.have.property('items');
  expect(interception.request.body.items).to.have.length(2);
  expect(interception.response?.statusCode).to.eq(201);
});
```

### Conditional Responses

```typescript
let callCount = 0;
cy.intercept('GET', '/api/status', (req) => {
  callCount += 1;
  if (callCount <= 2) {
    req.reply({ statusCode: 202, body: { status: 'processing' } });
  } else {
    req.reply({ statusCode: 200, body: { status: 'complete', url: '/download/report.pdf' } });
  }
}).as('pollStatus');
```

### Simulate Network Errors

```typescript
// Simulate server error
cy.intercept('POST', '/api/checkout', { statusCode: 500, body: { error: 'Internal Server Error' } }).as('checkoutFail');

// Simulate network failure
cy.intercept('POST', '/api/checkout', { forceNetworkError: true }).as('networkError');

// Simulate slow response
cy.intercept('GET', '/api/dashboard', (req) => {
  req.reply({
    delay: 5000,
    statusCode: 200,
    body: { widgets: [] },
  });
}).as('slowDashboard');
```

### Modify Real Response

```typescript
cy.intercept('GET', '/api/feature-flags', (req) => {
  req.continue((res) => {
    res.body.flags['new-checkout'] = true;
    res.send();
  });
}).as('featureFlags');
```

### Using Fixture Files

```typescript
// Load response from cypress/fixtures/api-responses/checkout-success.json
cy.intercept('POST', '/api/checkout', { fixture: 'api-responses/checkout-success.json' }).as('checkout');
```

---

## Component Testing

Component testing mounts a single component in a real browser without running the full application. It is faster than E2E and gives more visual feedback than unit tests.

### React Component Test

```tsx
// cypress/component/ProductCard.cy.tsx
import { ProductCard } from '../../src/components/ProductCard';

describe('ProductCard', () => {
  const product = { id: '1', name: 'Widget', price: 29.99, image: '/widget.png' };

  it('renders product information', () => {
    cy.mount(<ProductCard product={product} onAddToCart={cy.stub()} />);

    cy.contains('Widget').should('be.visible');
    cy.contains('$29.99').should('be.visible');
    cy.get('img').should('have.attr', 'src', '/widget.png');
  });

  it('calls onAddToCart with product id when button clicked', () => {
    const onAddToCart = cy.stub().as('addToCart');
    cy.mount(<ProductCard product={product} onAddToCart={onAddToCart} />);

    cy.contains('button', 'Add to Cart').click();
    cy.get('@addToCart').should('have.been.calledOnceWith', '1');
  });

  it('shows out of stock state', () => {
    cy.mount(<ProductCard product={{ ...product, inStock: false }} onAddToCart={cy.stub()} />);

    cy.contains('button', 'Add to Cart').should('be.disabled');
    cy.contains('Out of Stock').should('be.visible');
  });
});
```

For Vue, use `cy.mount(Component, { props: { ... } })` with `cy.spy()` for event assertions. The pattern mirrors React but uses Vue's prop/event conventions.

---

## Data-Driven Testing with Fixtures

### Static Fixture Data

```typescript
// Load from cypress/fixtures/users.json
describe('Role-based access', () => {
  beforeEach(function () {
    cy.fixture('users').as('users');
  });

  it('admin sees admin panel', function () {
    const admin = this.users.find((u: { role: string }) => u.role === 'admin');
    cy.login(admin.email, admin.password);
    cy.visit('/admin');
    cy.getByTestId('admin-panel').should('be.visible');
  });
});
```

### Dynamic Test Data via cy.task

Use `cy.task` for operations that need Node.js context (API calls, database seeding):

```typescript
// cypress.config.ts -- register tasks in setupNodeEvents
on('task', {
  async seedTestUser(role: string) {
    const response = await fetch(`${config.env.API_URL}/test/seed-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    return response.json();
  },
});

// In test:
beforeEach(() => {
  cy.task('seedTestUser', 'admin').then((user) => {
    cy.login(user.email, user.password);
  });
});
```

### Environment-Specific Configuration

```typescript
// Run with: npx cypress run --env ENVIRONMENT=staging
setupNodeEvents(on, config) {
  const envConfig = { local: { baseUrl: 'http://localhost:3000' }, staging: { baseUrl: 'https://staging.example.com' } };
  return { ...config, ...envConfig[config.env.ENVIRONMENT || 'local'] };
}
```

---

## CI Integration

### With Cypress Cloud

Set `projectId` in `cypress.config.ts`. Run with `npx cypress run --record --key $CYPRESS_RECORD_KEY`. Cloud provides parallelization, flake detection, test replay, and analytics.

**Cypress AI** (paid Cloud add-on, GA 2026) ships Auto Heal (selector self-healing), AI Test Generation, and AI Bug Triage. Overlaps directly with `test-reliability` (selector healing) and `ai-bug-triage` (failure clustering). Worth flagging during framework selection if your team is already on Cypress Cloud — buying the add-on may be cheaper than building the equivalent.

> **Versions:** Current is Cypress 15.x (Node 20+ baseline). Cypress 14 dropped Node 16/18; Cypress 15 dropped Node 20 EOL paths. The `cypress-io/github-action` is at v6 (current LTS) — pin to a specific tag and verify v7 readiness before bumping.

```yaml
# GitHub Actions -- Cloud parallelization
jobs:
  cypress:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        containers: [1, 2, 3, 4]
    steps:
      - uses: actions/checkout@v4
      - uses: cypress-io/github-action@v6
        with:
          record: true
          parallel: true
          group: 'E2E Tests'
        env:
          CYPRESS_RECORD_KEY: ${{ secrets.CYPRESS_RECORD_KEY }}
```

### Without Cloud

```yaml
# GitHub Actions -- standalone
steps:
  - uses: actions/checkout@v4
  - uses: cypress-io/github-action@v6
    with:
      build: npm run build
      start: npm run start
      wait-on: 'http://localhost:3000'
      browser: chrome
  - uses: actions/upload-artifact@v4
    if: failure()
    with:
      name: cypress-artifacts
      path: |
        cypress/screenshots
        cypress/videos
```

---

## Anti-Patterns

### cy.wait(milliseconds) for Synchronization

```typescript
// BAD
cy.get('[data-testid="submit"]').click();
cy.wait(3000);

// GOOD -- wait for network
cy.intercept('POST', '/api/submit').as('submit');
cy.get('[data-testid="submit"]').click();
cy.wait('@submit');
```

Only acceptable for throttle/debounce testing. For everything else, wait for a network alias or a DOM assertion.

### Conditional Testing Based on DOM State

Do not check `$body.find(selector).length > 0` to conditionally act. Tests should control state deterministically. Stub the API that controls the conditional element.

### CSS Selectors Over Data Attributes

`cy.get('.btn.btn-primary > span')` breaks on every CSS refactor. Use `cy.getByTestId('submit')` or `cy.contains('button', 'Place Order')`.

### Sharing State Between Tests

Module-level `let orderId` set in one `it()` and read in another creates order-dependent, parallel-unsafe tests. Each test must set up its own data via `cy.request` or `cy.task` in `beforeEach`.

### Testing Third-Party Iframes

Do not reach into Stripe/PayPal iframes. Mock the payment API with `cy.intercept` and assert on your own UI.

### Not Using cy.session() for Login

UI-based login in every test is slow and fragile. Use `cy.session()` (shown in custom commands above) to authenticate via API once and cache the session.

### Running All Tests Serially in CI

Parallelize once the suite exceeds 5 minutes. Use Cypress Cloud, `cypress-split`, or manual sharding across CI matrix jobs.

---

## Done When

- `cypress.config.ts` exists with a correct `baseUrl` (not hardcoded to `localhost` in CI) and explicit `viewportWidth`/`viewportHeight`
- Custom commands extracted to `cypress/support/commands.ts` with TypeScript declarations in `cypress/support/index.d.ts`
- `cy.intercept` used for all API dependencies that could be slow or unreliable — no tests relying on real network calls for determinism
- Tests pass in CI with either a recorded Cypress Cloud run (parallel) or local video/screenshot artifacts uploaded on failure
- Component tests co-located with source files (e.g. `ProductCard.cy.tsx` next to `ProductCard.tsx`) rather than in a separate top-level directory

## Related Skills

- **ci-cd-integration** -- Pipeline templates for running Cypress in GitHub Actions and GitLab CI, including parallelization and artifact management.
- **visual-testing** -- Visual regression testing approaches that complement Cypress functional tests; Cypress does not have built-in visual comparison.
- **unit-testing** -- Unit tests with Jest/Vitest for logic that does not need a browser; Cypress component tests fill the gap between unit and E2E.
- **test-data-management** -- Strategies for seeding, managing, and cleaning up test data used by Cypress tests.
- **test-reliability** -- Patterns for fixing flaky Cypress tests, retry strategies, and stability metrics.
- **qa-project-context** -- The project context file that captures framework choices, CI platform, and testing conventions.
