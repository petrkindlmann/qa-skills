# Bug Classification Taxonomy

Comprehensive taxonomy for classifying bugs across the triage pipeline. Used by both deterministic classifiers and LLM classification prompts.

---

## Bug Categories

### Functional Bugs

Defects where the application does not behave as specified.

| Subcategory | Description | Examples |
|-------------|------------|---------|
| **Logic error** | Wrong computation, wrong branch taken | Discount applied twice, wrong total calculation |
| **Data handling** | Incorrect create/read/update/delete | Record not saved, stale cache served, wrong user's data shown |
| **State management** | Invalid state transitions, stale state | Button stays disabled after loading completes, modal cannot be closed |
| **Validation** | Missing or incorrect input validation | Accepts negative quantity, allows SQL in name field |
| **Integration** | Failure at service boundary | API returns 500, webhook payload malformed, third-party timeout not handled |
| **Authorization** | Wrong access control enforcement | Regular user can access admin endpoint, deleted user can still log in |
| **Edge case** | Correct logic breaks at boundary values | Works for 1-99 items, crashes at 100; handles ASCII but not emoji |

### Non-Functional Bugs

Defects where the application works but fails quality attributes.

| Subcategory | Description | Examples |
|-------------|------------|---------|
| **Performance** | Unacceptable latency, resource usage, or throughput | Page loads in 8s, memory leak after 1000 requests, API p99 > 5s |
| **Accessibility** | Fails WCAG compliance or assistive technology | Missing alt text, no keyboard focus, color-only error indication |
| **Security** | Vulnerability or exposure, not an auth logic error | XSS in input field, API key leaked in client bundle, missing CSRF token |
| **Usability** | Works but confusing or error-prone | Ambiguous error message, destructive action with no confirmation |
| **Reliability** | Intermittent failures under normal conditions | Random 502 under low load, connection dropped mid-upload |
| **Compatibility** | Works in some environments but not others | Broken on Safari, wrong layout on mobile, fails on Node 18 |

### Test Bugs

Defects in the test itself, not the application.

| Subcategory | Description | Examples |
|-------------|------------|---------|
| **Wrong assertion** | Test asserts the wrong thing | Checks old error message text, asserts implementation detail |
| **Bad selector** | Locator does not find the right element | CSS selector broke after redesign, data-testid was removed |
| **Missing wait** | Test does not wait for async operation | Assertion runs before API response arrives |
| **Shared state** | Test depends on another test's side effects | Fails when run in isolation or in different order |
| **Stale test data** | Test data expired or was cleaned up | Token expired, seeded record deleted by another test |
| **Wrong setup** | Preconditions not established correctly | Test assumes user exists but does not create one |

### Environment Issues

Not a code defect -- infrastructure or configuration problem.

| Subcategory | Description | Examples |
|-------------|------------|---------|
| **CI resource** | Runner out of memory, disk, or CPU | Docker OOM kill, disk full, container timeout |
| **Network** | Connectivity or DNS failure | Cannot reach external API, DNS resolution timeout |
| **Service dependency** | External service down or degraded | Database connection pool exhausted, Redis unreachable |
| **Configuration** | Wrong environment variables or settings | Missing API key, wrong database URL, stale cache config |
| **Version mismatch** | Different version in CI vs local | Node 18 vs 20, browser version mismatch, package lock drift |

### Build Failures

Failure before tests run.

| Subcategory | Description | Examples |
|-------------|------------|---------|
| **Compilation** | Code does not compile | TypeScript type error, missing import, syntax error |
| **Dependency** | Package resolution failure | Version conflict, deleted package, registry timeout |
| **Configuration** | Build tool misconfiguration | Wrong webpack config, missing environment variable at build time |
| **Asset** | Static asset processing failure | Image optimization crash, CSS preprocessor error |

---

## Severity Definitions (Detailed)

### Critical

**Impact:** System is unusable for a significant user segment. Data loss or corruption occurs. Security breach is possible.

**Criteria (any one is sufficient):**
- Users cannot complete core workflows (login, checkout, save)
- Data is lost, corrupted, or exposed to wrong users
- Security vulnerability that can be exploited without authentication
- System crashes or becomes unresponsive for all users
- Financial calculations produce wrong results
- Compliance violation (GDPR data leak, HIPAA breach)

**Response:** Immediate action. All hands on fix. Hotfix release if in production.

**Examples:**
- Payment is processed but order is not created (money taken, nothing delivered)
- API returns other user's data when authenticated
- Application crashes on startup after latest deploy
- SQL injection possible in search endpoint

### Major

**Impact:** Core feature is broken or significantly degraded. Workaround exists but is unreasonable for regular use.

**Criteria (any one is sufficient):**
- Core feature fails under common conditions but has a workaround
- Data is incorrect but not lost (wrong calculation, stale cache)
- Performance degradation makes feature barely usable (>5s response time)
- Accessibility barrier blocks a user group from a core feature
- Feature works on desktop but completely broken on mobile (or vice versa)

**Response:** Fix within current sprint. May trigger a patch release.

**Examples:**
- Search returns incorrect results but filtering still works
- Checkout requires page reload between steps but does complete
- Screen reader cannot navigate the main navigation menu
- Export generates file but with wrong column order

### Minor

**Impact:** Non-core feature affected. Workaround is trivial. Affects user experience but not critical workflows.

**Criteria:**
- Non-core feature fails (sorting, filtering secondary list, tooltip)
- Cosmetic issue with functional impact (button appears disabled but works on click)
- Feature works but requires extra steps (must refresh to see updated data)
- Affects small user segment or uncommon use case

**Response:** Fix next sprint or within the next release.

**Examples:**
- Table sorting does not persist across page navigation
- Date picker does not support keyboard input (mouse works)
- Notification badge shows wrong count but clears on click
- Tooltip clips on small screens

### Trivial

**Impact:** Cosmetic only. No functional impact whatsoever.

**Criteria:**
- Visual-only issue (alignment, spacing, color)
- Text-only issue (typo, capitalization, wording)
- No user confusion or workflow disruption

**Response:** Fix when convenient. OK to batch with other changes.

**Examples:**
- 1px misalignment between two buttons
- "Cancelled" vs "Canceled" inconsistency
- Extra whitespace in footer
- Placeholder text in non-English character set slightly off

---

## Component Mapping Rules

Map failures to components for routing to the right team.

### File Path to Component

```
src/auth/**          → Authentication
src/checkout/**      → Checkout
src/cart/**           → Cart
src/products/**      → Product Catalog
src/orders/**        → Order Management
src/users/**         → User Management
src/admin/**         → Admin Panel
src/api/**           → API Layer
src/shared/**        → Shared/Platform
src/workers/**       → Background Jobs
e2e/**               → Test Infrastructure
.github/**           → CI/CD
```

### Stack Trace to Component

When file paths are not available (e.g., production minified stack):

```
URL contains /checkout   → Checkout
URL contains /cart        → Cart
URL contains /account     → User Management
URL contains /admin       → Admin Panel
URL contains /api/v       → API Layer
URL is root (/)           → Landing/Home
Error in middleware        → Platform/Infra
Error in database layer    → Data Layer
```

### Error Type to Component

When stack traces are unavailable:

```
Auth/token errors         → Authentication
Payment/billing errors    → Checkout
CRUD operation errors     → Component from entity name
Rate limiting errors      → API Layer / Platform
Rendering errors          → Frontend / Component from route
Worker/job errors         → Background Jobs
```

---

## Root Cause Categories

Classify the underlying cause to prevent recurrence.

| Root Cause | Description | Prevention |
|-----------|-------------|------------|
| **Missing validation** | Input not validated before processing | Input validation checklist in PR review |
| **Race condition** | Concurrent operations produce wrong result | Pessimistic locking, idempotency keys |
| **State inconsistency** | UI state diverges from server state | Optimistic updates with reconciliation |
| **Missing error handling** | Error not caught or handled | Error boundary requirements in definition of done |
| **Wrong assumption** | Code assumes condition that is not guaranteed | Document assumptions in code comments |
| **API contract change** | Upstream API changed without notice | Contract tests, schema validation |
| **Configuration drift** | Environment config differs from expected | Infrastructure as code, config validation on startup |
| **Dependency issue** | Library bug or breaking change | Pin versions, automated dependency updates with tests |
| **Data migration** | Data schema changed without migrating existing records | Migration scripts, dual-write periods |
| **Missing feature flag** | Feature shipped without gradual rollout | Feature flag checklist for all user-facing changes |

---

## Classification Decision Tree

Use this decision tree when manually classifying or validating LLM classification.

```
1. Does the application code have a defect?
   ├── YES → Functional or Non-Functional Bug
   │   ├── Does it produce wrong output/behavior?
   │   │   ├── YES → FUNCTIONAL BUG → Logic | Data | State | Validation | Integration | Auth | Edge
   │   │   └── NO → NON-FUNCTIONAL BUG → Performance | A11y | Security | Usability | Reliability
   │   └── Is it a regression (worked before)?
   │       ├── YES → Tag as regression, increase priority
   │       └── NO → New bug, normal priority
   │
   ├── NO → Is the test correct?
   │   ├── NO → TEST BUG → Wrong assertion | Bad selector | Missing wait | Shared state | Stale data
   │   └── YES → Is the environment healthy?
   │       ├── NO → ENVIRONMENT ISSUE → CI resource | Network | Service dep | Config | Version
   │       └── YES → FLAKY TEST → Investigate with test-reliability skill
   │
   └── UNSURE → Gather more evidence
       ├── Run test locally → same result? → Likely app bug
       ├── Run test in isolation → passes? → Likely shared state / order dependency
       ├── Check CI resource metrics → spike? → Likely environment
       └── Check recent deploys → none? → Likely flaky or environment
```
