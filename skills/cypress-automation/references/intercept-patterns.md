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
```

## Simulate Network Errors

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
