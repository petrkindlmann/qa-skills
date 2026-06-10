# Testability Refactors

Before/after code for the testability problems described under "Testability Analysis" in `SKILL.md`. The flags and what-to-look-for cues live in the SKILL; the refactor code lives here.

## Dependency Injection

Flag classes that instantiate dependencies directly (`new PostgresDatabase()`, `new StripeClient()` inside methods). Suggest constructor injection so tests can substitute mocks/fakes.

```typescript
// HARD TO TEST                          // TESTABLE
class OrderService {                     class OrderService {
  async create(data: OrderInput) {         constructor(
    const db = new PostgresDB();             private readonly db: Database,
    const email = new SendGrid();            private readonly email: EmailClient,
  }                                        ) {}
}                                        }
```

## Side Effect Isolation

Flag functions that mix pure calculation with I/O (email, logging, analytics). Extract the calculation as a pure function, then call it from the side-effectful orchestrator. The pure half becomes trivially unit-testable.

```typescript
// HARD TO TEST: calculation and side effects fused
async function checkout(cart: Cart, userId: string) {
  let total = 0;
  for (const item of cart.items) total += item.price * item.qty;
  if (cart.coupon) total *= 1 - cart.coupon.rate;
  await db.orders.insert({ userId, total });        // I/O
  await email.send(userId, `You paid ${total}`);    // I/O
  return total;
}

// TESTABLE: pure calculation extracted
function calcTotal(cart: Cart): number {
  const subtotal = cart.items.reduce((s, i) => s + i.price * i.qty, 0);
  return cart.coupon ? subtotal * (1 - cart.coupon.rate) : subtotal;
}

async function checkout(cart: Cart, userId: string) {
  const total = calcTotal(cart);                    // unit-test this directly
  await db.orders.insert({ userId, total });
  await email.send(userId, `You paid ${total}`);
  return total;
}
```

`calcTotal` now tests with plain inputs and outputs — no DB, no email, no boundary values hidden behind I/O.

## Pure Function Extraction

Look for validation, transformation, and business rules buried inside request handlers. If logic is inline in `app.post('/api/orders', ...)`, it cannot be unit-tested without spinning up an HTTP server. Extract it as a standalone function.

```typescript
// HARD TO TEST: rule logic trapped inside the route handler
app.post('/api/orders', async (req, res) => {
  if (!req.body.items?.length) return res.status(400).json({ error: 'empty' });
  const weight = req.body.items.reduce((w, i) => w + i.weight * i.qty, 0);
  const shipping = weight > 20 ? 15 : weight > 5 ? 8 : 4;   // business rule
  res.json({ shipping });
});

// TESTABLE: rule is a pure function, handler is a thin adapter
export function shippingFor(items: Item[]): number {
  const weight = items.reduce((w, i) => w + i.weight * i.qty, 0);
  return weight > 20 ? 15 : weight > 5 ? 8 : 4;
}

app.post('/api/orders', async (req, res) => {
  if (!req.body.items?.length) return res.status(400).json({ error: 'empty' });
  res.json({ shipping: shippingFor(req.body.items) });
});
```

`shippingFor` is now testable with `it.each` across the 5/20 boundaries — no Express, no supertest.

## Interface Segregation

Flag classes that depend on broad interfaces (entire `PrismaClient`) when they only use 2-3 methods. Define a narrow interface with only the methods actually used, making test doubles trivial to implement.

```typescript
// HARD TO TEST: must mock all of PrismaClient to fake one query
class UserLookup {
  constructor(private prisma: PrismaClient) {}
  byEmail(email: string) { return this.prisma.user.findUnique({ where: { email } }); }
}

// TESTABLE: narrow port, one-line fake
interface UserReader {
  findUnique(args: { where: { email: string } }): Promise<User | null>;
}
class UserLookup {
  constructor(private users: UserReader) {}
  byEmail(email: string) { return this.users.findUnique({ where: { email } }); }
}
// test: new UserLookup({ findUnique: async () => ({ id: '1', email }) })
```
