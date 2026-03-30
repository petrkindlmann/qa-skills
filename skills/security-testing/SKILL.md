---
name: security-testing
description: >-
  Test application security against OWASP Top 10 vulnerabilities. Covers OWASP ZAP
  integration, dependency scanning (Snyk/Dependabot), SAST with ESLint security
  plugins, auth/session testing (JWT, OAuth), XSS/CSRF/SQLi patterns, and CI
  integration for continuous security validation.
  Use when: "security test," "OWASP," "vulnerability," "pen test," "ZAP," "XSS,"
  "dependency scan," "auth testing."
  Related: ci-cd-integration, compliance-testing, api-testing.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: automation
---

<objective>
Test application security systematically against known vulnerability classes with automated tooling integrated into CI.
</objective>

**Before starting:** Check for `.agents/qa-project-context.md` in the project root. It contains auth mechanisms, compliance requirements, and infrastructure details that determine which security checks apply.

---

## Discovery Questions

1. **Threat model:** Has the team identified key assets, threat actors, and attack surfaces? If not, start with a lightweight threat model before writing security tests.
2. **Auth mechanism:** Session cookies, JWT, OAuth 2.0/OIDC, API keys, or multi-factor? Each has distinct test patterns.
3. **Compliance requirements:** SOC 2, HIPAA, PCI DSS, GDPR? These mandate specific security controls that must be validated.
4. **Existing security tooling:** Already running Snyk, Dependabot, SonarQube, or ZAP? Check CI config for existing security stages.
5. **API surface:** REST, GraphQL, gRPC? Each protocol has specific injection and authorization vulnerabilities.
6. **Deployment model:** Cloud (AWS/GCP/Azure), containers, serverless? Infrastructure misconfigurations are OWASP #5.

---

## Core Principles

1. **Security is a mindset, not a phase.** Security testing is continuous. It runs in CI on every PR, not as a quarterly penetration test.

2. **OWASP Top 10 is the minimum.** It covers the most common and impactful vulnerability classes. It is not exhaustive -- domain-specific threats (healthcare data, financial transactions) require additional analysis.

3. **Shift-left security.** Catch vulnerabilities at the earliest possible stage: SAST in the IDE, dependency scanning on commit, DAST in staging, penetration testing before release.

4. **Defense in depth.** No single tool catches everything. Layer SAST + dependency scanning + DAST + auth testing + secret scanning for comprehensive coverage.

5. **Continuous dependency scanning.** 80%+ of application code is third-party. Known vulnerabilities in dependencies are the lowest-effort attack vector. Scan on every build.

---

## OWASP Top 10 (2021) Testing Checklist

### A01: Broken Access Control

The #1 vulnerability. Users can act outside their intended permissions.

**What to test:**
- Insecure Direct Object References (IDOR): change resource IDs in URLs/API calls to access other users' data
- Missing function-level access control: access admin endpoints as a regular user
- Path traversal: `../../etc/passwd` in file parameters
- CORS misconfiguration: can a malicious origin make authenticated requests?

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
```

### A02: Cryptographic Failures

Sensitive data exposed due to weak or missing encryption.

**What to test:**
- Data in transit: TLS version, cipher suites, HSTS header
- Data at rest: passwords hashed with bcrypt/argon2 (not MD5/SHA1)
- Sensitive data in URLs, logs, or error messages
- Cookies missing `Secure`, `HttpOnly`, `SameSite` flags

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

### A03: Injection

Untrusted data sent to an interpreter as part of a command or query.

**What to test:**
- SQL injection in query parameters, form fields, headers
- XSS (reflected, stored, DOM-based) in user-generated content
- CSRF on state-changing operations
- Command injection in file names, search queries, webhook URLs

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
  expect(response.status()).toBe(403);
});
```

### A04: Insecure Design

Flawed architecture that cannot be fixed by implementation alone.

**What to test:** Rate limiting on auth endpoints (fire 15 concurrent login attempts, expect 429), business logic abuse (negative quantities, coupon stacking), missing account lockout after failed attempts.

### A05: Security Misconfiguration

Default credentials, unnecessary features enabled, overly verbose errors.

**What to test:**
- Debug/stack traces disabled in production
- Default credentials changed
- Unnecessary HTTP methods disabled
- Directory listing disabled
- Admin panels not publicly accessible

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
  expect(response.status()).toBe(405);
});
```

### A06: Vulnerable and Outdated Components

Known vulnerabilities in third-party dependencies.

**Automated scanning (see CI Integration section below).**

### A07: Identification and Authentication Failures

Broken authentication, weak passwords, credential stuffing.

**See Auth Testing Patterns section below.**

### A08: Software and Data Integrity Failures

Unsigned updates, insecure deserialization, untrusted CI/CD pipelines.

**What to test:**
- Subresource Integrity (SRI) on CDN scripts
- Content Security Policy headers

```typescript
test('should include Content-Security-Policy', async ({ request }) => {
  const response = await request.get('/');
  const csp = response.headers()['content-security-policy'];
  expect(csp).toBeDefined();
  expect(csp).not.toContain("'unsafe-inline'");
  expect(csp).not.toContain("'unsafe-eval'");
});
```

### A09: Security Logging and Monitoring Failures

Insufficient logging of security events.

**What to test:**
- Failed login attempts are logged
- Admin actions are audit-logged
- Logs do not contain sensitive data (passwords, tokens, PII)

### A10: Server-Side Request Forgery (SSRF)

Server makes requests to attacker-controlled URLs.

```typescript
// SSRF: prevent internal network access via user-supplied URLs
const ssrfPayloads = [
  'http://169.254.169.254/latest/meta-data/',  // AWS metadata
  'http://localhost:6379/',                      // Redis
  'http://127.0.0.1:3000/api/admin',            // Loopback
  'file:///etc/passwd',                          // Local file
];

for (const payload of ssrfPayloads) {
  test(`should block SSRF attempt: ${new URL(payload).hostname}`, async ({ request }) => {
    const response = await request.post('/api/webhook/test', {
      data: { callbackUrl: payload },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status()).toBeOneOf([400, 403, 422]);
  });
}
```

---

## Automated Security Scanning

### OWASP ZAP

```yaml
# GitHub Actions: ZAP baseline scan against staging
security-scan:
  runs-on: ubuntu-latest
  steps:
    - name: ZAP Baseline Scan
      uses: zaproxy/action-baseline@v0.14.0
      with:
        target: 'https://staging.example.com'
        rules_file_name: '.zap/rules.tsv'
        cmd_options: '-a'
    - name: Upload ZAP Report
      if: always()
      uses: actions/upload-artifact@v4
      with:
        name: zap-report
        path: report_html.html
```

For API scanning, use `zap-api-scan.py` with your OpenAPI spec. For full scans, use `zap-full-scan.py` via Docker (`ghcr.io/zaproxy/zaproxy:stable`).

### Dependency Scanning

```yaml
# GitHub Actions: npm audit + Snyk
dependency-check:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - run: npm ci
    - name: npm audit
      run: npm audit --audit-level=high
      continue-on-error: true

    - name: Snyk test
      uses: snyk/actions/node@master
      env:
        SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
      with:
        args: --severity-threshold=high
```

Configure Dependabot in `.github/dependabot.yml` with daily npm updates and security team reviewers.

### SAST (Static Analysis)

```javascript
// .eslintrc.js -- security-focused plugins
module.exports = {
  plugins: ['security', 'no-unsanitized'],
  extends: ['plugin:security/recommended-legacy'],
  rules: {
    'security/detect-object-injection': 'warn',
    'security/detect-non-literal-regexp': 'warn',
    'security/detect-unsafe-regex': 'error',
    'security/detect-eval-with-expression': 'error',
    'no-unsanitized/method': 'error',
    'no-unsanitized/property': 'error',
  },
};
```

For deeper multi-language SAST, use Semgrep (`semgrep/semgrep-action@v1`) with rulesets `p/owasp-top-ten`, `p/javascript`, `p/typescript`.

### Secret Scanning

Use TruffleHog (`trufflesecurity/trufflehog@main`) in CI with `--only-verified` and full git history (`fetch-depth: 0`). For pre-commit prevention, use `git-secrets` with `git secrets --install && git secrets --register-aws`.

---

## Auth Testing Patterns

### Session Management

```typescript
test('should invalidate session on logout', async ({ request, context }) => {
  // Login and get session
  const loginResponse = await request.post('/api/auth/login', {
    data: { email: 'test@example.com', password: 'validPassword1!' },
  });
  const sessionCookie = loginResponse.headers()['set-cookie'];

  // Logout
  await request.post('/api/auth/logout');

  // Attempt to use old session
  const response = await request.get('/api/user/profile', {
    headers: { Cookie: sessionCookie },
  });
  expect(response.status()).toBe(401);
});

```

### JWT Testing

```typescript
import * as jose from 'jose';

test('should reject expired JWT', async ({ request }) => {
  const expiredToken = await new jose.SignJWT({ sub: 'user-1' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('-1h') // Expired 1 hour ago
    .sign(new TextEncoder().encode('test-secret'));

  const response = await request.get('/api/user/profile', {
    headers: { Authorization: `Bearer ${expiredToken}` },
  });
  expect(response.status()).toBe(401);
});

test('should reject JWT with "none" algorithm', async ({ request }) => {
  // Algorithm confusion attack: forged token with alg: none
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'admin', role: 'admin' })).toString('base64url');
  const noneToken = `${header}.${payload}.`;

  const response = await request.get('/api/admin/dashboard', {
    headers: { Authorization: `Bearer ${noneToken}` },
  });
  expect(response.status()).toBe(401);
});

```

### RBAC Testing

```typescript
const endpoints = [
  { method: 'GET', path: '/api/admin/users', allowedRoles: ['admin'] },
  { method: 'DELETE', path: '/api/admin/users/u-1', allowedRoles: ['admin'] },
  { method: 'GET', path: '/api/reports', allowedRoles: ['admin', 'manager'] },
  { method: 'GET', path: '/api/profile', allowedRoles: ['admin', 'manager', 'user'] },
];

for (const endpoint of endpoints) {
  for (const role of ['admin', 'manager', 'user', 'guest']) {
    const shouldAllow = endpoint.allowedRoles.includes(role);
    test(`${role} ${shouldAllow ? 'can' : 'cannot'} ${endpoint.method} ${endpoint.path}`, async ({ request }) => {
      const token = await getTokenForRole(role);
      const response = await request.fetch(endpoint.path, {
        method: endpoint.method,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (shouldAllow) {
        expect(response.status()).not.toBeOneOf([401, 403]);
      } else {
        expect(response.status()).toBeOneOf([401, 403]);
      }
    });
  }
}
```

Also test: session rotation after login (prevent session fixation), JWT signed with wrong key, and OAuth state parameter tampering.

---

## CI Integration

A complete security pipeline has five layers, each as a CI step:

1. **Secret scanning** -- TruffleHog with `--only-verified`
2. **Dependency check** -- `npm audit --audit-level=high`
3. **SAST** -- ESLint security plugins against source
4. **DAST** -- ZAP baseline scan against staging URL
5. **Custom auth tests** -- `npx playwright test --project=security`

### Security as PR Gate

Block merges when `npm audit --json` reports high/critical vulnerabilities. Parse the JSON output and fail the step with `exit 1` if count > 0.

---

## Anti-Patterns

**Security testing only before release.** Vulnerabilities found late are expensive to fix. Run security scans on every PR, not quarterly.

**Relying on a single tool.** ZAP misses auth logic bugs. Snyk misses custom code vulnerabilities. ESLint misses runtime issues. Layer multiple tools for defense in depth.

**Ignoring npm audit warnings.** "We'll fix it later" becomes a backlog of known vulnerabilities. Treat high/critical dependency vulnerabilities as build failures.

**Testing only happy-path auth.** Login works -- great. Does logout actually invalidate the session? Can an expired token still access resources? Does role escalation work?

**Hardcoding secrets in test files.** Security tests that contain real API keys or passwords are themselves a vulnerability. Use environment variables and CI secrets.

**Skipping SSRF testing.** Any feature that accepts a URL (webhooks, image uploads, imports) is an SSRF vector. Test with internal network addresses.

**Testing only known payloads.** The XSS and SQLi payloads above are examples, not an exhaustive list. Use tools like ZAP that maintain current payload databases.

---

## Done When

- OWASP Top 10 checklist reviewed against the application and each item marked as tested, mitigated, or accepted risk with justification.
- ZAP passive scan run against the staging environment with all findings triaged (critical/high addressed, medium/low tracked in backlog).
- Dependency scanning enabled on the repository via Snyk or Dependabot, with high/critical vulnerabilities treated as build failures.
- SAST lint rules (ESLint security plugin or Semgrep) enabled in CI and producing zero unresolved errors on the main branch.
- Auth and session edge cases explicitly tested: CSRF protection, token expiry rejection, session invalidation on logout, and role escalation prevention.

## Related Skills

- **ci-cd-integration** -- Pipeline stages for security scanning, gating deployments on security results.
- **compliance-testing** -- Mapping security tests to regulatory requirements (SOC 2, HIPAA, PCI).
- **api-testing** -- API-specific security patterns: auth header validation, input sanitization, rate limiting.
- **test-environments** -- Secure test environment configuration, secret management, network isolation.
- **database-testing** -- Data integrity validation, access control at the database level.
