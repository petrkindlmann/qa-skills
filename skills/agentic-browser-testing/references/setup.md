# Agentic Browser Test Setup

Concrete configs for running a goal-driven browser agent with Playwright MCP, plus the
determinism harness referenced from SKILL.md.

## 1. Install and register Playwright MCP

Playwright MCP is accessibility-tree-first: every interaction returns a structured
`browser_snapshot` of roles, refs, and accessible names (~200-400 tokens) instead of a
screenshot. You do **not** feed the model pixels by default.

```jsonc
// .mcp.json (Claude Code) — register the server, headless, deterministic
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "@playwright/mcp@latest",
        "--headless",
        "--isolated",                 // fresh profile each run, no leaked state
        "--viewport-size=1280,720"    // pin viewport so the a11y tree is stable
      ]
    }
  }
}
```

Core tools the agent uses (all snapshot/ref based, no coordinates):

| Tool | Purpose |
|------|---------|
| `browser_navigate` | Go to the seeded entry URL |
| `browser_snapshot` | Capture the accessibility tree (role / ref / accessible name) |
| `browser_click` | Click an element by its `ref` from the latest snapshot |
| `browser_type` | Type into a field by `ref` |
| `browser_wait_for` | Wait for text to appear/disappear (NOT a fixed sleep) |

`browser_take_screenshot` exists but is for human-readable evidence/debugging only —
never as the assertion input.

## 2. The goal prompt (the whole point — no script)

The agent receives a natural-language goal plus an **explicit success assertion**. It
explores via `browser_snapshot` and decides its own clicks. There is no `page.goto`,
no `page.locator`, no `data-testid` hunting.

```text
GOAL: Complete a guest checkout for one in-stock item and reach the order
      confirmation page.

START: navigate to {{SEEDED_URL}}/products/seed-sku-001  (seeded, in stock)

RULES:
- Read the accessibility snapshot to find controls; act by ref.
- Bounded to {{MAX_STEPS}} steps. If you cannot progress, FAIL — do not loop.
- Do NOT invent data; use the seeded fixture values only.

SUCCESS (all must hold — assert against the final browser_snapshot, not a screenshot):
- URL matches /order/confirmation/.+
- Snapshot contains text "Order confirmed" AND an order number matching /#\d{6,}/
NEGATIVE (forbidden state — fail fast if seen):
- Still on a URL matching /checkout|/cart  → FAIL
- Snapshot contains role="alert" with "payment failed" → FAIL

OUTPUT: a single JSON object {"passed": true|false, "evidence": "...", "steps": N}
```

The negative check is what stops the agent self-grading "looks fine" while stuck.

## 3. Determinism harness

Pin everything the model and the app can vary:

```jsonc
// agent-run.config.json
{
  "model": "claude-haiku-4-5-20251001",  // PINNED id, not "latest"
  "temperature": 0,                        // no creative exploration in CI
  "maxSteps": 18,                          // step budget — hard cap, fail past it
  "maxTokens": 120000,                     // token budget guardrail
  "seed": "checkout-seed-001",             // seeded fixture / DB reset key
  "promptCache": true                      // cache the static goal + tool defs
}
```

Determinism levers, in order of impact:

1. **temperature 0 + pinned model id** — same inputs, same trajectory. Never `latest`.
2. **Seeded data + DB reset** before each run — the app stops being a variable.
3. **Bounded step budget** — caps non-determinism and cost; a runaway is a failure, not a retry.
4. **Explicit pass/fail assertion** — a true/false oracle, not "no error."
5. **Snapshot-based assertion** — assert against the accessibility tree, never pixels.

What NOT to do: bumping temperature for "smarter" exploration, `retry-until-pass`,
`waitForTimeout` sleeps, or screenshot-diff assertions. Those mask flakiness instead of
removing it.

## 4. Cost and latency controls

Agent runs are 2-5x slower and pricier than a scripted test. Control spend without
dropping coverage:

| Lever | How |
|-------|-----|
| Step budget | `maxSteps` low and enforced; a step is an LLM round-trip — the main cost driver |
| Model tiering | Haiku 4.5 / Sonnet 4.6 for cheap navigation steps; reserve Opus 4.8 for genuinely ambiguous flows only |
| Prompt caching | Cache the static system prompt, tool schemas, and goal — they repeat every run |
| Scope | One narrow goal per run; start at a **seeded entry point** deep-linked past login instead of re-driving login each time |
| Snapshot over screenshot | The a11y snapshot is ~200-400 tokens; a screenshot is thousands. Default to snapshot |

Backwards moves to avoid: "use a bigger model for every step," "raise max steps,"
"screenshot every step." Those raise cost and latency without buying reliability.
