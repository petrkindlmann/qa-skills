# Contributing

## Adding a new skill

The authoring contract is **`docs/SKILL_TEMPLATE.md`** — read it first; it defines the
exact frontmatter, section set and order, line caps, and voice. The short version:

1. Write the eval spec FIRST: `evals/your-skill-name-evals.json` (8–10 cases). It is the
   failing test — see `docs/V3-DESIGN.md` ("TDD for skills").
2. Create `skills/your-skill-name/SKILL.md` to the template. Keep it ≤450 lines (hard cap
   650); move heavy code (>30-line blocks) to `references/` and cite each file (no orphans).
3. Frontmatter: `name` (== directory), `description` (with quoted trigger phrases, a
   `Not for: X — use Y.` anti-trigger where a sibling overlaps, and `Related:`), `license: MIT`,
   `metadata.author/version/category` (category from the whitelist in `scripts/validate_skills.py`).
4. Required sections: `<objective>`, `## Discovery Questions` (start with the
   `.agents/qa-project-context.md` check), `## Core Principles`, domain sections,
   `## Anti-Patterns`, `## Done When` (objectively checkable items), `## Related Skills`.
5. Regenerate the index: `python3 scripts/build_index.py`. Update `VERSIONS.md`.
6. Verify before opening a PR:
   - `python3 scripts/validate_skills.py` (must be 0 errors)
   - `python3 scripts/run_evals.py --static --skill your-skill-name`
   - add the skill to the tables in `README.md`, `CLAUDE.md`, and `AGENTS.md`.

### SKILL.md structure

See `docs/SKILL_TEMPLATE.md` for the authoritative, annotated template. Section order:

```markdown
---
name: skill-name
description: >-
  What it does and covers. Use when: "trigger," "trigger." Not for: X — use Y. Related: a, b.
license: MIT
metadata: { author: kindlmann, version: "1.0", category: <whitelist> }
---

<objective> … </objective>
## Discovery Questions   (first line: check qa-project-context)
## Core Principles
## <domain sections>
## Anti-Patterns
## Verification          (conditional — "run this now" checks)
## Done When
## Related Skills
```

## Improving an existing skill

- Fix errors, add missing patterns, improve code examples
- One concern per PR
- Update `VERSIONS.md` if the change is significant

## Reference files

Reference files go in `skills/skill-name/references/` for content that would make SKILL.md too long. Agents load these on demand.

## Tool integrations

Tool integration guides go in `tools/integrations/tool-name.md`. Update `tools/REGISTRY.md` with the new entry.

## What we look for

- Code examples that actually work, not pseudocode
- Opinions on best practices rather than listing every option
- Cross-references to related skills
- Evals in `evals/` if you're adding a skill

## License

Contributions are licensed under MIT.
