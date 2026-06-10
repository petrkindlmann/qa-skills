# cy.intercept Patterns

Network control with `cy.intercept` — stubbing, spying, conditional responses, error simulation, response modification, and fixture-backed responses. The decision prose on when to stub vs. spy lives in `SKILL.md`.

## Stub a Response

```typescript
cy.intercept('GET', '/api/products', {
  statusCode: 200,
  body: { products: [{ id: '1', name: 'Widget', price: 29.99 }] },
}).as('getProducts');

cy.visit('/products');
cy.wait('@getProducts');
cy.getByTestId('product-card').should('have.length', 1);
```

## Spy on Requests (No Stubbing)

```typescript
cy.intercept('POST', '/api/orders').as('createOrder');

cy.getByTestId('place-order').click();
cy.wait('@createOrder').then((interception) => {
  expect(interception.request.body).to.have.property('items');
  expect(interception.request.body.items).to.have.length(2);
  expect(interception.response?.statusCode).to.eq(201);
});
```

## Conditional Responses

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

cy.visit('/jobs/123');
// The app polls until status flips; wait on the alias for each poll, then assert the UI settled.
cy.wait('@pollStatus');
cy.wait('@pollStatus');
cy.wait('@pollStatus');
cy.contains('Report ready').should('be.visible');
```

## Simulate Network Errors

```typescript
// Simulate server error
cy.intercept('POST', '/api/checkout', { statusCode: 500, body: { error: 'Internal Server Error' } }).as('checkoutFail');

// Simulate network failure, then verify the error-handling UI
cy.intercept('POST', '/api/checkout', { forceNetworkError: true }).as('networkError');

cy.getByTestId('place-order').click();
cy.wait('@networkError');
cy.contains('Something went wrong. Please try again.').should('be.visible');

// Simulate slow response
cy.intercept('GET', '/api/dashboard', (req) => {
  req.reply({
    delay: 5000,
    statusCode: 200,
    body: { widgets: [] },
  });
}).as('slowDashboard');
```

## Modify Real Response

```typescript
cy.intercept('GET', '/api/feature-flags', (req) => {
  req.continue((res) => {
    res.body.flags['new-checkout'] = true;
    res.send();
  });
}).as('featureFlags');
```

## Using Fixture Files

```typescript
// Load response from cypress/fixtures/api-responses/checkout-success.json
cy.intercept('POST', '/api/checkout', { fixture: 'api-responses/checkout-success.json' }).as('checkout');
```

## Cross-Origin Flows with cy.origin

For legitimate cross-origin redirects (SSO, OAuth providers, an auth domain separate from your app), wrap the commands that run on the other origin in `cy.origin`. This replaced the old `chromeWebSecurity: false` / `experimentalSessionAndOrigin` flags -- do not disable web security to work around a redirect.

```typescript
cy.visit('/login');
cy.contains('button', 'Sign in with SSO').click();

cy.origin('https://auth.example.com', () => {
  cy.get('#username').type('user@example.com');
  cy.get('#password').type('password123', { log: false });
  cy.contains('button', 'Continue').click();
});

// back on the app origin
cy.url().should('include', '/dashboard');
```

This is distinct from third-party payment iframes (Stripe/PayPal): those you stub with `cy.intercept` and never reach into. `cy.origin` is for redirects to domains you control or trust, not embedded iframes.
