# Graduation to Scripted Tests + CI Gating

How to promote a stabilized agent run into a durable scripted Playwright test, and how to
gate a merge on an agent goal. Referenced from SKILL.md.

## Graduation: agent run → scripted `tests/*.spec.ts`

Once a goal has run green for ~2 weeks and the flow is stable, stop paying the per-run
agent tax. Promote it with **Playwright Test Agents** (planner / generator / healer),
shipped in Playwright **v1.56.0**. They run over MCP and work with Claude Code.

```bash
npm i -D @playwright/test@latest        # v1.56+ for Test Agents
npx playwright init-agents --loop=claude # generates planner/generator/healer definitions
```

The graduation pipeline:

1. **Seed test** — author `tests/seed.spec.ts` that bootstraps a ready `page` (global
   setup, fixtures, login). Both planner and generator reuse it.
2. **Planner** — explores the now-stable flow and writes a human-readable Markdown test
   plan to `specs/<flow>.md` (e.g. `specs/checkout.md`).
3. **Generator** — reads the Markdown plan, opens the live app, verifies locators against
   the real DOM, and writes `tests/<flow>.spec.ts` with **role-based locators**
   (`getByRole`, `getByLabel`, `getByText`) and real assertions.
4. **Healer** — when a generated test fails, replays it, finds the equivalent element, and
   patches the locator with a stable alternative, then re-runs.

```ts
// tests/checkout.spec.ts  — generated from specs/checkout.md
// Role-based locators, NOT xpath, NOT data-testid-only, NOT recorded clicks.
import { test, expect } from '../fixtures';

test('guest checkout reaches confirmation', async ({ page }) => {
  await page.goto('/products/seed-sku-001');
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await page.getByRole('link', { name: 'Checkout' }).click();
  await page.getByLabel('Email').fill('seed@example.test');
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page).toHaveURL(/\/order\/confirmation\//);
  await expect(page.getByText('Order confirmed')).toBeVisible();
});
```

This generated test now runs on every PR in milliseconds with zero LLM cost. Keep the
agent goal around only for ongoing exploratory smoke; the scripted test is the regression
guard.

Do NOT: "keep running it as an agent forever," record clicks into the suite, or hand-write
`page.locator('xpath=...')`. The whole point of graduation is durable, role-based locators.

## CI gating: a failed goal must block the merge

The agent run must exit **non-zero** on failure and emit a **machine-readable** verdict.
CI parses the boolean — a human does not read prose, and CI does not grep the explanation.

```yaml
# .github/workflows/agentic-smoke.yml
name: agentic-smoke
on: pull_request
jobs:
  smoke:
    runs-on: ubuntu-latest
    timeout-minutes: 10            # hard timeout cap on the whole job
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - name: Seed ephemeral state
        run: npm run db:reset && npm run seed:checkout   # fresh, seeded, isolated
      - name: Run agent goal
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: node scripts/run-agent-goal.mjs --config agent-run.config.json
        # script enforces maxSteps/timeout and writes result.json {"passed":bool}
      - name: Gate the merge on the boolean verdict
        run: |
          test "$(jq -r .passed result.json)" = "true" || exit 1
```

The runner script (`run-agent-goal.mjs`) must:

- Enforce the **step budget** and a wall-clock **timeout cap** internally; abort past them.
- Write a structured `result.json` with `{ "passed": true|false, "evidence": "...",
  "steps": N }`.
- `process.exit(passed ? 0 : 1)` so a failed goal fails the job.

Anti-patterns that defeat the gate:

- `continue-on-error: true` / `allow_failure: true` — the merge proceeds on red.
- "always exit 0" or returning a prose verdict for a human to read.
- Reusing shared/long-lived state instead of seeded, ephemeral fixtures.

## Canvas / vision fallback (scoped last resort)

When the target is a `<canvas>` app (chart editor, WebGL, Figma-like) there is **no
accessibility tree**, so `browser_snapshot` returns nothing actionable. `browser_snapshot`
will NOT "work fine" on a canvas.

Preferred fix: **instrument the canvas** — add ARIA roles / accessible names / an offscreen
DOM mirror so the snapshot model can drive it like any other widget. This keeps the whole
suite snapshot-first.

Escape hatch when you cannot change the app: enable vision **only for that flow**.

```jsonc
// scoped MCP config for the canvas suite ONLY
{ "args": ["@playwright/mcp@latest", "--headless", "--caps=vision"] }
```

`--caps=vision` unlocks `browser_mouse_click_xy { x, y }` (viewport-relative coordinates).
Use it as the documented last resort for the canvas region only. Do NOT switch the whole
suite to coordinates, do NOT disable the accessibility tree globally, and do NOT abandon
agentic testing — fence the pixel interaction to the one element that needs it.
