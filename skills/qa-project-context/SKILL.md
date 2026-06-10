---
name: qa-project-context
description: >-
  Create and fill .agents/qa-project-context.md with the project's tech stack, test
  frameworks, CI/CD pipeline, environments, quality goals, risk areas, team structure,
  and conventions. This is the one file every other QA skill reads first, so they skip
  redundant discovery and give context-aware advice.
  Use when: "set up QA context," "configure testing," "initialize project," first use of any QA skill.
  Not for: bootstrapping a brand-new project's QA end-to-end — use qa-start (which calls this skill as its first step).
  Related: qa-start, risk-based-testing, test-strategy, qa-metrics, playwright-automation.
license: MIT
metadata:
  author: kindlmann
  version: "2.0"
  category: foundation
---

<objective>
This skill writes the single file every other QA skill reads. Without it, each skill
re-asks "what framework? what CI? where do tests live?" from scratch and gives generic
advice. It produces `.agents/qa-project-context.md` in the project root, capturing product,
tech stack, test stack, CI/CD, environments, quality goals, risk areas, team, and
conventions — with no `[bracketed placeholders]` left behind.
</objective>

Downstream skills consume specific sections: Risk Areas feeds `risk-based-testing` and
`test-strategy`; Conventions → Selectors feeds `playwright-automation` and `test-reliability`;
Quality Goals feeds `qa-metrics`; Tech Stack feeds every automation skill. Fill those sections
well and the rest of the library gets sharper for free.

## Discovery Questions

First, check whether `.agents/qa-project-context.md` already exists — if it does, read it and
skip every section already filled (no `[brackets]`). Then scan the repo for config files (see
Codebase Detection) and present detected values for confirmation rather than asking blind.
Walk the remaining questions **section by section**, never all at once.

### Product
- What is the product called, and what does it do in one sentence?
- What type is it? (SaaS, e-commerce, media, mobile app, API service, internal tool) — changes which flows matter.
- What are the production, staging, and development URLs?
- What are the 5–10 most critical user journeys? ("If this breaks, we get paged at 2am.") This list drives every other skill's coverage priorities.

### Tech Stack
- Frontend framework and language? Backend framework, language, and API style (REST, GraphQL, tRPC, gRPC)?
- Database, cache layer, ORM? Hosting, CDN, monitoring?
- Monorepo? If yes, list each app separately (see Monorepo note) — sharding and detection differ.

### Test Stack
- E2E tests today? Framework, config location, test directory. Same for unit, API, visual, performance.
- If a framework is detected from config files, populate Test Stack with its name + version + path — don't re-ask.
- Zero test infrastructure? That's a valid answer; record "None selected yet" and note a default (see Core Principle 3).

### CI/CD
- Platform? When do tests run (every push, PR only, nightly, manual)? Sharding/parallelism?
- What blocks a deploy, and what artifacts are saved (screenshots, reports, coverage)?

### Environments
- How many environments, with URLs? How close is staging to production (infra, data shape, third-party integrations)?
- Mock services or real APIs in development? — environment parity drives test reliability.

### Quality Goals
- Coverage targets today? Flake tolerance? Suite-duration budgets? Metrics tracked or wanted?
- No targets yet? Suggest realistic ones by maturity (see Quality Goals section).

### Risk Areas
- Which parts cause the most production incidents? Which integrations are flakiest (payment, email, third-party APIs)?
- Where is churn high and coverage low? Score everything with Impact × Likelihood (see Risk Areas section).

### Team
- How many QA engineers, and their specializations? Developer-to-QA ratio? Methodology (Scrum, Kanban, Shape Up)?
- When does QA engage (shift-left during spec, or after dev)? — sets the automation ownership model.

### Conventions
- Test file naming pattern? Co-located or separate? Branching strategy and PR requirements?
- Selector strategy for E2E? Test-data strategy (factories, fixtures, seeded DB, API-per-test)?

## Core Principles

1. **One file is the source of truth for the whole library.** Every skill reads
   `.agents/qa-project-context.md` first. Duplicating its facts into other docs guarantees
   drift — keep stack, goals, and risks here and let other skills reference them.

2. **Capture the real state, not the aspiration.** If there are no E2E tests, write "None
   selected yet," not a wish. Downstream skills route on what's true: a missing framework
   triggers a setup suggestion; a fake one sends them building on sand.

3. **Detect before you ask; recommend a default only when there's nothing to detect.**
   Read `package.json` and config files first and confirm what you find. Tool *recommendations*
   belong to the specialized skills — the one exception is a project with zero test
   infrastructure, where you note **Playwright** (E2E) and **Vitest** (unit) as defaults in the
   Test Stack and hand off to `playwright-automation` / `unit-testing`. This is the single
   carve-out to the "no recommendations" rule; everywhere else, just record.

4. **Risk Areas is the highest-leverage section — never skip it.** It is the direct input to
   `risk-based-testing` and `test-strategy`. Push for at least 3–4 entries scored by impact and
   likelihood even when the user says "everything's fine."

## Codebase Detection

Scan for these before asking about the stack. Present detected values for confirmation; when a
test config is found, write the framework name into Test Stack rather than re-asking.

| File | Indicates |
|------|-----------|
| `package.json` | Node.js project — check `dependencies` for the framework |
| `next.config.*` | Next.js |
| `nuxt.config.*` | Nuxt/Vue |
| `angular.json` | Angular |
| `astro.config.*` | Astro |
| `react-router.config.ts` | React Router 7 / Remix |
| `requirements.txt` / `pyproject.toml` | Python project |
| `go.mod` | Go project |
| `playwright.config.*` | Playwright is set up → populate Test Stack E2E |
| `cypress.config.*` | Cypress is set up → populate Test Stack E2E |
| `vitest.config.*` / `jest.config.*` | Unit test framework → populate Test Stack Unit |
| `.github/workflows/` | GitHub Actions CI |
| `.gitlab-ci.yml` | GitLab CI |
| `Jenkinsfile` | Jenkins |
| `docker-compose.*` | Docker-based environments |
| `wrangler.*` | Cloudflare Workers |
| `vercel.json` | Vercel hosting |
| `bun.lock` / `bun.lockb` | Bun runtime |
| `pnpm-workspace.yaml` / `turbo.json` / `nx.json` | Monorepo — handle per the Monorepo note |
| `src-tauri/tauri.conf.json` | Tauri desktop app |
| `.claude/` | Project uses Claude Code skills/agents |
| `.claude-plugin/plugin.json` | Project ships a Claude Code plugin |
| `AGENTS.md` | Codex / multi-agent workflow conventions |

## Workflow: Creating the Context File

1. **Check for existing context.** Look for `.agents/qa-project-context.md` in the project root.
2. **If absent:** create `.agents/` if needed, scaffold the section structure, run the Discovery
   Questions starting with Product, and write the file once filled.
3. **If present with placeholders:** read it, list which sections are complete vs. unfilled, ask
   only about the unfilled sections, then update — preserve completed sections untouched.
4. **If present and complete:** summarize the current context, ask what changed (new tools, team
   changes, shifted goals), and update only the deltas.
5. **After completion:** confirm the file path, run Verification (below), and suggest the next
   skill from the context (no E2E → `playwright-automation`; no strategy → `test-strategy`;
   no unit tests → `unit-testing`).

For two full filled-in files (SaaS and a multi-site publisher) plus the monorepo layout, see
`references/examples.md`. One short illustrative snippet:

```markdown
## Test Stack
### E2E / Integration
- **Framework:** Playwright 1.60
- **Config Location:** playwright.config.ts
- **Test Directory:** tests/e2e/
### Unit / Component
- **Framework:** None selected yet — Vitest recommended (see unit-testing)
```

## Section Guidance

What makes a good entry in each section. The blank template ships at
`.agents/qa-project-context.md` in the qaskills repo.

**Product.** Key user flows must be specific and testable: "Buyer searches products, adds to
cart, checks out with Stripe, receives confirmation email" — not "user uses the app." This list
is what every test skill uses to prioritize. Aim for 5–10.

**Tech Stack.** Record frontend, backend, database, hosting separately. Pin versions only when
they change the testing approach (App Router vs. Pages Router differ materially). Don't copy a
version just because an example shows one — read it from `package.json`.

**Test Stack.** For each tool: framework name + version, config location, test directory. No
infrastructure yet is valid — write "None selected yet" and the recommended default (Principle 3).

**Monorepo.** List each frontend app as its own Tech Stack and Test Stack entry; keep the
shared API/backend as one entry. Shard E2E **per app** (a change in `apps/admin` shouldn't run
`apps/storefront` E2E), and note in CI/CD which path filters gate which app's suite. Detection
hint: `turbo.json` / `pnpm-workspace.yaml` / `nx.json`. See `references/examples.md`.

**CI/CD.** Answer what other skills need: what blocks a deploy, how fast feedback is, what
evidence is preserved.

**Environments.** Note how staging diverges from production — a different DB engine in staging
means staging-green tests can still fail in prod.

**Quality Goals.** Concrete and measurable only. Pick starting targets by maturity:

| Maturity | Unit coverage | E2E | Flakiness | Suite duration |
|----------|--------------|-----|-----------|----------------|
| Early-stage startup | 60% on business logic | Top 5 critical flows | <2% | Unit <3 min, E2E <15 min |
| Growth-stage | 80% | All critical paths | <2% | Unit <3 min, E2E <15 min |
| Enterprise | 90%+ | Comprehensive + perf budgets | <1% | Unit <3 min, E2E <15 min |

Write them as numbers: "80% line coverage measured by Istanbul," "flake rate <2% over a rolling
30-day window," "full E2E under 15 min with 4 shards." Never "we want great quality."

**Risk Areas.** Use the table — columns Area, Risk Level, Business Impact, Notes — and score with
**Impact × Likelihood**:

- **Critical (test first):** high impact + high likelihood (payment flow with known edge cases).
- **Important:** high impact + low likelihood (auth — catastrophic if broken, rarely changes).
- **Monitor:** low impact + high likelihood (notification formatting — breaks often, low severity).
- **Backlog:** low impact + low likelihood (admin settings — stable, rarely used).

At least 3 entries, never vague ("everything breaks").

**Team.** Record actual headcount and the dev:QA ratio — it sets the automation ownership model:

| Dev:QA ratio | Ownership model |
|--------------|-----------------|
| Solo / zero QA (effectively infinite) | Devs own all tests. No manual regression suite; lean on low-barrier automation (Playwright + Vitest) and CI gates. QA "role" = strategy + critical-path E2E, done by the dev. |
| High (8:1+) | Developers write tests; QA focuses on strategy, critical-path automation, exploratory testing. |
| Balanced (4:1) | QA owns E2E, devs own unit, integration shared. |
| QA-heavy (<3:1) | Dedicated automation engineers, comprehensive regression suites, scheduled exploratory cadence. |

**Conventions.** Selector strategy especially — `playwright-automation` and `test-reliability`
read it to generate matching selectors. Default to `data-testid` for stability
(`data-testid="invoice-create-button"`, kebab-case). If the team prefers semantic/ARIA selectors
for accessibility-aware testing, record concrete tokens — `role="button"`, `role="heading"`,
`getByRole('link', { name: ... })` — and the tradeoff: ARIA roles double as a11y assertions and
survive markup churn, but are less stable than `data-testid` when copy or roles change, so pin a
`name`/`level` to keep them unambiguous.

## Anti-Patterns

### 1. Asking all questions at once
Dumping 30 questions is overwhelming and gets shallow answers. Walk section by section, Product first.

### 2. Leaving `[brackets]` in the final file
If the user has no answer, record the actual state ("None — no E2E framework selected yet"), not a
placeholder. Placeholders left in the file silently break every downstream skill that parses it.

### 3. Inventing information
Detect the stack from `package.json`, `requirements.txt`, or config files — then confirm with the
user before writing. Don't guess a database or hosting provider.

### 4. Skipping Risk Areas
The single most valuable section for downstream skills. Push for at least 3–4 scored entries even
when the user insists everything is fine.

### 5. Recommending tools beyond the zero-infra default
This skill records current state; tool selection belongs to `playwright-automation`,
`unit-testing`, and the other specialized skills. The *only* recommendation you make here is the
Playwright + Vitest default when there is no test infrastructure at all (Principle 3).

## Verification

Prove the produced file is complete, smallest check first. From the project root:

```bash
test -f .agents/qa-project-context.md \
  && ! grep -q '\[.*\]' .agents/qa-project-context.md \
  && echo "context complete: file exists, no placeholders"
```

Exit 0 with the message means the file exists and every `[bracketed placeholder]` is gone. A
non-zero exit means either the file is missing or placeholders remain — fix those before handing
off to any other skill. Then eyeball that all nine section headers are present:

```bash
grep -c '^## ' .agents/qa-project-context.md   # expect >= 9
```

## Done When

- `.agents/qa-project-context.md` exists in the project root and `grep -q '\[.*\]'` returns
  non-zero (no bracketed placeholders remain).
- All nine sections are present: Product, Tech Stack, Test Stack, CI/CD, Environments, Quality
  Goals, Risk Areas, Team, Conventions.
- Product lists at least 5 specific, testable key user flows (no "user uses the app").
- Test Stack names the actual frameworks + versions + paths in use, or states "None selected yet"
  with the recommended default noted.
- Risk Areas table has at least 3 entries scored by impact and business impact.
- Quality Goals are concrete numbers (coverage %, flake %, durations) — not aspirational prose.
- Team section shows actual headcount and the dev:QA ratio (or "solo").

## Related Skills

- **qa-start** — bootstraps QA on a brand-new project end-to-end and calls this skill as its
  first step. Use qa-start when no QA exists yet; use this skill directly to (re)fill context.
- **risk-based-testing** — turns the Risk Areas section into a prioritized risk matrix. Run it
  after this skill when the question is "where do we focus testing?"
- **test-strategy** — consumes Risk Areas, Quality Goals, and Team to set multi-quarter direction.
- **qa-metrics** — tracks the Quality Goals defined here; both reference the same targets.
- **playwright-automation** / **unit-testing** — set up E2E / unit frameworks after the Test Stack
  section is filled; they read Conventions for selector and naming strategy.
- **ci-cd-integration** — wires the pipeline described in the CI/CD section.

## Reference Files (in `references/`)

- **examples.md** — two complete filled-in context files (SaaS and a multi-site publisher) plus
  the monorepo Tech/Test Stack layout.
