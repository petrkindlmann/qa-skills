# Test Smell Examples (SMELL → FIX)

Runnable before/after code for the test smells catalogued in `SKILL.md`. The smell descriptions, detection cues, and review actions live in the SKILL; this file holds the full code so the SKILL loads lean.

## Reliability Smells

### Sleep-Based Waiting

```typescript
// SMELL: Slow on fast machines, flaky on slow ones
it('should show notification after save', async () => {
  await page.click('#save');
  await page.waitForTimeout(3000);
  expect(await page.isVisible('.notification')).toBe(true);
});

// FIX: Wait for the specific condition
it('should show notification after save', async () => {
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
});
```

### Order Dependency

```typescript
// SMELL: Test B depends on Test A's side effects
describe('user management', () => {
  it('A: should create a user', async () => {
    await api.post('/users', { name: 'Alice' });
  });
  it('B: should list users', async () => {
    const users = await api.get('/users');
    expect(users).toContainEqual({ name: 'Alice' }); // Fails if A didn't run first
  });
});

// FIX: Each test sets up its own state
describe('user management', () => {
  it('should create a user', async () => {
    const response = await api.post('/users', { name: 'Alice' });
    expect(response.status).toBe(201);
  });
  it('should list users including recently created', async () => {
    await api.post('/users', { name: 'Bob' }); // Own setup
    const users = await api.get('/users');
    expect(users).toContainEqual({ name: 'Bob' });
  });
});
```

### External Service Coupling

```typescript
// SMELL: Fails when Stripe is down, rate-limited, or returns different data
it('should process payment', async () => {
  const result = await stripe.charges.create({ amount: 2000, currency: 'usd' });
  expect(result.status).toBe('succeeded');
});

// FIX: Mock the boundary
it('should process payment', async () => {
  const mockStripe = { charges: { create: vi.fn().mockResolvedValue({ status: 'succeeded' }) } };
  const service = new PaymentService(mockStripe);
  const result = await service.charge(2000, 'usd');
  expect(result.status).toBe('succeeded');
});
```

## Diagnostic Smells

### Weak Assertion Messages

```typescript
// SMELL: Failure message: "Expected false to be true" -- useless
it('should validate the form', () => {
  expect(isValid(form)).toBe(true);
});

// FIX: Use specific assertions that produce clear failure messages
it('should accept form with valid email and non-empty name', () => {
  const result = validate(form);
  expect(result.isValid).toBe(true);
  expect(result.errors).toEqual([]);
  // Failure: "Expected errors to equal [] but received [{ field: 'email', message: 'invalid format' }]"
});
```

### Multiple Failure Causes Per Test

```typescript
// SMELL: If this fails, is it the creation, the update, or the deletion?
it('should handle user lifecycle', async () => {
  const user = await service.create({ name: 'Alice' });
  expect(user.id).toBeDefined();

  await service.update(user.id, { name: 'Bob' });
  const updated = await service.get(user.id);
  expect(updated.name).toBe('Bob');

  await service.delete(user.id);
  await expect(service.get(user.id)).rejects.toThrow(NotFoundError);
});

// FIX: One behavior per test
it('should create user with generated id', async () => {
  const user = await service.create({ name: 'Alice' });
  expect(user.id).toBeDefined();
});

it('should update user name', async () => {
  const user = await service.create({ name: 'Alice' });
  await service.update(user.id, { name: 'Bob' });
  expect((await service.get(user.id)).name).toBe('Bob');
});

it('should delete user so they cannot be retrieved', async () => {
  const user = await service.create({ name: 'Alice' });
  await service.delete(user.id);
  await expect(service.get(user.id)).rejects.toThrow(NotFoundError);
});
```

## Design Smells

### Conditional Test Logic

```typescript
// SMELL: Test logic that can take different paths is itself untested
it('should handle all user roles', () => {
  for (const role of ['admin', 'user', 'guest']) {
    const result = getPermissions(role);
    if (role === 'admin') {
      expect(result).toContain('delete');
    } else if (role === 'user') {
      expect(result).toContain('read');
      expect(result).not.toContain('delete');
    } else {
      expect(result).toEqual(['read']);
    }
  }
});

// FIX: Use parameterized tests (test.each / it.each)
it.each([
  ['admin', ['read', 'write', 'delete']],
  ['user', ['read', 'write']],
  ['guest', ['read']],
])('role "%s" should have permissions %j', (role, expected) => {
  expect(getPermissions(role)).toEqual(expected);
});
```

### Giant Fixtures

```typescript
// SMELL: Every test pays the setup cost for data it doesn't use
beforeEach(async () => {
  await createUser(pool, { id: 'u1', role: 'admin' });
  await createUser(pool, { id: 'u2', role: 'user' });
  await createUser(pool, { id: 'u3', role: 'guest' });
  await createProduct(pool, { id: 'p1', stock: 100 });
  await createProduct(pool, { id: 'p2', stock: 0 });
  await createOrder(pool, { id: 'o1', userId: 'u2' });
  await createOrder(pool, { id: 'o2', userId: 'u2' });
  // ... 15 more objects
});

// FIX: Each test creates only what it needs
it('should prevent guest from deleting products', async () => {
  const guest = await createUser(pool, { role: 'guest' });
  const product = await createProduct(pool, { stock: 50 });
  await expect(productService.delete(product.id, guest.id)).rejects.toThrow(ForbiddenError);
});
```

### Over-Mocking

```typescript
// SMELL: Mocking the thing you are testing
it('should format price', () => {
  const mockFormatter = vi.fn().mockReturnValue('$29.99');
  const result = mockFormatter(29.99);
  expect(mockFormatter).toHaveBeenCalledWith(29.99);
  expect(result).toBe('$29.99');
  // This test verifies nothing about the real formatPrice function
});

// FIX: Only mock external boundaries (network, DB, filesystem, time)
it('should format price with currency symbol', () => {
  expect(formatPrice(29.99, 'USD')).toBe('$29.99');
  expect(formatPrice(29.99, 'EUR')).toBe('29,99 EUR');
});
```

## Coverage Smells

### Happy Path Only

```typescript
// SMELL: What happens with invalid input? Empty input? Null? Boundary values?
describe('calculateDiscount', () => {
  it('should apply 10% discount', () => {
    expect(calculateDiscount(100, 0.1)).toBe(90);
  });
  it('should apply 20% discount', () => {
    expect(calculateDiscount(200, 0.2)).toBe(160);
  });
});

// FIX: Add boundary, negative, and error cases
describe('calculateDiscount', () => {
  it('should apply percentage discount', () => {
    expect(calculateDiscount(100, 0.1)).toBe(90);
  });
  it('should handle zero discount', () => {
    expect(calculateDiscount(100, 0)).toBe(100);
  });
  it('should handle 100% discount', () => {
    expect(calculateDiscount(100, 1.0)).toBe(0);
  });
  it('should reject negative discount', () => {
    expect(() => calculateDiscount(100, -0.1)).toThrow('Discount must be between 0 and 1');
  });
  it('should reject discount over 100%', () => {
    expect(() => calculateDiscount(100, 1.5)).toThrow('Discount must be between 0 and 1');
  });
  it('should handle zero price', () => {
    expect(calculateDiscount(0, 0.1)).toBe(0);
  });
});
```
