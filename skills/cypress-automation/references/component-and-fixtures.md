# Component Testing and Data-Driven Fixtures

Component-mount test code and data-driven testing patterns (static fixtures, `cy.task` seeding, env-specific config). The prose on when component tests beat E2E/unit lives in `SKILL.md`.

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
