# Better Ads Standards — Test Code

Runnable Playwright patterns for Coalition for Better Ads compliance. The unacceptable-format table and test approaches live in `SKILL.md`; this file holds the implementations.

```typescript
test.describe('Better Ads Compliance', () => {
  test('no auto-playing video ads with sound', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const videos = page.locator('video');
    for (let i = 0; i < await videos.count(); i++) {
      const video = videos.nth(i);
      const autoplay = await video.getAttribute('autoplay');
      const muted = await video.getAttribute('muted');
      if (autoplay !== null && muted === null) {
        throw new Error(`Auto-playing unmuted video: ${await video.evaluate((el) => el.outerHTML.slice(0, 200))}`);
      }
    }
  });

  test('mobile: ad density below 30%', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/article/sample-article');
    await page.waitForLoadState('networkidle');

    const banner = page.getByRole('dialog', { name: /consent/i });
    if (await banner.isVisible()) await banner.getByRole('button', { name: /accept/i }).click();
    await page.waitForTimeout(3000);

    const adElements = page.locator('[class*="ad-"], [id*="ad-"], [data-ad], iframe[src*="doubleclick"]');
    let totalAdHeight = 0;
    for (let i = 0; i < await adElements.count(); i++) {
      const box = await adElements.nth(i).boundingBox();
      if (box) totalAdHeight += box.height;
    }

    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(totalAdHeight / pageHeight, `Ad density: ${Math.round(totalAdHeight / pageHeight * 100)}%`).toBeLessThan(0.30);
  });
});
```
