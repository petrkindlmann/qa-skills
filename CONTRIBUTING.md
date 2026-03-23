# Contributing

## Adding a new skill

1. Create `skills/your-skill-name/SKILL.md`
2. Follow the [Agent Skills Standard](https://agentskills.io) format
3. Include YAML frontmatter with `name` (must match directory) and `description`
4. Keep SKILL.md under 500 lines. Move deep content to `references/`
5. Add cross-references to related skills in a `## Related Skills` section
6. Update `skills_index.json` with your skill entry
7. Update `VERSIONS.md`

### SKILL.md structure

```markdown
---
name: skill-name
description: >-
  What it does, when to use it, trigger phrases.
---

# Skill Title

Check for `.agents/qa-project-context.md` first.

## Discovery Questions
## Core Principles
## Workflow
## Patterns & Templates
## Anti-Patterns
## Related Skills
## Tools
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
