# Flaky Test Runbook

Step-by-step guide for triaging, diagnosing, fixing, and preventing flaky tests. Follow this runbook every time a flaky test is detected.

---

## Step 1: Reproduce

Before diagnosing, confirm the flakiness is real and measure the failure rate.

### Local Reproduction

```bash
# Run the flaky test 20 times with parallelism and tracing
npx playwright test path/to/flaky.spec.ts --repeat-each=20 --workers=4 --trace=on

# For Jest/Vitest
for i in $(seq 1 20); do npx jest path/to/flaky.test.ts 2>&1 | tail -1; done

# For pytest
pytest path/to/test_flaky.py --count=20 -x -v
```

### Record Results

```markdown
## Flaky Test Report: [test name]
- File: [path]
- Runs: 20
- Passed: [N]
- Failed: [N]
- Failure rate: [N/20 as percentage]
- Failure messages: [list unique error messages]
- First observed: [date or commit]
- Related ticket: [link]
```

**If it passes all 20 runs locally:** the flakiness may be environment-specific. Move to Step 2 focusing on CI differences.

**If it fails at least once:** you have a local reproduction. Examine the trace files for clues.

### Examine Trace Files

```bash
# Open the Playwright trace viewer for a failed run
npx playwright show-trace test-results/flaky-test-retry1/trace.zip
```

In the trace, look for:
- Network requests that take unusually long
- Actions that happen before the page is ready
- Elements that briefly appear then disappear
- Console errors or warnings
- Missing or delayed API responses

---

## Step 2: Correlate with History

Determine when the flakiness started and what changed.

### CI History Analysis

```bash
# When did this test start failing?
# Check the last 2 weeks of CI runs for this test file
git log --oneline --since="2 weeks ago" -- path/to/flaky.spec.ts

# Check if related source code changed
git log --oneline --since="2 weeks ago" -- src/features/related-feature/

# Check dependency updates
git log --oneline --since="2 weeks ago" -- package.json package-lock.json
```

### Correlation Questions

| Question | How to Check | What It Tells You |
|----------|-------------|-------------------|
| When did it start failing? | CI dashboard, git bisect | Narrows the cause to a specific change |
| Did source code change? | `git log` on related files | Regression in app code |
| Did test code change? | `git log` on test file | Test bug introduced |
| Did dependencies update? | `git log` on lock files | Dependency regression |
| Did CI config change? | `git log` on CI files | Environment change |
| Did failure rate change? | CI analytics | Getting worse = active regression |
| Does it correlate with time of day? | CI run timestamps | Resource contention or timezone |
| Does it correlate with specific runners? | CI runner labels | Hardware/OS-specific issue |

### Git Bisect for Flaky Tests

```bash
# Automate finding the commit that introduced flakiness
git bisect start
git bisect bad HEAD
git bisect good <last-known-good-commit>
git bisect run bash -c 'npx playwright test path/to/flaky.spec.ts --repeat-each=10 2>&1 | grep -q "10 passed"'
```

---

## Step 3: Classify

Use the decision tree to categorize the root cause.

### Root Cause Decision Tree

```
START: Test fails intermittently
│
├── Q1: Does it pass when run alone (not in parallel)?
│   │
│   ├── YES → ORDER or DATA DEPENDENCY
│   │   │
│   │   ├── Q1a: Does another test create data this test needs?
│   │   │   ├── YES → ORDER DEPENDENCY
│   │   │   └── NO → continue
│   │   │
│   │   ├── Q1b: Do tests share a database, file, or cache?
│   │   │   ├── YES → DATA DEPENDENCY (shared state)
│   │   │   └── NO → continue
│   │   │
│   │   └── Q1c: Does cleanup run between tests?
│   │       ├── NO → DATA DEPENDENCY (missing cleanup)
│   │       └── YES → May be TIMING (parallel resource contention)
│   │
│   └── NO → Not order-dependent. Continue to Q2.
│
├── Q2: Does it fail more in CI than locally?
│   │
│   ├── YES → TIMING or ENVIRONMENT
│   │   │
│   │   ├── Q2a: Are there timeout errors in the failure?
│   │   │   ├── YES → TIMING (CI is slower)
│   │   │   └── NO → continue
│   │   │
│   │   ├── Q2b: Are there connection errors (ECONNREFUSED, ETIMEOUT)?
│   │   │   ├── YES → ENVIRONMENT (network/service)
│   │   │   └── NO → continue
│   │   │
│   │   ├── Q2c: Are there resource errors (ENOMEM, ENOSPC)?
│   │   │   ├── YES → ENVIRONMENT (resource contention)
│   │   │   └── NO → continue
│   │   │
│   │   └── Q2d: Does it correlate with CI load or runner type?
│   │       ├── YES → ENVIRONMENT (resource variability)
│   │       └── NO → TIMING (race condition in app or test)
│   │
│   └── NO → Same failure rate locally and CI. Continue to Q3.
│
├── Q3: Does the failure involve dates, times, or durations?
│   │
│   ├── YES → TIME SENSITIVITY
│   │   ├── Uses Date.now() or new Date()? → Mock the clock
│   │   ├── Compares against hardcoded dates? → Use relative dates
│   │   └── Fails near midnight or month boundary? → Date boundary bug
│   │
│   └── NO → Continue to Q4.
│
├── Q4: Does the failure involve visual comparison or screenshots?
│   │
│   ├── YES → VISUAL RENDERING
│   │   ├── Subpixel differences? → Increase comparison threshold
│   │   ├── Font rendering varies? → Use consistent font loading
│   │   └── Animation caught mid-frame? → Disable animations or wait
│   │
│   └── NO → Continue to Q5.
│
├── Q5: Does the test make external HTTP calls?
│   │
│   ├── YES → EXTERNAL SERVICE
│   │   ├── Third-party API down? → Mock it
│   │   └── Rate limited? → Use test account with higher limits
│   │
│   └── NO → Continue to Q6.
│
└── Q6: Default classification
    │
    └── TIMING (most likely)
        └── What async operation is not being properly awaited?
            ├── API response not waited for? → waitForResponse
            ├── DOM update not waited for? → waitFor / expect with auto-wait
            ├── Animation not complete? → waitForCSS or disable animations
            └── Event not processed? → waitForEvent
```

---

## Step 4: Fix

Apply the fix pattern specific to the root cause category.

### Fix: Timing Issues

**Problem:** Test acts before the page/component is ready.

```typescript
// BAD: hardcoded wait
await page.waitForTimeout(3000);

// GOOD: wait for the specific condition
await expect(page.getByRole('table')).toBeVisible();

// GOOD: wait for API response
await page.waitForResponse(
  resp => resp.url().includes('/api/data') && resp.status() === 200
);

// GOOD: wait for network idle after navigation
await page.goto('/dashboard', { waitUntil: 'networkidle' });

// GOOD: wait for animation to complete
await expect(page.getByTestId('modal')).toHaveCSS('opacity', '1');

// GOOD: wait for loading indicator to disappear
await expect(page.getByTestId('spinner')).toBeHidden();
await expect(page.getByRole('row')).not.toHaveCount(0);
```

### Fix: Data Dependency

**Problem:** Test relies on state from another test or prior run.

```typescript
// BAD: shared mutable state between tests
let userId: string;
test('create user', async () => { userId = await createUser(); });
test('delete user', async () => { await deleteUser(userId); }); // fails if run alone

// GOOD: each test creates its own data via fixture
const test = base.extend<{ testUser: User }>({
  testUser: async ({ request }, use) => {
    const user = await request.post('/api/test/users', {
      data: { email: `test-${Date.now()}@example.com` },
    }).then(r => r.json());

    await use(user);

    // Cleanup guaranteed even on failure
    await request.delete(`/api/test/users/${user.id}`);
  },
});
```

### Fix: Order Dependency

**Problem:** Test assumes another test has run first.

```typescript
// BAD: test depends on setup from a previous test
test('edits the user profile', async ({ page }) => {
  // Assumes "creates user" test ran first
  await page.goto('/users/test-user-123/edit');
});

// GOOD: self-contained test with its own setup
test('edits the user profile', async ({ page, testUser }) => {
  await page.goto(`/users/${testUser.id}/edit`);
});
```

**Verification:** Run with `--shard=1/2` and `--shard=2/2`. If both pass, no order dependency.

### Fix: Environment Issues

**Problem:** CI environment differs from local.

```typescript
// Increase timeouts for CI (but keep fast locally)
const CI_TIMEOUT = process.env.CI ? 15_000 : 5_000;

// Mock external services
await page.route('**/api.external-service.com/**', route =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ status: 'ok', data: mockData }),
  })
);

// Use consistent browser settings
const browser = await chromium.launch({
  args: ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'],
});
```

### Fix: Time Sensitivity

**Problem:** Test uses real clock and fails at certain times.

```typescript
// BAD: uses real time
test('shows "today" label', async ({ page }) => {
  await page.goto('/events');
  await expect(page.getByText('Today')).toBeVisible();
});

// GOOD: mock the clock
test('shows "today" label', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-06-15T10:00:00Z') });
  await page.goto('/events');
  await expect(page.getByText('Today')).toBeVisible();
});

// BAD: hardcoded date
expect(order.date).toBe('2026-03-23');

// GOOD: relative comparison
const orderDate = new Date(order.date);
const now = new Date();
expect(Math.abs(orderDate.getTime() - now.getTime())).toBeLessThan(60_000);
```

### Fix: Visual Rendering

**Problem:** Screenshot comparison is too sensitive.

```typescript
// Increase threshold for pixel comparison
await expect(page).toHaveScreenshot('dashboard.png', {
  maxDiffPixelRatio: 0.01,   // allow 1% pixel difference
  threshold: 0.3,             // per-pixel threshold
  animations: 'disabled',     // disable CSS animations
});

// Mask dynamic regions
await expect(page).toHaveScreenshot('page.png', {
  mask: [
    page.getByTestId('timestamp'),
    page.getByTestId('random-avatar'),
    page.getByTestId('live-counter'),
  ],
});
```

### Fix: External Service

**Problem:** Test depends on third-party API availability.

```typescript
// Mock the external API at the network level
await page.route('**/api.stripe.com/**', async route => {
  const url = route.request().url();
  if (url.includes('/payment_intents')) {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'pi_test_123',
        status: 'succeeded',
        amount: 4999,
      }),
    });
  } else {
    await route.continue();
  }
});
```

---

## Step 5: Verify the Fix

The fix is not complete until it passes reliably.

### Verification Protocol

```bash
# Run 50 times with parallelism — zero failures required
npx playwright test path/to/fixed.spec.ts --repeat-each=50 --workers=4

# If any failure: the fix is incomplete. Return to Step 3.

# Run the full suite to check for regressions
npx playwright test

# Run in CI-like conditions (if different from local)
CI=true npx playwright test path/to/fixed.spec.ts --repeat-each=50 --workers=4
```

**Success criteria:**
- 50/50 passes locally
- 50/50 passes in CI (if applicable)
- Full suite still passes
- No increase in execution time > 20%

---

## Step 6: Release from Quarantine

### Cleanup Steps

1. Remove the `@quarantine` tag from the test
2. Add an annotation documenting the fix:
   ```typescript
   test('WebSocket reconnect after disconnect', {
     annotation: {
       type: 'fixed-flaky',
       description: 'Was flaky due to race condition in WebSocket handler. Fixed by waiting for reconnect event instead of timeout. Original ticket: BUG-1234.',
     },
   }, async ({ page }) => { /* ... */ });
   ```
3. Update the ticket (BUG-1234) with the fix details
4. Verify the test runs in the `stable` project, not `quarantine`
5. Monitor for 1 week after release — if it flakes again, re-quarantine

---

## Confidence Scoring Methodology

When automated repair is attempted, score the repair confidence to determine the approval path.

### Scoring Dimensions

| Dimension | Weight | How to Measure |
|-----------|--------|---------------|
| **Match specificity** | 0.30 | How specific is the replacement locator? (testId=1.0, role=0.9, text=0.7, CSS=0.3) |
| **Element visibility** | 0.15 | Is the replacement element visible on the page? |
| **Container match** | 0.15 | Is it in the same parent container as the original? |
| **Element type match** | 0.15 | Same HTML tag and ARIA role? |
| **Text similarity** | 0.15 | How similar is the accessible name / text content? |
| **Attribute overlap** | 0.10 | How many other attributes (class, type, name) match? |

### Score Interpretation

| Score | Interpretation | Action |
|-------|---------------|--------|
| 0.90 - 1.00 | Very high confidence | Auto-apply, log for batch review |
| 0.80 - 0.89 | High confidence | Auto-apply in quarantine, flag for individual review |
| 0.70 - 0.79 | Moderate confidence | Do not auto-apply, create PR with evidence for review |
| 0.50 - 0.69 | Low confidence | Do not apply, create investigation ticket |
| Below 0.50 | Very low confidence | Discard candidate, manual investigation required |

### Examples

**High confidence (0.92):**
```
Original: getByTestId('submit-payment')
Replacement: getByTestId('pay-button')
Evidence: Same button element, data-testid was renamed in commit abc123.
  Same parent form, same type="submit", same accessible name "Pay now".
```

**Low confidence (0.55):**
```
Original: getByTestId('submit-payment')
Replacement: getByRole('button', { name: 'Continue' })
Evidence: No data-testid found. Found a button in the same form but with
  different text ("Continue" vs expected "Pay now"). May be a different button.
```

---

## Prevention Checklist

Use this checklist when writing new tests to prevent flakiness from the start.

- [ ] **No hardcoded waits.** Every `waitForTimeout` is a flakiness seed. Wait for conditions.
- [ ] **Self-contained data.** Test creates its own data and cleans up. No shared state.
- [ ] **No order dependency.** Test passes when run alone and in any order.
- [ ] **Resilient selectors.** Score 3+ on the stability scale. Prefer testId and role.
- [ ] **Mocked externals.** No real HTTP calls to third-party APIs.
- [ ] **No real clock.** Mock time for anything date/time sensitive.
- [ ] **CI-aware timeouts.** Longer timeouts in CI where resources are shared.
- [ ] **Idempotent assertions.** Assertions work regardless of prior state.
- [ ] **No implicit waits.** Every async operation has an explicit wait condition.
- [ ] **Cleanup in fixture.** Not in `afterEach` (fixtures guarantee cleanup on failure).

---

## Metrics to Track

| Metric | What It Measures | Target | Alert Threshold |
|--------|-----------------|--------|-----------------|
| Flaky test rate | % of tests that pass on retry | < 2% | > 5% |
| Mean time to heal | Days from detection to fix merged | < 5 days | > 14 days |
| Quarantine size | # of tests in quarantine | < 5% of suite | > 10% |
| Quarantine age | Max days a test has been quarantined | < 14 days | > 21 days |
| Selector stability | Average selector score across suite | > 3.5 | < 3.0 |
| Auto-repair accuracy | % of auto-repairs that preserved intent | > 90% | < 80% |
| Fix recurrence | % of fixed flaky tests that flake again within 30 days | < 10% | > 20% |
