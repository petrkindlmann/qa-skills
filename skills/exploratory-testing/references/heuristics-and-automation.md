# Heuristic Test-Idea Banks and the Automation Pipeline

Concrete test-idea lists for boundary, state-transition, error-handling, and "what if" exploration, plus the exploration-to-automation pipeline and a worked Playwright regression example. The HICCUPS / FEW HICCUPS oracle tables and the explore-vs-automate decision framework live in `SKILL.md`.

## Boundary Testing Heuristics

Boundaries are where bugs cluster. Systematically test these:

```
Numeric boundaries:
  - Zero, one, many
  - Minimum - 1, minimum, minimum + 1
  - Maximum - 1, maximum, maximum + 1
  - Negative numbers (if unexpected)
  - Very large numbers (overflow)
  - Decimal precision (0.1 + 0.2 ≠ 0.3)

String boundaries:
  - Empty string
  - Single character
  - Maximum length
  - Maximum length + 1
  - Unicode (emoji 👋, RTL text مرحبا, CJK characters 你好)
  - Special characters (' " < > & \ / ; -- DROP TABLE)
  - Whitespace only (spaces, tabs, newlines)
  - Leading/trailing whitespace

Time boundaries:
  - Midnight (00:00), end of day (23:59:59)
  - Timezone changes (DST transitions)
  - Leap year (Feb 29), month boundaries (Jan 31 → Feb 1)
  - Epoch (1970-01-01), far future (2038, Y2K38)
  - Date formats across locales (DD/MM vs MM/DD)

Collection boundaries:
  - Empty collection
  - Single item
  - Exactly at page size boundary (e.g., 20, 21 items with 20-per-page)
  - More than max displayable
  - Duplicate items
```

## State Transition Heuristics

Focus on how the application moves between states:

```
State transition test ideas:
  - What happens if you skip a step? (Direct URL to step 3 of a wizard)
  - What happens if you go backward? (Browser back button, undo)
  - What happens if you interrupt? (Close tab mid-operation, lose network)
  - What happens if you repeat? (Double-click submit, refresh during save)
  - What happens if two users trigger the same transition? (Concurrent edits)
  - What is the state after an error? (Can you retry? Is data corrupted?)
  - What happens on timeout? (Session expires mid-form, API call hangs)
```

## Error Handling Heuristics

```
Error handling test ideas:
  - Disconnect the network mid-operation
  - Reduce bandwidth to 3G speeds
  - Fill disk space (for upload features)
  - Send malformed API responses (modify with browser DevTools)
  - Trigger server errors (if you can control the backend)
  - Exceed rate limits
  - Use expired tokens/sessions
  - Provide invalid file types to upload controls
  - Submit forms with JavaScript disabled
```

## "What If" Scenarios

Open-ended questions that lead to bugs:

```
What if the user...
  - Uses the back button at every step?
  - Opens the same page in two tabs?
  - Switches between mobile and desktop mid-session?
  - Has an ad blocker that blocks your analytics/tracking scripts?
  - Pastes content from Word (with hidden formatting)?
  - Has accessibility features enabled (screen reader, high contrast, zoom)?
  - Is in a locale you did not consider? (RTL, long translations, different number formats)
  - Has never used this product before and has no mental model?
  - Is deliberately trying to break the application?
```

## The Exploration-to-Automation Pipeline

```
Exploratory session finds bug
        │
        ▼
File bug report with reproduction steps
        │
        ▼
Developer fixes the bug
        │
        ▼
Write automated regression test that covers the scenario
        │
        ▼
Bug is now prevented from recurring
        │
        ▼
Future exploratory sessions focus on NEW areas (not re-checking old bugs)
```

**When converting findings to automated tests:**

1. Extract the exact reproduction steps from the session log
2. Determine the appropriate test level (unit if logic bug, integration if boundary bug, E2E if UI flow bug)
3. Write the test with a clear reference to the original bug ID
4. Verify the test fails on the buggy version and passes on the fix

```typescript
// Example: Converting exploratory finding to Playwright test
// Found during session 2026-03-15: BUG-456 email validation missing on checkout

test('checkout requires valid email - regression for BUG-456', async ({ page }) => {
  await page.goto('/checkout');
  // Leave email empty
  await page.getByLabel('Email').fill('');
  await page.getByRole('button', { name: 'Place order' }).click();

  // Should show validation error, not proceed
  await expect(page.getByText('Email is required')).toBeVisible();
  await expect(page).not.toHaveURL(/.*confirmation/);
});
```
