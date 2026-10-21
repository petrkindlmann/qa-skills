# Auth Testing Patterns

Test code for OWASP A07 (Authentication Failures) — session management, JWT, and RBAC. The checklist lives in `SKILL.md`.

## Session Management

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

## JWT Testing

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

## RBAC Testing

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
        // toBeOneOf is not a built-in matcher — use toContain against the set
        expect([401, 403]).not.toContain(response.status());
      } else {
        expect([401, 403]).toContain(response.status());
      }
    });
  }
}
```

Also test: session rotation after login (prevent session fixation), JWT signed with wrong key, and OAuth state parameter tampering.

## Failed-Login Throttle with Clock Control

Concurrent-burst tests prove a limiter exists; this proves its window and its boundaries. The
fixture clock replaces sleeps (see `test-data-management` for clock seams in your own app).

```typescript
test('repeated sign-in failures are throttled per account and recover after the window', async ({ request }) => {
  const email = 'alice@example.test';
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await request.post('/api/login', { data: { email, password: `wrong-${attempt}` } });
    expect(response.status()).toBe(401);
  }
  const throttled = await request.post('/api/login', { data: { email, password: 'wrong-6' } });
  expect(throttled.status()).toBe(429);
  expect(throttled.headers()['retry-after']).toBe('60');

  // The correct password must not bypass the throttle, and no session may exist.
  expect((await request.post('/api/login', { data: { email, password: 'Alice-secret-123!' } })).status()).toBe(429);
  expect((await request.get('/api/me')).status()).toBe(401);

  // Unknown addresses throttle identically, so the limiter cannot be used to enumerate accounts.
  for (let attempt = 1; attempt <= 5; attempt += 1) await request.post('/api/login', { data: { email: 'nobody@example.test', password: 'x' } });
  expect((await request.post('/api/login', { data: { email: 'nobody@example.test', password: 'x' } })).status()).toBe(429);

  await request.post('/test-support/clock', { headers: { 'X-Test-Admin-Key': process.env.TEST_ADMIN_KEY! }, data: { advance_seconds: 61 } });
  expect((await request.post('/api/login', { data: { email, password: 'Alice-secret-123!' } })).status()).toBe(200);
});
```

## Debug and Test-Support Routes Stay Locked

Support endpoints that exist for tests are an attack surface in every other environment.
Assert the lock from outside, with no key, a guessed key and an empty key:

```typescript
for (const headers of [{}, { 'X-Test-Admin-Key': 'guessed' }, { 'X-Test-Admin-Key': '' }]) {
  expect((await request.get('/test-support/state', { headers })).status()).toBe(403);
  expect((await request.post('/test-support/clock', { headers, data: { advance_seconds: 1 } })).status()).toBe(403);
}
```
