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

## CI gating: execute an independent oracle

The repository provides `scripts/agent-result-gate.mjs`. It executes a project-owned oracle
with a deadline, checks typed evidence bound to the current run, target and build, and exits
nonzero for failed or blocked results. It does not launch a model. Install or configure the
host agent separately and test its adapter before adding it to CI. A skill-only installation
does not install this repository utility; use a full, pinned checkout of QA Skills.

Use these steps in a CI job with a whole-job timeout:

1. Reset an ephemeral fixture and identify the candidate build.
2. Generate a unique run ID in the trusted harness. Configure the target, build ID, step
   budget, model and wall-clock limit before agent execution.
3. Run the installed host adapter. The adapter must enforce its budgets while running,
   retain browser/tool evidence, and emit the activity record below. A prompt asking the
   model to count its own steps is insufficient.
4. Run the gate. It starts the reviewed oracle command itself and gives it a fresh evidence
   path through `QA_ORACLE_EVIDENCE`. The model never chooses or rewrites this command.
5. Retain both the agent trace and `gate-result.json`. A failed or blocked result fails CI;
   do not use `continue-on-error` or retry until passing.

```bash
# Run from a full QA Skills checkout. These are concrete utility arguments; the
# project-owned gate config and adapter result are described in gate-contract.md.
node scripts/agent-result-gate.mjs \
  --config /path/to/project/gate-config.json \
  --agent-result /path/to/project/agent-result.json \
  --output /path/to/project/gate-result.json
```

See [gate-contract.md](gate-contract.md) for the complete input/output contract and a
bounded HTTP oracle example. The gate rejects string booleans, zero or over-budget steps,
wrong run/target/build bindings, missing checks, empty observations, stale output, and
abnormal execution. An ordinary nonzero oracle exit or a failed check produces `failed`;
missing evidence or infrastructure failure produces `blocked`. Neither passes CI.

The earlier `node scripts/run-agent-goal.mjs` example was an adopter-written placeholder;
that runner is not supplied here. Do not copy it into a workflow and expect a model to run.
Use your actual installed host adapter, or keep the deterministic application checks from
`playwright-automation` as the CI gate until that adapter exists.

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
