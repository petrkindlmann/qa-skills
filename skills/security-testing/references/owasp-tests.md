# OWASP Top 10 (2025) — Test Code

Runnable Playwright test patterns for each OWASP 2025 category. The `What to test` prose and checklist live in `SKILL.md`; this file holds the implementations.

## Asserting a set of acceptable status codes

Several security tests accept more than one valid status (e.g. an SSRF block may return 400, 403, or 422). **`toBeOneOf` is NOT a built-in Playwright/Jest/Vitest matcher** — `expect(x).toBeOneOf([...])` throws `toBeOneOf is not a function` at runtime. Use the built-in `toContain` against the acceptable set instead:

```typescript
// GOOD — runs everywhere, no custom matcher needed
expect([400, 403, 422]).toContain(response.status());

// BAD — crashes: toBeOneOf is not a built-in matcher
// expect(response.status()).toBeOneOf([400, 403, 422]);
```

If you genuinely prefer the `toBeOneOf` reading, register it once before your suite (`expect.extend({ toBeOneOf(received, set) { return { pass: set.includes(received), message: () => \`expected \${received} in \${set}\` }; } });`). The patterns below use the matcher-free `toContain` form so they run as-is.

## A01: Broken Access Control

IDOR, vertical privilege escalation, CORS, and SSRF (now treated as an access-control failure when the server is induced to reach internal resources).

```typescript
// IDOR test: user A should not access user B's order
test('should reject access to another user\'s order', async ({ request }) => {
  const response = await request.get('/api/orders/order-belonging-to-user-b', {
    headers: { Authorization: `Bearer ${userAToken}` },
  });
  expect(response.status()).toBe(403);
});

// Vertical privilege escalation: regular user hits admin endpoint
test('should reject non-admin from admin endpoints', async ({ request }) => {
  const response = await request.delete('/api/admin/users/some-user-id', {
    headers: { Authorization: `Bearer ${regularUserToken}` },
  });
  expect(response.status()).toBe(403);
});

// CORS: verify only allowed origins
test('should reject cross-origin requests from untrusted origins', async ({ request }) => {
  const response = await request.get('/api/user/profile', {
    headers: {
      Origin: 'https://evil-site.example.com',
      Authorization: `Bearer ${validToken}`,
    },
  });
  const corsHeader = response.headers()['access-control-allow-origin'];
  expect(corsHeader).not.toBe('*');
  expect(corsHeader).not.toBe('https://evil-site.example.com');
});

// SSRF: prevent internal network access via user-supplied URLs
const ssrfPayloads = [
  'http://169.254.169.254/latest/meta-data/',  // AWS metadata
  'http://metadata.google.internal/',           // GCP metadata
  'http://localhost:6379/',                     // Redis
  'http://127.0.0.1:3000/api/admin',           // Loopback
  'file:///etc/passwd',                         // Local file
  'gopher://127.0.0.1:25/',                     // Protocol smuggling
];

for (const payload of ssrfPayloads) {
  test(`should block SSRF attempt: ${new URL(payload).hostname || payload}`, async ({ request }) => {
    const response = await request.post('/api/webhook/test', {
      data: { callbackUrl: payload },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect([400, 403, 422]).toContain(response.status());
  });
}
```

## A02: Security Misconfiguration

```typescript
test('should not expose stack traces in production errors', async ({ request }) => {
  const response = await request.get('/api/nonexistent-endpoint');
  const body = await response.text();
  expect(body).not.toContain('at Object.');
  expect(body).not.toContain('node_modules');
  expect(body).not.toMatch(/\.ts:\d+:\d+/);
  expect(body).not.toMatch(/\.js:\d+:\d+/);
});

test('should disable TRACE method', async ({ request }) => {
  const response = await request.fetch('/api/health', { method: 'TRACE' });
  // Frameworks vary: 405 (method not allowed), 501 (not implemented), or 403.
  // The security property is "TRACE is not enabled / not echoed", so assert the
  // acceptable set, not a single code, and confirm the request body is not reflected.
  expect([403, 405, 501]).toContain(response.status());
  expect(await response.text()).not.toContain('TRACE /api/health');
});
```

## A03: Software Supply Chain Failures

New in 2025 — provenance, build pipeline integrity, SBOM.

```yaml
# GitHub Actions: dependency review + SBOM generation + provenance signing
supply-chain:
  runs-on: ubuntu-latest
  permissions:
    contents: read
    id-token: write   # for cosign keyless signing
    attestations: write
  steps:
    - uses: actions/checkout@v5
    - uses: actions/dependency-review-action@v4
      with:
        fail-on-severity: high
        comment-summary-in-pr: on-failure

    - uses: anchore/sbom-action@v0
      with:
        format: cyclonedx-json
        output-file: sbom.cdx.json

    - uses: actions/attest-build-provenance@v2
      with:
        subject-path: dist/

    - uses: actions/upload-artifact@v5
      with: { name: sbom, path: sbom.cdx.json }
```

```typescript
// Lockfile drift check (Node example)
import { execSync } from 'node:child_process';
test('lockfile is up to date with package.json', () => {
  // npm ci fails when package.json and lockfile disagree — perfect for CI
  expect(() => execSync('npm ci --dry-run', { stdio: 'pipe' })).not.toThrow();
});
```

Tooling — pick the layer that fits:
- **Vulnerability scanners:** OSV-Scanner, Trivy, Grype, Snyk, GitHub Dependabot
- **SBOM generation:** Syft, CycloneDX CLI, `actions/dependency-review-action`
- **Provenance/signing:** cosign, Sigstore, SLSA reference generators
- **Policy:** OpenSSF Scorecard for repo hygiene; Semgrep Supply Chain Pro for transitive policy

## A04: Cryptographic Failures

```typescript
test('should set secure cookie flags on session', async ({ request }) => {
  const response = await request.post('/api/auth/login', {
    data: { email: 'test@example.com', password: 'validPassword1!' },
  });
  const setCookie = response.headers()['set-cookie'] ?? '';
  expect(setCookie).toContain('Secure');
  expect(setCookie).toContain('HttpOnly');
  expect(setCookie).toMatch(/SameSite=(Strict|Lax)/);
});

test('should include security headers', async ({ request }) => {
  const response = await request.get('/');
  expect(response.headers()['strict-transport-security']).toBeDefined();
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect(response.headers()['x-frame-options']).toMatch(/DENY|SAMEORIGIN/);
});
```

## A05: Injection

SQLi, XSS (reflected/stored/DOM), CSRF, command injection.

```typescript
// SQL injection patterns
const sqlPayloads = [
  "' OR '1'='1",
  "'; DROP TABLE users; --",
  "1 UNION SELECT null, username, password FROM users --",
  "admin'--",
];

for (const payload of sqlPayloads) {
  test(`should reject SQL injection: ${payload.slice(0, 30)}`, async ({ request }) => {
    const response = await request.get(`/api/search?q=${encodeURIComponent(payload)}`);
    expect(response.status()).not.toBe(500); // Server error = likely vulnerable
    const body = await response.text();
    expect(body).not.toContain('SQL');
    expect(body).not.toContain('syntax error');
    expect(body).not.toContain('mysql');
  });
}

// XSS via stored user input
test('should sanitize stored XSS in user profile', async ({ page }) => {
  const xssPayload = '<img src=x onerror=alert(document.cookie)>';
  // Store malicious input via API
  await page.request.put('/api/profile', {
    data: { displayName: xssPayload },
    headers: { Authorization: `Bearer ${token}` },
  });
  // Load page that renders the profile
  await page.goto('/profile');
  // Verify the script did not execute (no alert dialog)
  // and the content is either escaped or stripped
  const nameElement = page.getByTestId('display-name');
  const nameText = await nameElement.innerHTML();
  expect(nameText).not.toContain('<img');
  expect(nameText).not.toContain('onerror');
});

// CSRF: state-changing requests require valid token
test('should reject POST without CSRF token', async ({ request }) => {
  const response = await request.post('/api/account/change-email', {
    data: { email: 'attacker@example.com' },
    headers: { Cookie: `session=${validSessionCookie}` },
    // Deliberately omitting CSRF token
  });
  // CSRF middleware rejects with 403 (forbidden) or 422 (unprocessable) depending on stack
  expect([403, 422]).toContain(response.status());
});
```

## A06: Insecure Design

Rate limiting on auth endpoints, business logic abuse (negative quantities, coupon stacking), missing account lockout, allow-list architecture for any feature that fetches a user-supplied URL. The design-level test that catches the most: fire a burst of logins and require the backend to throttle.

```typescript
test('login endpoint rate-limits a burst of attempts', async ({ request }) => {
  // Fire 15 concurrent failed logins; a rate-limited endpoint returns 429 for some.
  const attempts = Array.from({ length: 15 }, () =>
    request.post('/api/auth/login', {
      data: { email: 'victim@example.com', password: 'wrong-password' },
    }),
  );
  const responses = await Promise.all(attempts);
  const statuses = responses.map((r) => r.status());
  expect(statuses.some((s) => s === 429)).toBe(true);
});
```

## A07: Authentication Failures

See `references/auth-tests.md`.

## A08: Software or Data Integrity Failures

```typescript
test('should include Content-Security-Policy', async ({ request }) => {
  const response = await request.get('/');
  const csp = response.headers()['content-security-policy'];
  expect(csp).toBeDefined();
  expect(csp).not.toContain("'unsafe-inline'");
  expect(csp).not.toContain("'unsafe-eval'");
});
```

## A09: Security Logging and Alerting Failures

No standalone code — assert that failed logins are logged AND alert above threshold, admin actions are audit-logged AND alert out-of-hours, logs contain no secrets/PII, and the alert pipeline is itself monitored.

## A10: Mishandling of Exceptional Conditions

New in 2025 — fail-open defaults, uncaught exceptions leaking internals, race conditions in error paths, skipped security checks on failure.

```typescript
import { test, expect } from '@playwright/test';

test('error responses fail closed (no auth bypass on 500)', async ({ request }) => {
  // Trigger a server-side error and confirm the route still requires auth
  const response = await request.post('/api/admin/trigger-error', {
    headers: { /* no Authorization header */ },
    data: { causeError: true },
  });
  // Must NOT be 500 with admin-action side effects — must be 401/403
  expect([401, 403]).toContain(response.status());
});

test('error response does not leak internals', async ({ request }) => {
  const response = await request.post('/api/process', { data: { invalid: '  ' } });
  const body = await response.text();
  for (const leak of ['Traceback', 'at Object.', 'node_modules', 'pg:', 'mysql:', 'PSQLException']) {
    expect(body, `Leaked "${leak}" in error body`).not.toContain(leak);
  }
});

test('partial failures do not skip authorization', async ({ request }) => {
  // Inject a downstream failure (e.g. via a test-only header your service honors in non-prod)
  const response = await request.post('/api/transfer', {
    headers: { Authorization: `Bearer ${userAToken}`, 'X-Test-Inject-Downstream-Failure': 'auth-cache' },
    data: { fromAccount: 'B-account-not-owned-by-A', amount: 1 },
  });
  expect(response.status()).toBe(403); // not 500 with the transfer queued
});
```

For broad coverage, pair manual error-path tests with property-based testing or fuzzing (`fast-check`, `schemathesis`, ZAP active scan with `-a`).
