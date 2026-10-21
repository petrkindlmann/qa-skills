// Visual baselines for the pinned TodoMVC (contract: tests/workflows/todomvc-contract.md).
//
// Baselines live in ./todomvc-visual.spec.mjs-snapshots/<name>-darwin.png (platform-tagged).
// Baseline update workflow:
//   1. Run the suite without flags; a changed render fails and writes <name>-actual.png and
//      <name>-diff.png next to the test output. Review expected/actual/diff in the HTML report
//      (QA_WORKFLOW_OUTPUT/html) before deciding anything.
//   2. Unintended change: fix the app. Intended change: regenerate only the affected tests with
//      --update-snapshots --grep "<test title>", never the whole suite by reflex.
//   3. Re-run twice without --update-snapshots; both runs must pass before the new PNGs are kept.
//   4. Commit the PNGs together with the change that justified them and say so in the message.
//      Reviewers look at the images, not just the binary diff.
// Baselines are platform-tagged; these were captured on darwin and will not match a Linux CI image.
import fs from 'node:fs';
import { test, expect } from '../../../support/fixtures.mjs';
import { oracle } from '../../../support/oracle.mjs';
import { VISUAL, MIXED, openTodo, addTodos, seedMixed, settle } from './visual-helpers.mjs';

const app = (page) => page.locator('.todoapp');

// Added after authoring: the baselines are darwin captures, so the lab's Linux CI run skips
// this file instead of failing on missing -linux.png snapshots (see final-response.md).
test.skip(process.platform !== 'darwin', 'visual baselines were captured on darwin');

test.describe('TodoMVC visual baselines', () => {
  test('empty state shows only the header and the info footer', async ({ page, todo }) => {
    await openTodo(page, todo);
    await expect(page.locator('.main')).toBeHidden();
    await expect(page.locator('.footer')).toBeHidden();
    await settle(page);
    await expect(page).toHaveScreenshot('empty-state.png', { ...VISUAL, fullPage: true });
  });

  test('several active items', async ({ page, todo }) => {
    await openTodo(page, todo);
    await addTodos(page, MIXED.titles);
    await expect(page.locator('.todo-count')).toHaveText('3 items left');
    await settle(page);
    await expect(app(page)).toHaveScreenshot('several-active.png', VISUAL);
  });

  // One mixed seed, each filter reached through its footer link. The "all" view doubles as the
  // one-completed-among-several baseline; it is reached after leaving to "completed" so the
  // selected marker is proven to move back rather than never having moved.
  const FILTERS = [
    { name: 'all', visit: ['Completed', 'All'], rows: 3, count: '2 items left' },
    { name: 'active', visit: ['Active'], rows: 2, count: '2 items left' },
    { name: 'completed', visit: ['Completed'], rows: 1, count: '2 items left' },
  ];
  for (const filter of FILTERS) {
    test(`filter view: ${filter.name}`, async ({ page, todo }) => {
      await seedMixed(page, todo);
      for (const link of filter.visit) await page.locator('.filters').getByRole('link', { name: link }).click();
      await expect(page.locator('.filters a.selected')).toHaveText(filter.visit.at(-1));
      await expect(page.locator('.todo-list li:visible')).toHaveCount(filter.rows);
      await expect(page.locator('.todo-count')).toHaveText(filter.count);
      await settle(page);
      await expect(app(page)).toHaveScreenshot(`filter-${filter.name}.png`, VISUAL);
    });
  }

  test('all items completed through mark-all', async ({ page, todo }) => {
    await openTodo(page, todo);
    await addTodos(page, MIXED.titles);
    await page.getByLabel('Mark all as complete').check();
    await expect(page.locator('.todo-list li.completed')).toHaveCount(3);
    await expect(page.locator('.todo-count')).toHaveText('0 items left');
    await expect(page.locator('.clear-completed')).toBeVisible();
    await settle(page);
    // Matrix oracle (added after authoring): the designated comparator for the style-regression fault run.
    await oracle('c3-visual-style', 'toHaveScreenshot', () => expect(app(page)).toHaveScreenshot('all-completed.png', VISUAL));
  });

  test('editing in progress', async ({ page, todo }) => {
    await seedMixed(page, todo);
    const row = page.locator('.todo-list li').nth(2);
    await row.locator('label').dblclick();
    await expect(row).toHaveClass(/editing/);
    const edit = row.locator('.edit');
    await expect(edit).toBeFocused();
    await edit.fill('Read a longer book');
    // Focus must stay on the edit field: blurring it saves the edit and ends the state.
    await settle(page, { keepFocus: true });
    await expect(app(page)).toHaveScreenshot('editing-in-progress.png', VISUAL);
  });

  test('hovering a row reveals its delete control', async ({ page, todo }) => {
    await seedMixed(page, todo);
    await settle(page);
    const row = page.locator('.todo-list li').nth(0);
    await row.hover();
    await expect(row.locator('.destroy')).toBeVisible();
    await settle(page, { keepPointer: true });
    await expect(app(page)).toHaveScreenshot('row-hover.png', VISUAL);
  });

  test.describe('mobile viewport', () => {
    test.use({ viewport: { width: 375, height: 667 }, isMobile: true });

    test('mixed list at phone width', async ({ page, todo }) => {
      await seedMixed(page, todo);
      await settle(page);
      await expect(page).toHaveScreenshot('mixed-mobile.png', { ...VISUAL, fullPage: true });
    });
  });
});

// Detector check: the comparator must reject a wrong image, not just accept a right one.
// Opt-in (VISUAL_DETECTOR_CHECK=1) and refused under --update-snapshots, because the
// deliberate mismatch would otherwise be written over the real baseline.
test.describe('comparator detector check', () => {
  test('a different state is rejected against an existing baseline', async ({ page, todo }, testInfo) => {
    test.skip(!process.env.VISUAL_DETECTOR_CHECK, 'set VISUAL_DETECTOR_CHECK=1 to run');
    test.skip(!['missing', 'none'].includes(testInfo.config.updateSnapshots), 'never under --update-snapshots');
    const baseline = testInfo.snapshotPath('filter-completed.png');
    expect(fs.existsSync(baseline), `baseline must exist: ${baseline}`).toBe(true);

    await openTodo(page, todo);
    await addTodos(page, MIXED.titles);
    await settle(page);
    let failure;
    try {
      await expect(app(page)).toHaveScreenshot('filter-completed.png', VISUAL);
    } catch (error) {
      failure = error;
    }
    expect(failure, 'toHaveScreenshot accepted a three-item list as the completed-filter baseline').toBeDefined();
    expect(failure.message).toMatch(/pixels .* are different|Expected an image \d+px by \d+px/);
  });
});
