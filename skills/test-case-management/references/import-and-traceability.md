# CSV Import, Organization, Traceability, Automation Graduation

## TestRail CSV import — column-to-field mapping

A CSV that imports cleanly into TestRail has a header row whose columns map onto TestRail's
importer fields, so the import wizard auto-matches them and you skip manual remapping. Do NOT
emit free-form prose, a single `Description` column holding both steps and expected results, or
JSON when CSV was asked for.

Key importer fields and the columns that map to them:

| TestRail field | CSV header to use |
|----------------|-------------------|
| Title | `Title` |
| Section / folder placement | `Section` or `Section Hierarchy` (e.g. `Authentication > Password Reset`) |
| Separated steps | `Steps (Separated)` (one row per step, or `\n`-joined) |
| Per-step expected | `Expected Result` |
| Preconditions | `Preconditions` |
| Priority | `Priority` |
| Type | `Type` |
| References | `References` |

For separated steps, TestRail's importer reads multiple rows that share the same `Title`
(each row = one step + its expected result), or a single row with newline-delimited steps
mapped to the "Steps (Separated)" template field in the wizard.

Example CSV for a "Password Reset" section with three cases:

```csv
Title,Section Hierarchy,Priority,Type,Preconditions,Steps (Separated),Expected Result
Password reset — valid email sends a link,Authentication > Password Reset,High,Functional,"A user account exists for reset@example.com","Open /forgot-password and enter reset@example.com, then click Send reset link","A confirmation reads ""Check your email""; a reset email arrives within 2 minutes"
Password reset — unknown email shows neutral message,Authentication > Password Reset,Medium,Functional,"No account exists for ghost@example.com","Open /forgot-password and enter ghost@example.com, then click Send reset link","The same neutral confirmation is shown; no email is sent (no user enumeration)"
Password reset — expired link is rejected,Authentication > Password Reset,High,Negative,"A reset link older than its 60-minute TTL exists","Open the expired reset link and submit a new password","An error reads ""This reset link has expired""; the password is unchanged"
```

In the import wizard, set the column mapping to TestRail fields and choose the
"Test Case (Steps)" template so `Steps (Separated)` + `Expected Result` populate the
separated-step grid. Quote any cell containing commas; double up `"` for literal quotes.

---

## Suite & section organization

TestRail has two repository modes — pick deliberately:

| Mode | When | Trade-off |
|------|------|-----------|
| **Single Repository (single suite)** | Most teams; one navigable tree of sections | Simplest; everything in one suite, organized by sections/subsections |
| **Single Repository + baselines** | Need branching/baselines per release | Adds baseline overhead |
| **Multiple Test Suites** | Genuinely separate products or platforms maintained by different teams | More navigation friction; harder cross-suite reporting |

For a **web + mobile** product, the usual right answer is **single repository, top-level
sections per platform** (`Web`, `Mobile (iOS)`, `Mobile (Android)`, plus `Shared / API`),
then feature sections beneath. Only split into multiple suites if web and mobile are owned by
separate QA teams with separate release cadences.

Rules of thumb:
- Use **sections and subsections** for hierarchy — not one suite (or one folder) per case.
- Keep the hierarchy **shallow**: aim for 3–4 levels (`Platform > Feature > Sub-feature > cases`).
  Avoid deep nesting 7+ levels deep — it kills navigation and breaks run filters.
- Don't dump every case in the root section, and don't create a folder per single case.
- **Don't duplicate the same case across suites** — keep one source of truth and reference shared
  steps; duplicates drift out of sync.

The same shape maps to Xray (Test Repository folders), Zephyr Scale (folders), and Qase (suites):
shallow, feature-aligned, platform at the top when you have multiple platforms.

---

## Traceability: requirements → tests → coverage

The point of traceability is to surface **uncovered requirements** — stories with no tests —
not to keep a manual spreadsheet that rots. Use the tool's native requirement→test link.

### Xray on Jira

Xray models coverage with a **"tests" issue link** from a Test issue to the requirement
(a Story/Requirement Jira issue). Steps:

1. From each Test, add a **"tests" link** to the Story's Jira issue key (or set the story as a
   "requirement" and link from its Test Coverage panel).
2. Read coverage from the story's **Test Coverage panel** on the Jira issue, and across the
   project from the **Traceability Report** (Xray report: requirements as rows, linked tests
   and their latest status as columns).
3. Filter the **Requirement Coverage / Traceability Report** for requirements with **0 linked
   tests** — those are your uncovered stories. This is the deliverable; do not stop at "every
   test links to something."

Do NOT link tests to **Test Executions** as a stand-in for requirement coverage — executions
record runs, not which requirement is covered. And do NOT propose a hand-maintained spreadsheet
as the only mechanism; it cannot answer "which stories have no tests" reliably.

The other tools have equivalents: Zephyr Scale links test cases to Jira issues and ships a
**Traceability** view; Qase links cases to requirements via the Jira/Requirements integration;
TestRail uses the `refs`/`References` field plus the Jira integration's coverage view.

---

## When a manual case should graduate to automation

Limited automation capacity means you automate by **ROI**, not by volume. Default heuristic
for triaging a manual backlog (e.g. 400 cases in Zephyr Scale):

**Automate first** when ALL of these trend high:
- **Run frequency** — runs every release / every regression / in smoke. High frequency = the
  per-run manual cost recurs, so automation pays back fast.
- **Stability** — the feature and its UI are stable / low-churn / deterministic. Stable cases
  have low maintenance cost after automation.
- **Regression / smoke value** — it guards a critical path (login, checkout, payments) that
  must never silently break.

Score each case roughly `value = run_frequency × regression_importance ÷ (automation_cost ×
expected_maintenance)`. Automate the top of that list.

**Keep manual** when any of these hold:
- **Exploratory / one-off** cases, or cases run rarely (once a quarter or less) — automation
  cost never amortizes.
- **High-churn UI** still in flux — automating it now buys constant maintenance; wait until it
  stabilizes.
- **Flaky / non-deterministic** behavior — automating flakiness just moves the flake into CI;
  fix determinism first.
- Cases needing **human judgment** (visual aesthetics, UX feel, content tone).

Anti-pattern to reject explicitly: "automate everything" and "automate the flaky, frequently
changing UI first." Both burn capacity on the worst-ROI candidates. Sequence: stable
high-frequency regression/smoke first; flaky/high-churn/exploratory last or never.
