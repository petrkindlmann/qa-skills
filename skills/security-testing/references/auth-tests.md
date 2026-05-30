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
        expect(response.status()).not.toBeOneOf([401, 403]);
      } else {
        expect(response.status()).toBeOneOf([401, 403]);
      }
    });
  }
}
```

Also test: session rotation after login (prevent session fixation), JWT signed with wrong key, and OAuth state parameter tampering.
