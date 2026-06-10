# Tooling — Eval Code

Runnable entry points for the eval/red-team tools in the SKILL.md tooling table. The tool-selection guidance and the comparison table live in `SKILL.md`; this file holds the implementations.

## Tool-call validation with DeepEval

Mind which metric uses a reference. `ToolCorrectnessMetric` is **reference-based** — it compares `tools_called` to `expected_tools`. `ArgumentCorrectnessMetric` is **referenceless and LLM-based** — it judges whether the arguments make sense given the input and does NOT consume `expected_tools`. `TaskCompletionMetric` scores whether the task was accomplished end to end. Wire `expected_tools` only for `ToolCorrectnessMetric`:

```python
# pip install deepeval   (current 4.x)
from deepeval import evaluate
from deepeval.metrics import (
    TaskCompletionMetric, ToolCorrectnessMetric, ArgumentCorrectnessMetric,
)
from deepeval.test_case import LLMTestCase, ToolCall

case = LLMTestCase(
    input="What is the weather in Prague?",
    actual_output="It is currently 18°C and partly cloudy.",
    # expected_tools is the REFERENCE consumed by ToolCorrectnessMetric only.
    expected_tools=[ToolCall(name="get_weather", arguments={"city": "Prague"})],
    tools_called=[ToolCall(name="get_weather", arguments={"city": "Prague"})],
)

evaluate(
    test_cases=[case],
    metrics=[
        TaskCompletionMetric(threshold=0.7),
        ToolCorrectnessMetric(),          # uses expected_tools as the reference
        ArgumentCorrectnessMetric(),      # referenceless — judges args from the input, ignores expected_tools
    ],
)
```

DeepEval 4.x also ships an agent-native workflow: run the eval, read each metric's failure and reasoning inline in the terminal, patch, and re-run — which fits a Claude Code / Cursor loop without leaving the editor.

## Prompt regression + cross-provider with Promptfoo

Promptfoo's YAML config is the lowest-friction entry point. Listing multiple `providers` runs the **same** versioned prompt across each model and applies the **same** assertions to all — this is how you catch a provider (or a fallback model) that silently drops a required fact or ignores a length constraint:

```yaml
# promptfooconfig.yaml
prompts: [file://prompts/summarize.txt]
providers:
  - anthropic:claude-sonnet-4-6
  - openai:gpt-5.5            # current OpenAI flagship; gpt-4o was deprecated Feb 2026
tests:
  - vars: { document: "..." }
    assert:
      # These run against every provider above — a regression on one fails the suite.
      - type: contains-all
        value: ["actionable insight", "key finding"]
      - type: llm-rubric
        value: "Output is 3 sentences or fewer and contains no opinions"
```

Run with `npx promptfoo eval -c promptfooconfig.yaml`; a non-zero exit gates the merge. Promptfoo is MIT-licensed and open-source (acquired by OpenAI in March 2026, license and public repo retained).

## Red-team / safety with Garak

Run `garak` against your deployed prompt before launch. Keep probe specs consistent (fully-qualified `module.Probe` or bare module names — not a mix), and confirm them against your installed version with `garak --list_probes`. These modules are verified present in v0.14.x:

```bash
# Verify the live probe set first:
garak --list_probes

# Scan: prompt injection, latent (indirect) injection, encoding bypass.
garak --model_type openai --model_name <model> \
  --probes promptinject,latentinjection,encoding.InjectAscii85
```

`promptinject` covers instruction-hijacking, `latentinjection` covers injections buried in surrounding context (the RAG/summarization case), and `encoding.InjectAscii85` tests encoded-payload bypasses. Garak v0.14.x (Feb 2026) writes redesigned HTML/JSON reports — review the report for any critical-tier findings before launch.
