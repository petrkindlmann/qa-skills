# Take integrity record (2026-10-22)

Built from each take's own transcript. "Instruction files" are the files the harness attached
as instructions at the start of the take. "Fault-name lines" counts transcript lines containing
`trust_client_amount`, `cross_user_order_read` or `faults.py`: a take that had read the fault
catalogue or the scorer would show them. Raw transcripts are not committed; they hold the full
harness context.

| Take | Harness | Model (assistant messages) | Wall time | Tool calls | Instruction files | Fault-name lines |
|---|---|---|---|---|---|---|
| with-1 | subagent | claude-opus-5-5 (116) | 964 s | 94 | global CLAUDE.md; repo AGENTS.md (via CLAUDE.md); project memory index | 0 |
| without-1 | subagent | claude-opus-5-5 (45) | 484 s | 22 | global CLAUDE.md; repo AGENTS.md (via CLAUDE.md); project memory index | 0 |
| with-2 | subagent | claude-opus-5-5 (78) | 599 s | 53 | global CLAUDE.md; repo AGENTS.md (via CLAUDE.md); project memory index | 0 |
| without-2 | subagent | claude-opus-5-5 (52) | 580 s | 26 | global CLAUDE.md; repo AGENTS.md (via CLAUDE.md); project memory index | 0 |
| with-3 | subagent | claude-opus-5-5 (71) | 539 s | 46 | global CLAUDE.md; repo AGENTS.md (via CLAUDE.md); project memory index | 0 |
| without-3 | subagent | claude-opus-5-5 (45) | 529 s | 20 | global CLAUDE.md; repo AGENTS.md (via CLAUDE.md); project memory index | 0 |
| bare-1 | claude -p 990e9d9b | claude-opus-5-5 (46) | 408 s | 33 | global CLAUDE.md | 0 |
| bare-2 | claude -p f8f751ad | claude-opus-5-5 (47) | 517 s | 36 | global CLAUDE.md | 0 |
| bare-3 | claude -p a738d8eb | claude-opus-5-5 (46) | 503 s | 32 | global CLAUDE.md | 0 |

Notes:

- The skills-free lab copy has no `AGENTS.md`, but the six subagent takes still carried the
  repository's `AGENTS.md` because subagents inherit the instruction files of the session
  that starts them. Moving the file out of the repository did not change that (one attempt,
  stopped and discarded). The bare takes were therefore run as fresh `claude -p` sessions
  started inside the lab, with `--model claude-opus-5-5 --effort xhigh` (the subagents'
  recorded effort) and the Agent and Workflow tools disabled.
- The project memory index lists note titles about the repository's state and working rules;
  it names no fault and no test.
- Prompt asymmetry: the with-skills prompt does not forbid reading
  `tests/workflows/support/runtime.mjs`; the other two arms are told not to read it beyond
  what the fixtures expose. All three with-skills takes read it and no take in the other two
  arms did; it shows the `QA_SHOP_FAULT` variable name and how the Shop is launched, not any
  fault name.
- Self-reported deviations: without-1 ran one read-only `git status` in the repository;
  bare-1 and bare-3 each wrote a temporary log under `/tmp/claude-501` outside the lab and
  removed it.
