---
name: cypress-automation
description: >-
  Build Cypress test suites in TypeScript: E2E tests, component tests, custom commands,
  cy.intercept network control, cy.session login, Cypress Cloud, and CI integration.
  Covers retry-ability, the command queue, cross-origin flows with cy.origin, and
  data-driven testing with fixtures.
  Use when: "write E2E test in Cypress," "Cypress page object / custom command," "cy.,"
  "cy.intercept," "Cypress component test," "Cypress Cloud," "cypress.config.ts."
  Not for: Playwright suites — use playwright-automation; flaky-test healing or quarantine —
  use test-reliability; bulk selector regeneration after a UI refactor — use selector-drift-recovery;
  Selenium-to-Cypress conversion — use test-migration.
  Related: playwright-automation, ci-cd-integration, visual-testing, unit-testing, test-reliability.
license: MIT
metadata:
  author: kindlmann
  version: "2.0"
  category: automation
---

<objective>
Production-grade Cypress test suites in TypeScript. The failure this prevents: tests written as if Cypress commands ran synchronously (storing `cy.get()` in a variable, `await cy.click()`), and tests that flake because they wait on `cy.wait(3000)` instead of a network alias. This skill covers the mental model (command queue, retry-ability), project structure, custom commands, network control with `cy.intercept`, component testing, cross-origin auth with `cy.origin`, and Cypress Cloud / CI integration.
</objective>

## Quick Route

| You need to... | Go to |
|----------------|-------|
| Write an E2E spec (load, intercept, assert) | Core Principles + `references/intercept-patterns.md` |
| Add a typed custom command / `cy.session` login | Custom Commands + `references/config-and-commands.md` |
| Mount and test a single component | Component Testing + `references/component-and-fixtures.md` |
| Scaffold `cypress.config.ts` / project layout | Project Structure + `references/config-and-commands.md` |
| Stub, spy, simulate errors, or poll an API | cy.intercept Patterns + `references/intercept-patterns.md` |
| Run in CI / parallelize on Cypress Cloud | CI Integration + `references/ci-recipes.md` |
| Handle an SSO / OAuth redirect | Cross-Origin Flows + `references/intercept-patterns.md` |

---

## Discovery Questions

Check `.agents/qa-project-context.md` first -- if it exists, use it and skip questions already answered there.

1. **Component testing, E2E, or both?** Component testing mounts individual components in isolation; E2E tests the full app through the browser. Most projects need both. Component testing requires a framework-specific mount (React, Vue, Angular, Svelte).
2. **Cypress Cloud?** Cloud provides parallelization, flake detection, analytics, Test Replay, and the AI add-on. If the team uses it, configure `projectId` and the record key. If not, everything runs locally or in CI without Cloud.
3. **TypeScript?** Strongly recommended and the default here -- Cypress supports it natively. All examples use TypeScript.
4. **Framework and bundler?** React + Vite, Next.js + Webpack, Vue + Vite, Angular -- component-testing config depends on this.
5. **Cross-origin auth?** If login redirects to a separate domain (SSO, OAuth provider), you need `cy.origin`. Note it now so the login command is built for it.
6. **Existing suite or fresh start?** If migrating, start with the flakiest or most critical tests, not a big-bang rewrite (see `test-migration`).

---

## Core Principles

### 1. Commands Are Enqueued, Not Executed Immediately

The single most important concept. Cypress commands (`cy.get`, `cy.click`, `cy.type`) do not execute when called -- they are added to a queue and run serially, asynchronously. You cannot use `async/await` with Cypress commands, and you cannot store the return value in a variable.

```typescript
// WRONG -- this looks synchronous but is not
const button = cy.get('[data-testid="submit"]'); // button is a Chainable, not an element
button.click(); // works only by accident, via chaining

// CORRECT -- chain commands; use .then() when you need a value
cy.get('[data-testid="submit"]').click();

cy.get('[data-testid="price"]').invoke('text').then((text) => {
  const price = parseFloat(text.replace('$', ''));
  expect(price).to.be.greaterThan(0);
});
```

### 2. Retry-ability Is Built-In (For Queries, Not Actions)

Cypress automatically retries **queries** (`cy.get`, `cy.find`, `cy.contains`) and **assertions** until they pass or time out. It does **not** retry **actions** (`cy.click`, `cy.type`, `cy.select`):

- `cy.get('.loading').should('not.exist')` waits for the indicator to disappear
- `cy.get('.item').should('have.length', 5)` waits for 5 items
- `cy.click()` executes once -- if the element is not actionable, it fails

### 3. Network Control with cy.intercept

`cy.intercept` intercepts HTTP requests at the network layer -- stub responses, wait for requests to complete, assert on request bodies. Mastering it is the difference between flaky and stable tests. Always wait on a network alias or a DOM assertion, never a fixed `cy.wait(ms)`.

### 4. Isolation: Each Test Starts Clean

Every `it()` runs in fresh browser state -- Cypress clears cookies, localStorage, and sessionStorage between tests by default. Tests must not depend on other tests' state or order. Use `beforeEach` for shared setup, not inter-test dependencies.

### 5. Data Attributes for Test Selectors

Use `data-testid`, `data-cy`, or `data-test`. They survive CSS refactors, class renames, and localization. Configure the preferred attribute in `cypress.config.ts`.

---

## Project Structure & Configuration

Standard layout splits `e2e/`, `component/`, `fixtures/`, and `support/`, with `cypress.config.ts` at the root configuring both runners. Key config choices: `baseUrl` from env (never hardcode for CI), explicit viewport, `retries.runMode: 2` for CI, and the framework/bundler pair under `component.devServer`. Component specs live under `cypress/component/**/*.cy.tsx`.

See `references/config-and-commands.md` for the directory tree, the complete `cypress.config.ts`, and the `tsconfig.json` additions.

---

## Custom Commands

Custom commands encapsulate repeated actions behind a clean, typed API. Common commands: `login` (via `cy.session` + API, not UI), a `getByTestId` selector shorthand, and assertion helpers like `shouldShowToast`. Declare them in `cypress/support/index.d.ts` (`declare namespace Cypress { interface Chainable { ... } }` with JSDoc `@example`) so they get autocomplete and compile-time checking.

**`cy.session` needs a `validate()` callback.** `cy.session` caches cookies/localStorage/sessionStorage automatically, but without `validate()` the cached session is never re-verified -- a stale or expired token silently reuses a dead session. Always pass a `validate()` that hits an authenticated endpoint (e.g. `cy.request('/api/me').its('status').should('eq', 200)`).

**Retryable lookups use `Cypress.Commands.addQuery()`, and the callback must be a non-arrow `function () {}`** -- Cypress binds `this` to apply the command timeout, so an arrow function silently breaks retry-ability. (Intercept handlers are the opposite: `(req) => {}` is fine there because they do not use `this`.)

See `references/config-and-commands.md` for the full command definitions, the `validate()` callback, the `addQuery` example, and the TypeScript declarations.

---

## cy.intercept Patterns

`cy.intercept` covers the full network-control surface:

- **Stub a response** — return canned data with `{ statusCode, body }`, then `cy.wait('@alias')`.
- **Spy without stubbing** — `cy.intercept('POST', '/api/orders').as('createOrder')`, then assert on `interception.request.body` and `interception.response?.statusCode`.
- **Conditional responses** — drive a closure with `callCount` to simulate polling (202 → 200). The handler arrow function `(req) => { ... }` is correct here.
- **Network errors** — `{ statusCode: 500 }`, `{ forceNetworkError: true }`, or `req.reply({ delay })` for slow responses.
- **Modify real responses** — `req.continue((res) => { ...; res.send(); })`.
- **Fixture-backed** — `{ fixture: 'api-responses/checkout-success.json' }`.

Register the intercept **before** the action that triggers the request, or the alias never matches.

See `references/intercept-patterns.md` for runnable code for each, plus cross-origin flows.

---

## Component Testing

Component testing mounts a single component in a real browser without running the full app -- faster than E2E, more visual feedback than unit tests. Use `cy.mount(<Component .../>)`, pass `cy.stub()`/`cy.spy()` for callbacks, and assert with the same `cy.contains`/`cy.get` chain you use in E2E. Never use `cy.visit` in a component test. For Vue, use `cy.mount(Component, { props: { ... } })`.

See `references/component-and-fixtures.md` for a full React `ProductCard` component-test suite.

---

## Data-Driven Testing with Fixtures

Three layers, depending on where the data comes from:

- **Static fixtures** — `cy.fixture('users').as('users')` for JSON that rarely changes; read it via `this.users` in a `beforeEach(function () { ... })`.
- **Dynamic data via `cy.task`** — register Node-side tasks in `setupNodeEvents` for API calls or DB seeding that must run outside the browser (task bodies run in Node, so `fetch` there is Node's global fetch, not a Cypress API).
- **Environment-specific config** — merge a per-environment `baseUrl` map in `setupNodeEvents`, selected by `--env ENVIRONMENT=...`.

See `references/component-and-fixtures.md` for the fixture, `cy.task` seeding, and env-config code.

---

## Cross-Origin Flows

For legitimate redirects to another domain (SSO, OAuth providers, a separate auth host), wrap the commands that run on the other origin in `cy.origin`. This replaced the old `chromeWebSecurity: false` / `experimentalSessionAndOrigin` escape hatches -- do not disable web security to work around a redirect. This is distinct from third-party payment iframes (Stripe/PayPal), which you stub with `cy.intercept` and never reach into.

See `references/intercept-patterns.md` (Cross-Origin Flows) for the `cy.origin` example.

---

## CI Integration

**Action version:** pin to `cypress-io/github-action@v7` (latest 7.2.0, May 2026). v7 runs under Node 24 and is the current major; use `@v6` only on a Node 20 runner (the legacy branch).

> **Cypress / Node support:** Current is Cypress 15.x, which supports Node 20, 22, and 24 (Node 18 and 23 dropped). Node 20 removal is a future Cypress 16 / action-v7.2 concern tracking the Node 20 EOL (2026-04-30), not something Cypress 15 did.

- **With Cypress Cloud:** set `projectId`, run `npx cypress run --record --key $CYPRESS_RECORD_KEY`, and parallelize across a container matrix (`fail-fast: false`) for flake detection, Test Replay, and analytics.
- **Without Cloud:** use `cypress-io/github-action@v7` with `build`/`start`/`wait-on`, and upload `cypress/screenshots` + `cypress/videos` as artifacts on failure.

See `references/ci-recipes.md` for both complete GitHub Actions workflows.

**Cypress AI (paid Cloud add-on, GA 2026)** ships Auto Heal (selector self-healing), AI Test Generation, and AI Bug Triage. Now GA and worth knowing: `cy.prompt` (English-to-test authoring with runtime self-healing) and **Cloud MCP** (GA May 2026, free on all Cloud plans) — an MCP server that feeds recorded-run errors, stack traces, and Test Replay links to your AI assistant. This overlaps `test-reliability` (selector healing), `ai-bug-triage` (failure clustering), and `ai-test-generation` (authoring). If the team is already on Cypress Cloud, buying the add-on may be cheaper than building the equivalent -- flag it during framework selection.

---

## Anti-Patterns

### 1. cy.wait(milliseconds) for Synchronization

```typescript
// BAD
cy.get('[data-testid="submit"]').click();
cy.wait(3000);

// GOOD -- wait for network
cy.intercept('POST', '/api/submit').as('submit');
cy.get('[data-testid="submit"]').click();
cy.wait('@submit');
```

Only acceptable for throttle/debounce testing. Everything else waits on a network alias or a DOM assertion.

### 2. Conditional Testing Based on DOM State

Do not check `$body.find(selector).length > 0` to conditionally act. Control state deterministically -- stub the API that drives the conditional element.

### 3. CSS Selectors Over Data Attributes

`cy.get('.btn.btn-primary > span')` breaks on every CSS refactor. Use `cy.getByTestId('submit')` or `cy.contains('button', 'Place Order')`.

### 4. Sharing State Between Tests

Module-level `let orderId` set in one `it()` and read in another creates order-dependent, parallel-unsafe tests. Each test sets up its own data via `cy.request` or `cy.task` in `beforeEach`.

### 5. Testing Third-Party Iframes

Do not reach into Stripe/PayPal iframes. Mock the payment API with `cy.intercept` and assert on your own UI.

### 6. Not Using cy.session() for Login (or Omitting validate())

UI login in every test is slow and fragile. Use `cy.session` to authenticate via API once and cache it -- with a `validate()` callback so an expired token does not silently reuse a dead session.

### 7. Arrow Function in addQuery

A custom query written with `addQuery('name', (arg) => { ... })` silently loses its retry timeout because Cypress needs `this`. Use `function (arg) { ... }`.

### 8. Running All Tests Serially in CI

Parallelize once the suite exceeds 5 minutes -- Cypress Cloud, `cypress-split`, or manual sharding across a CI matrix.

---

## Failure Modes

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `element is detached from the DOM` | A yielded element was reused after a re-render | Re-query inside `.should`/`.then` instead of holding the old reference |
| `cy.intercept` did not match / alias never resolves | Wrong method or glob, or intercept registered after the action | Register the intercept before the triggering command; verify method + URL glob |
| `cross origin` error on redirect | Login or flow crosses to another domain | Wrap the other-origin commands in `cy.origin`; do not disable `chromeWebSecurity` |
| Session reused but user is logged out | `cy.session` has no `validate()`, token expired | Add a `validate()` callback that hits an authenticated endpoint |
| Custom query never times out / retries forever | `addQuery` callback is an arrow function | Convert to `function () {}` so Cypress can bind `this` |

---

## Verification

Prove the suite runs before calling it done:

- `npx cypress verify` — confirms the Cypress binary is installed and runnable.
- `npx cypress run --spec "cypress/e2e/<file>.cy.ts"` — should exit 0 (headless, in CI mode).
- `npx cypress run --component --spec "cypress/component/<File>.cy.tsx"` — component specs exit 0.
- `npx tsc --noEmit` — custom-command declarations in `index.d.ts` compile against the test files.

---

## Done When

- `cypress.config.ts` exists with a `baseUrl` from env (not hardcoded `localhost` in CI) and explicit `viewportWidth`/`viewportHeight`; `npx cypress verify` passes.
- Custom commands extracted to `cypress/support/commands.ts` with TypeScript declarations in `cypress/support/index.d.ts`; `npx tsc --noEmit` exits 0.
- The `login` command uses `cy.session` with a `validate()` callback.
- No `cy.wait(<number>)` for synchronization in the suite (`grep -rn "cy.wait([0-9]" cypress/` returns nothing except documented throttle/debounce cases).
- Component specs live under `cypress/component/**/*.cy.tsx` and run with `npx cypress run --component` exiting 0.
- E2E specs pass in CI (`npx cypress run` exits 0) with either a recorded Cypress Cloud run (parallel) or local video/screenshot artifacts uploaded on failure.

## Reference Files (in `references/`)

- **config-and-commands.md** — Project directory tree, full `cypress.config.ts`, and custom commands (`cy.session` + `validate()`, the non-arrow `addQuery`) with TypeScript declarations.
- **intercept-patterns.md** — Every `cy.intercept` recipe (stub, spy, conditional/polling, error simulation, response modification, fixture-backed) plus cross-origin flows with `cy.origin`.
- **component-and-fixtures.md** — React component-test suite plus data-driven testing (static fixtures, `cy.task` seeding, env-specific config).
- **ci-recipes.md** — GitHub Actions workflows with and without Cypress Cloud, on `@v7`, with parallelization and artifact upload.

## Related Skills

- **playwright-automation** — Use instead of this skill when the suite is Playwright, not Cypress. Same E2E goals, different runner and API.
- **test-reliability** — Go here for runtime per-test flake healing, self-healing locators, and quarantine. This skill writes stable tests; that one repairs failing ones.
- **selector-drift-recovery** — Bulk-regenerate broken selectors after a UI refactor or redesign; this skill is for authoring, not mass repair.
- **test-migration** — Converting Selenium/other suites to Cypress.
- **ci-cd-integration** — Pipeline templates for running Cypress in GitHub Actions / GitLab CI, parallelization, and artifact management.
- **visual-testing** — Visual regression to complement Cypress functional tests; Cypress has no built-in pixel comparison.
- **unit-testing** — Jest/Vitest for logic that needs no browser; Cypress component tests fill the gap between unit and E2E.
- **test-data-management** — Seeding, managing, and cleaning up the test data Cypress tests consume.
- **qa-project-context** — The project context file capturing framework choices, CI platform, and conventions.
