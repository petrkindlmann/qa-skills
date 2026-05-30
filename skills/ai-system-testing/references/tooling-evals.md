# Tooling — Eval Code

Runnable entry points for the eval/red-team tools in the SKILL.md tooling table. The tool-selection guidance and the comparison table live in `SKILL.md`; this file holds the implementations.

## Tool-call validation with DeepEval (replaces hand-rolled assertions)

```python
# pip install deepeval
from deepeval import evaluate
from deepeval.metrics import TaskCompletionMetric, ToolCorrectnessMetric, ArgumentCorrectnessMetric
from deepeval.test_case import LLMTestCase, ToolCall

case = LLMTestCase(
    input="What is the weather in Prague?",
    actual_output="It is currently 18°C and partly cloudy.",
    expected_tools=[ToolCall(name="get_weather", arguments={"city": "Prague"})],
    tools_called=[ToolCall(name="get_weather", arguments={"city": "Prague"})],
)

evaluate(
    test_cases=[case],
    metrics=[TaskCompletionMetric(threshold=0.7), ToolCorrectnessMetric(), ArgumentCorrectnessMetric()],
)
```

## Prompt regression at the suite level with Promptfoo

Promptfoo's YAML config is the lowest-friction entry point:

```yaml
# promptfooconfig.yaml
prompts: [file://prompts/summarize.txt]
providers:
  - openai:gpt-4o
  - anthropic:claude-sonnet-4-6
tests:
  - vars: { document: "..." }
    assert:
      - type: contains-all
        value: ["actionable insight", "key finding"]
      - type: llm-rubric
        value: "Output is 3 sentences or fewer and contains no opinions"
```

## Red-team / safety with Garak

Run `garak` against your deployed prompt before launch:

```bash
garak --model_type openai --probes encoding.InjectAscii85,goat,system_prompt_extraction
```
