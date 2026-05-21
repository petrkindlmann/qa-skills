# Refactor recovery workflow — full playbook

This is the executable playbook behind `selector-drift-recovery`. It assumes Playwright + TypeScript. The same pattern adapts to Cypress with minor changes.

---

## 0. Preconditions

Before starting, verify:

- [ ] You can run the affected test suite locally and reproduce the failures.
- [ ] You have access to the deployed preview of the new build, OR the new build runs locally.
- [ ] You have at least one of: a passing CI artifact from before the refactor, a Storybook setup, or a staging environment running the old build.
- [ ] You have a feature branch off main where the recovery PR will land.

If any of these are missing, fix them first. This skill cannot generate recovery from no reference point.

---

## 1. Snapshot the old DOM

### Option A — From the last green Playwright trace

```bash
# Find the last green run on main
gh run list --branch main --workflow ci.yml --status success --limit 5

# Download artifacts
gh run download <RUN_ID> -n playwright-traces

# Open a trace and extract page HTML at the assertion frames
npx playwright show-trace traces/checkout.zip
# In the trace viewer, use Action → "Copy HTML at this step" for each assertion frame
```

Or programmatically:

```typescript
// scripts/extract-old-dom.ts
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const TRACE_DIR = './traces';
const OUT_DIR = './.drift-recovery/old';

(async () => {
  // For each trace, replay and dump HTML at the last visible-content frame
  // (Playwright's trace API exposes frames; pick the one with the most rendered content)
  const traces = fs.readdirSync(TRACE_DIR).filter((f) => f.endsWith('.zip'));
  for (const trace of traces) {
    const browser = await chromium.launch();
    // ... open trace, navigate to last action frame, dump page.content()
    // Implementation depends on the trace replay API version
    fs.writeFileSync(path.join(OUT_DIR, trace.replace('.zip', '.html')), 'TODO');
    await browser.close();
  }
})();
```

### Option B — From Storybook at a pre-refactor commit

```bash
git checkout <PRE_REFACTOR_SHA>
npm run storybook -- --port 6006 --no-open &
sleep 5

# Visit each story and dump HTML
npx playwright eval --headed=false \
  'await page.goto("http://localhost:6006/iframe.html?id=checkout--default"); console.log(await page.content())' \
  > .drift-recovery/old/checkout--default.html

git checkout -
```

### Option C — From a staging deployment

```bash
# If staging still runs the old version
for url in /checkout /cart /account; do
  curl -s "https://staging-old.example.com$url" > ".drift-recovery/old$url.html"
done
```

Pick **one** option, document which, and move on.

---

## 2. Snapshot the new DOM

Run the equivalent surfaces in the new build. Easiest: a Vercel/Netlify preview deploy on the refactor PR.

```bash
# Get the preview URL from the GitHub PR
PREVIEW_URL=$(gh pr view <REFACTOR_PR> --json deployments -q '.deployments[0].url')

for url in /checkout /cart /account; do
  npx playwright eval --headed=false \
    "await page.goto('${PREVIEW_URL}$url'); console.log(await page.content())" \
    > ".drift-recovery/new$url.html"
done
```

For each old snapshot, you should have a matching new snapshot. If a route 404s in the new build, that's a deleted flow — mark its tests for deletion in Phase 6.

---

## 3. Identify broken selectors

Run the affected suite against the new build and collect failures.

```bash
# Run against the preview deploy, JSON reporter for parsing
PLAYWRIGHT_TEST_BASE_URL=$PREVIEW_URL \
  npx playwright test --reporter=json > .drift-recovery/results.json
```

Parse failures with a script:

```typescript
// scripts/identify-drift.ts
import fs from 'fs';

interface Failure {
  file: string;
  line: number;
  oldLocator: string;
  errorType: 'timeout' | 'assertion' | 'other';
}

const results = JSON.parse(fs.readFileSync('.drift-recovery/results.json', 'utf8'));
const failures: Failure[] = [];

for (const suite of results.suites || []) {
  for (const spec of suite.specs || []) {
    for (const test of spec.tests || []) {
      for (const result of test.results || []) {
        if (result.status !== 'failed') continue;
        const error = result.error?.message || '';
        const locatorMatch = error.match(/locator\.\w+: (.+?)$/m);
        const lineMatch = result.error?.location?.line;
        const fileMatch = result.error?.location?.file;
        if (locatorMatch && lineMatch && fileMatch) {
          failures.push({
            file: fileMatch,
            line: lineMatch,
            oldLocator: locatorMatch[1],
            errorType: error.includes('Timeout') ? 'timeout' : 'assertion',
          });
        }
      }
    }
  }
}

fs.writeFileSync('.drift-recovery/failures.json', JSON.stringify(failures, null, 2));
console.log(`Identified ${failures.length} broken locators`);
```

For each broken locator, read the surrounding test code to infer **intent**: what assertion follows, what action is being attempted. Store intent alongside the locator.

---

## 4. Generate replacement candidates

Use the new DOM snapshots plus the inferred intent to generate candidates.

```typescript
// scripts/generate-candidates.ts
import { chromium, Page } from '@playwright/test';
import fs from 'fs';

interface Candidate {
  selector: string;
  score: number;
  rationale: string;
}

async function generateCandidates(page: Page, intent: string): Promise<Candidate[]> {
  const candidates: Candidate[] = [];

  // Strategy 1: data-testid added by refactor team
  const testIds = await page.locator('[data-testid]').all();
  for (const el of testIds) {
    const id = await el.getAttribute('data-testid');
    const accessibleName = await el.evaluate((node) => node.textContent?.trim().slice(0, 50));
    if (accessibleName?.toLowerCase().includes(intent.toLowerCase())) {
      candidates.push({
        selector: `getByTestId('${id}')`,
        score: 5,
        rationale: `testid matches intent "${intent}"`,
      });
    }
  }

  // Strategy 2: role + name
  const intentLower = intent.toLowerCase();
  for (const role of ['button', 'link', 'heading', 'textbox', 'checkbox']) {
    const matches = page.getByRole(role as any, { name: new RegExp(intentLower, 'i') });
    const count = await matches.count();
    if (count === 1) {
      candidates.push({
        selector: `getByRole('${role}', { name: /${intentLower}/i })`,
        score: 4,
        rationale: 'unique role+name match',
      });
    } else if (count > 1) {
      // Need disambiguator
      candidates.push({
        selector: `getByRole('${role}', { name: /${intentLower}/i })`,
        score: 3,
        rationale: `${count} role+name matches — needs region scoping`,
      });
    }
  }

  // Strategy 3: text only
  const byText = page.getByText(intent, { exact: false });
  if ((await byText.count()) === 1) {
    candidates.push({
      selector: `getByText('${intent}')`,
      score: 2,
      rationale: 'text-only, fragile to copy changes',
    });
  }

  return candidates.sort((a, b) => b.score - a.score);
}

// Iterate failures, generate candidates, dump CSV with screenshots
const failures = JSON.parse(fs.readFileSync('.drift-recovery/failures.json', 'utf8'));
const browser = await chromium.launch();
const page = await browser.newPage();

const out: any[] = [];
for (const f of failures) {
  const newHtml = fs.readFileSync(`.drift-recovery/new/${f.pageRoute}.html`, 'utf8');
  await page.setContent(newHtml);
  const candidates = await generateCandidates(page, f.intent);
  const best = candidates[0];
  if (best) {
    const screenshotPath = `.drift-recovery/screenshots/${f.file}-${f.line}.png`;
    if (best.score >= 3) {
      // Highlight the chosen element and screenshot
      await page.locator(best.selector).first().screenshot({ path: screenshotPath });
    }
    out.push({ ...f, ...best, screenshotPath });
  } else {
    out.push({ ...f, selector: null, score: 0, rationale: 'no candidate found' });
  }
}

await browser.close();
fs.writeFileSync('.drift-recovery/candidates.json', JSON.stringify(out, null, 2));
```

---

## 5. Apply, validate, iterate

```typescript
// scripts/apply-recovery.ts
import fs from 'fs';

const candidates = JSON.parse(fs.readFileSync('.drift-recovery/candidates.json', 'utf8'));
const fileGroups: Record<string, any[]> = {};

for (const c of candidates) {
  if (c.score < 3) continue; // do not auto-apply low-confidence
  (fileGroups[c.file] ||= []).push(c);
}

for (const [file, changes] of Object.entries(fileGroups)) {
  let content = fs.readFileSync(file, 'utf8');
  // Apply changes from bottom-up to keep line numbers stable
  changes.sort((a, b) => b.line - a.line);
  for (const c of changes) {
    content = content.replace(c.oldLocator, c.selector);
  }
  fs.writeFileSync(file, content);
}
```

Run the suite. For any test that still fails:

```bash
# Identify still-failing tests
npx playwright test --reporter=json > .drift-recovery/post-recovery.json

# Revert just those changes back via git checkout -p
# Flag them for the PR's "manual review" list
```

---

## 6. Open the PR

```bash
git checkout -b chore/test-selector-recovery-$(date +%Y%m%d)
git add tests/ .drift-recovery/candidates.json
git commit -m "chore(tests): bulk selector recovery after <refactor>"
git push -u origin HEAD

gh pr create --title "chore(tests): selector recovery after <refactor>" --body "$(cat .drift-recovery/pr-body.md)"
```

The PR body should be generated from `candidates.json`:

```typescript
// scripts/build-pr-body.ts
const candidates = JSON.parse(fs.readFileSync('.drift-recovery/candidates.json', 'utf8'));
const recovered = candidates.filter((c: any) => c.score >= 3 && c.applied);
const flagged = candidates.filter((c: any) => c.score < 3);

const body = `## Trigger
<Link to refactor PR>

## Summary
- ${recovered.length} selectors recovered automatically
- ${flagged.length} flagged for manual review
- ${new Set(recovered.map((r: any) => r.file)).size} test files updated

## Per-file changes
${groupByFile(recovered)}

## Flagged for review
${flagged.map((f: any) => `- ${f.file}:${f.line} — ${f.oldLocator} (${f.rationale})`).join('\n')}
`;

fs.writeFileSync('.drift-recovery/pr-body.md', body);
```

---

## Cleanup

After the PR merges, delete the `.drift-recovery/` directory and add it to `.gitignore` if not already there. The artifacts are only useful during the recovery itself.

```bash
rm -rf .drift-recovery/
echo ".drift-recovery/" >> .gitignore
```

---

## When this workflow is not enough

- **The refactor changed semantics, not just structure.** If a "Submit" button became a multi-step confirmation flow, no selector update can rescue the test — the test scenario itself needs to change. Send those tests to a human.
- **Tests use page object models with deep encapsulation.** If the locator lives inside a `CheckoutPage` POM class three levels deep, the candidate generator needs to walk into the POM source, not just the test file. Adapt the script accordingly.
- **The new DOM is server-rendered with hydration mismatch.** Snapshot AFTER hydration completes (`await page.waitForLoadState('networkidle')`) or the new-DOM HTML will be the pre-hydration version and the candidates will miss client-side elements.
