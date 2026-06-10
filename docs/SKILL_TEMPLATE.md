# SKILL.md Template (v3 house format)

Every skill in this repository follows this structure. Sections marked *(conditional)* are
included only when they earn their lines — an empty or padded section is a validation failure,
not a formality.

## Hard limits

- `SKILL.md` target ≤ 450 lines, hard cap 650 (enforced by `scripts/validate_skills.py`).
- Inline code blocks ≤ 30 lines. Anything heavier moves to `references/<file>.md` with an
  inline pointer ("See `references/patterns.md` for the full fixture setup").
- One excellent example beats three mediocre ones. Show the BAD/GOOD pair only for the
  single most damaging mistake; the rest go in `references/`.
- Reference file names: prefer `setup.md`, `patterns.md`, `examples.md`, `recipes.md`,
  `troubleshooting.md`; domain-specific kebab-case names allowed when clearer.
- Every skill has a matching eval spec at `evals/<skill-name>-evals.json` (8–10 cases).
  The eval spec is written BEFORE the skill content (see docs/V3-DESIGN.md, "TDD for skills").

## Frontmatter

```yaml
---
name: skill-name                  # must match directory name
description: >-
  One or two sentences: what the skill does and covers.
  Use when: "trigger phrase," "trigger phrase," "trigger phrase."
  Not for: X — use other-skill. (required whenever a sibling skill overlaps)
  Related: skill-a, skill-b.
license: MIT
metadata:
  author: kindlmann
  version: "2.0"
  category: foundation|strategy|automation|specialized|ai-qa|infrastructure|metrics|process|production|knowledge
---
```

Description rules: trigger phrases are what a user would actually type, quoted. Anti-triggers
("Not for:") are mandatory when any other skill could plausibly match the same request —
the disambiguation table in CLAUDE.md must agree with them.

## Body sections, in order

```markdown
<objective>
2–4 sentences: the failure mode this skill prevents and what it delivers. Concrete, not
aspirational. ("A button that renders at 2px height passes toBeVisible() — visual testing
catches it.")
</objective>

## Quick Route   *(conditional: only when the skill has ≥2 distinct entry paths)*
Compact decision table or 5–10-line flow: situation → section or reference to jump to.

## Discovery Questions
First line: check `.agents/qa-project-context.md`; skip anything answered there.
Grouped bullets. Each question states why it changes the approach, in one clause.

## Core Principles
3–6 numbered, opinionated principles. Bold claim + 2–3 sentences of why. No filler
principles ("testing is important").

## <Domain sections>
The meat: workflow steps, decision tables, minimal inline code. Tables for tool/threshold
choices. Pointers into references/ for heavy material.

## Anti-Patterns
Design-time mistakes: headline + why it bites + the fix. Each one observed in the wild,
not hypothetical.

## Failure Modes   *(conditional: only for skills where applying the skill hits runtime issues)*
Table: Symptom → Likely cause → Fix or check command.

## Verification
How to prove the produced artifact actually works, smallest check first: concrete commands
and what their output should show. This is distinct from Done When — Verification is "run
this now," Done When is "the end state holds."

## Done When
Checklist where every item is objectively checkable — a command exit code, a file that
exists, a CI state, a number. "Works well" is not a Done When item.

## Related Skills
- **skill-name** — boundary statement: when to go there instead, or what it adds to this one.
```

## Voice

Imperative and opinionated, never encyclopedic. Recommend one default and say why; mention
alternatives in one line. Write like a senior QA engineer leaving instructions for a capable
colleague, not like documentation. No marketing adjectives. Current tool versions only —
each named tool/version gets verified against its ecosystem at write time, and dead tools
get an explicit "Avoid: X — reason, date" note.
