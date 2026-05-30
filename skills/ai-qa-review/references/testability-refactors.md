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
