# Contributing to QA Skills

Thanks for your interest in improving QA skills for AI agents.

## How to Contribute

### Adding a New Skill

1. Create `skills/your-skill-name/SKILL.md`
2. Follow the [Agent Skills Standard](https://agentskills.io) format
3. Include YAML frontmatter with `name` (matching directory) and `description`
4. Keep SKILL.md under 500 lines — move deep content to `references/`
5. Add cross-references to related skills in the `## Related Skills` section
6. Update `skills_index.json` with your skill entry
7. Update `VERSIONS.md` with the new skill

### SKILL.md Structure

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

### Improving an Existing Skill

- Fix errors, add missing patterns, improve code examples
- Keep changes focused — one concern per PR
- Update version in `VERSIONS.md` if the change is significant

### Adding Reference Files

Reference files go in `skills/skill-name/references/` and contain deep-dive content that would make SKILL.md too long. They are loaded on-demand when the agent needs more detail.

### Adding Tool Integrations

Tool integration guides go in `tools/integrations/tool-name.md`. Update `tools/REGISTRY.md` with the new entry.

## Quality Standards

- **Real patterns** — Code examples should be production-ready, not pseudocode
- **Opinionated** — Take a stance on best practices, don't hedge everything
- **Cross-referenced** — Link to related skills where relevant
- **Tested** — If adding a skill, consider adding evals in `evals/`

## Code of Conduct

Be respectful. Focus on improving QA practices for the community.

## License

By contributing, you agree that your contributions will be licensed under MIT.
