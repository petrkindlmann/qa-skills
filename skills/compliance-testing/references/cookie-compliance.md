# Cookie Compliance — Test Code

A typed cookie inventory is the source of truth; the tests assert that actual cookies match it. The decision prose lives in `SKILL.md`; this file holds the implementations.

## Cookie Inventory

Maintain a typed cookie inventory as the source of truth. Test that actual cookies match the inventory.

```typescript
// cookie-inventory.ts
interface CookieDefinition {
  name: string;
  category: 'necessary' | 'analytics' | 'functional' | 'marketing';
  purpose: string;
  maxExpiry: number;     // Maximum days
  secure: boolean;
  httpOnly: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

export const COOKIE_INVENTORY: CookieDefinition[] = [
  { name: '__Host-session', category: 'necessary', purpose: 'Session ID',
    maxExpiry: 1, secure: true, httpOnly: true, sameSite: 'Lax' },
  { name: 'csrf_token', category: 'necessary', purpose: 'CSRF protection',
    maxExpiry: 1, secure: true, httpOnly: true, sameSite: 'Strict' },
  { name: 'consent_status', category: 'necessary', purpose: 'Consent choice',
    maxExpiry: 365, secure: true, httpOnly: false, sameSite: 'Lax' },
  { name: '_ga', category: 'analytics', purpose: 'GA client ID',
    maxExpiry: 730, secure: true, httpOnly: false, sameSite: 'Lax' },
  { name: '_fbp', category: 'marketing', purpose: 'Facebook Pixel',
    maxExpiry: 90, secure: true, httpOnly: false, sameSite: 'Lax' },
];
```

## Cookie Attribute Validation

```typescript
test('all cookies match inventory attributes', async ({ page, context }) => {
  await page.goto('/');
  const banner = page.getByRole('dialog', { name: /consent/i });
  if (await banner.isVisible()) await banner.getByRole('button', { name: /accept/i }).click();
  await page.goto('/dashboard');
  await page.waitForTimeout(2000);

  const cookies = await context.cookies();
  const violations: string[] = [];

  for (const cookie of cookies) {
    const def = COOKIE_INVENTORY.find((d) => cookie.name === d.name || cookie.name.startsWith(d.name));
    if (!def) { violations.push(`Unknown cookie: "${cookie.name}" (${cookie.domain})`); continue; }

    if (def.secure && !cookie.secure) violations.push(`${cookie.name}: missing Secure flag`);
    if (def.httpOnly && !cookie.httpOnly) violations.push(`${cookie.name}: missing HttpOnly flag`);
    if (cookie.sameSite !== def.sameSite) violations.push(`${cookie.name}: SameSite "${cookie.sameSite}" != "${def.sameSite}"`);

    if (cookie.expires > 0) {
      const days = (cookie.expires - Date.now() / 1000) / 86400;
      if (days > def.maxExpiry) violations.push(`${cookie.name}: expires in ${Math.round(days)}d, max ${def.maxExpiry}d`);
    }
  }

  expect(violations, violations.join('\n')).toHaveLength(0);
});
```

## Cookie Inventory Drift Detection

Detect when new cookies appear that are not in the inventory:

```typescript
test('no unknown cookies', { tag: ['@compliance'] }, async ({ page, context }) => {
  await page.goto('/');
  const banner = page.getByRole('dialog', { name: /consent/i });
  if (await banner.isVisible()) await banner.getByRole('button', { name: /accept/i }).click();

  for (const path of ['/', '/dashboard', '/settings', '/pricing']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }

  const cookies = await context.cookies();
  const known = COOKIE_INVENTORY.map((d) => d.name);
  const unknown = cookies.filter((c) => !known.some((n) => c.name === n || c.name.startsWith(n)));

  if (unknown.length > 0) {
    throw new Error(
      `${unknown.length} unknown cookie(s). Add to cookie-inventory.ts:\n` +
      unknown.map((c) => `  - ${c.name} (${c.domain})`).join('\n')
    );
  }
});
```
