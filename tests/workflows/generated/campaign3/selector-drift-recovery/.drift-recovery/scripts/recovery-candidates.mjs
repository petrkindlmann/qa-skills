// Port of references/recovery-scripts.md §4 "scripts/recovery-candidates.ts" to ESM JavaScript.
// Logic unchanged; only type annotations removed.
const quote = value => JSON.stringify(value);
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function generate(page, intent) {
  if (typeof intent !== 'string' || !intent.trim()) throw new Error('A verified intent is required');
  const pattern = escapeRegex(intent.trim());
  const rx = new RegExp(pattern, 'i');
  const expression = `new RegExp(${quote(pattern)}, 'i')`;
  const out = [];
  const add = async (locator, selector, score, rationale) => {
    if (await locator.count() === 1) out.push({ locator, selector, score, rationale });
  };

  for (const el of await page.locator('[data-testid]').all()) {
    const id = await el.getAttribute('data-testid');
    const text = (await el.textContent())?.trim() ?? '';
    if (id && rx.test(text)) {
      await add(page.getByTestId(id), `getByTestId(${quote(id)})`, 5, 'unique test ID with matching text');
    }
  }
  await add(page.getByLabel(rx), `getByLabel(${expression})`, 4, 'unique labelled field');
  for (const role of ['button', 'link', 'heading', 'textbox', 'checkbox']) {
    const loc = page.getByRole(role, { name: rx });
    const selector = `getByRole(${quote(role)}, { name: ${expression} })`;
    const count = await loc.count();
    if (count === 1) await add(loc, selector, 4, 'unique role and name');
    else if (count > 1) {
      for (const region of await page.getByRole('region').all()) {
        // Other accessible-name sources need their own inspected adapter.
        const regionName = await region.getAttribute('aria-label');
        if (!regionName) continue;
        const scope = page.getByRole('region', { name: regionName, exact: true });
        if (await scope.count() !== 1) continue;
        await add(scope.getByRole(role, { name: rx }),
          `getByRole('region', { name: ${quote(regionName)}, exact: true }).${selector}`,
          3, `unique within named region ${regionName}`);
      }
    }
  }
  await add(page.getByText(rx), `getByText(${expression})`, 2, 'text-only candidate for review');
  return out.sort((a, b) => b.score - a.score);
}

export async function captureCandidate(candidate, screenshotPath) {
  if (typeof screenshotPath !== 'string' || !screenshotPath) throw new Error('Screenshot path is required');
  if (await candidate.locator.count() !== 1) throw new Error('Candidate is no longer unique');
  await candidate.locator.screenshot({ path: screenshotPath });
  const { locator, ...record } = candidate;
  return { ...record, screenshotPath, applied: false };
}

// The caller supplies a verified source location and creates screenshotDir first.
export async function proposeRecovery(page, failure, screenshotDir, failureIndex) {
  const unresolved = (rationale, selector = null) => ({
    ...failure, selector, score: 0, rationale, screenshotPath: null, applied: false,
  });
  let candidates;
  try { candidates = await generate(page, failure.intent); }
  catch (error) { return [unresolved(`Candidate generation failed: ${String(error)}`)]; }
  const usable = candidates.filter(candidate => candidate.score >= 3);
  if (!usable.length) return [unresolved('No unique candidate meets the score-three floor')];
  const proposed = [];
  for (const [index, candidate] of usable.entries()) {
    const shot = `${screenshotDir}/candidate-${failureIndex}-${index}.png`;
    try { proposed.push({ ...failure, ...await captureCandidate(candidate, shot) }); }
    catch (error) { proposed.push(unresolved(`Evidence capture failed: ${String(error)}`, candidate.selector)); }
  }
  return proposed;
}
