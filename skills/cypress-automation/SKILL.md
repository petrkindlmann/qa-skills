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

## Project Structure & Configuration

Standard layout splits `e2e/`, `component/`, `fixtures/`, and `support/` directories, with `cypress.config.ts` at the root configuring both the `e2e` and `component` runners. Key config choices: `baseUrl` from env (never hardcode for CI), explicit viewport, `retries.runMode: 2` for CI, and the framework/bundler pair under `component.devServer`.

See `references/config-and-commands.md` for the full directory tree, the complete `cypress.config.ts`, and the `tsconfig.json` additions.

---

## Custom Commands

Custom commands encapsulate repeated actions and provide a clean API. Always type them for autocomplete and compile-time safety. Common commands: `login` (via `cy.session` + API, not UI), a `getByTestId` selector shorthand, and assertion helpers like `shouldShowToast`. Declare them in `cypress/support/index.d.ts` so they get autocomplete and compile-time checking.

For retryable element lookups, use `Cypress.Commands.addQuery()` (Cypress 12+) instead of `Cypress.Commands.add()` -- custom queries retry automatically like built-in queries.

See `references/config-and-commands.md` for the full command definitions and their TypeScript declarations.

---

## cy.intercept Patterns

`cy.intercept` covers the full network-control surface:

- **Stub a response** — return canned data with `{ statusCode, body }` and `cy.wait('@alias')`.
- **Spy without stubbing** — `cy.intercept('POST', '/api/orders').as('createOrder')`, then assert on `interception.request.body`.
- **Conditional responses** — drive a closure with `callCount` to simulate polling (202 → 200).
- **Network errors** — `{ statusCode: 500 }`, `{ forceNetworkError: true }`, or `req.reply({ delay })` for slow responses.
- **Modify real responses** — `req.continue((res) => { ...; res.send(); })`.
- **Fixture-backed** — `{ fixture: 'api-responses/checkout-success.json' }`.

Always wait on a network alias or a DOM assertion, never a fixed `cy.wait(ms)`.

See `references/intercept-patterns.md` for runnable code for each of these.

---

## Component Testing

Component testing mounts a single component in a real browser without running the full application. It is faster than E2E and gives more visual feedback than unit tests. Use `cy.mount(<Component .../>)`, pass `cy.stub()`/`cy.spy()` for callbacks, and assert with the same `cy.contains`/`cy.get` chain you use in E2E. For Vue, use `cy.mount(Component, { props: { ... } })`.

See `references/component-and-fixtures.md` for a full React `ProductCard` component-test suite.

---

## Data-Driven Testing with Fixtures

Three layers, depending on where the data comes from:

- **Static fixtures** — `cy.fixture('users').as('users')` for JSON that rarely changes.
- **Dynamic data via `cy.task`** — register Node-side tasks in `setupNodeEvents` for API calls or DB seeding that must run outside the browser.
- **Environment-specific config** — merge a per-environment `baseUrl` map in `setupNodeEvents`, selected by `--env ENVIRONMENT=...`.

See `references/component-and-fixtures.md` for the fixture, `cy.task` seeding, and env-config code.

---

## CI Integration

**Cypress AI** (paid Cloud add-on, GA 2026) ships Auto Heal (selector self-healing), AI Test Generation, and AI Bug Triage. Overlaps directly with `test-reliability` (selector healing) and `ai-bug-triage` (failure clustering). Worth flagging during framework selection if your team is already on Cypress Cloud — buying the add-on may be cheaper than building the equivalent.

> **Versions:** Current is Cypress 15.x (Node 20+ baseline). Cypress 14 dropped Node 16/18; Cypress 15 dropped Node 20 EOL paths. The `cypress-io/github-action` is at v6 (current LTS) — pin to a specific tag and verify v7 readiness before bumping.

- **With Cypress Cloud:** set `projectId`, run with `npx cypress run --record --key $CYPRESS_RECORD_KEY`, and parallelize across a container matrix for flake detection, test replay, and analytics.
- **Without Cloud:** use `cypress-io/github-action@v6` with `build`/`start`/`wait-on`, and upload `cypress/screenshots` + `cypress/videos` as artifacts on failure.

See `references/ci-recipes.md` for both complete GitHub Actions workflows.

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

UI-based login in every test is slow and fragile. Use `cy.session()` (shown in the custom commands reference) to authenticate via API once and cache the session.

### Running All Tests Serially in CI

Parallelize once the suite exceeds 5 minutes. Use Cypress Cloud, `cypress-split`, or manual sharding across CI matrix jobs.

---

## Done When

- `cypress.config.ts` exists with a correct `baseUrl` (not hardcoded to `localhost` in CI) and explicit `viewportWidth`/`viewportHeight`
- Custom commands extracted to `cypress/support/commands.ts` with TypeScript declarations in `cypress/support/index.d.ts`
- `cy.intercept` used for all API dependencies that could be slow or unreliable — no tests relying on real network calls for determinism
- Tests pass in CI with either a recorded Cypress Cloud run (parallel) or local video/screenshot artifacts uploaded on failure
- Component tests co-located with source files (e.g. `ProductCard.cy.tsx` next to `ProductCard.tsx`) rather than in a separate top-level directory

## Reference Files (in `references/`)

- **config-and-commands.md** — Project directory tree, the full `cypress.config.ts`, and custom commands with their TypeScript declarations.
- **intercept-patterns.md** — Every `cy.intercept` recipe: stub, spy, conditional, error simulation, response modification, fixture-backed.
- **component-and-fixtures.md** — React component-test suite plus data-driven testing (static fixtures, `cy.task` seeding, env-specific config).
- **ci-recipes.md** — GitHub Actions workflows with and without Cypress Cloud, including parallelization and artifact upload.

## Related Skills

- **ci-cd-integration** -- Pipeline templates for running Cypress in GitHub Actions and GitLab CI, including parallelization and artifact management.
- **visual-testing** -- Visual regression testing approaches that complement Cypress functional tests; Cypress does not have built-in visual comparison.
- **unit-testing** -- Unit tests with Jest/Vitest for logic that does not need a browser; Cypress component tests fill the gap between unit and E2E.
- **test-data-management** -- Strategies for seeding, managing, and cleaning up test data used by Cypress tests.
- **test-reliability** -- Patterns for fixing flaky Cypress tests, retry strategies, and stability metrics.
- **qa-project-context** -- The project context file that captures framework choices, CI platform, and testing conventions.
