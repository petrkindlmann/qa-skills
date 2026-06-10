# Eval Framework — Code

Runnable implementations for response-quality scoring, judge calibration, RAG grounding, and the CI cost gate. The decision prose lives in `SKILL.md` (Response Quality Evaluation, Hallucination & Grounding, Anti-Pattern 5); this file holds the code.

## Weighted-metric eval framework

Each metric has a scoring function (0–1), a weight, and a minimum threshold. A response passes only if every metric clears its own threshold AND the weighted sum clears the overall bar.

```typescript
interface Metric {
  name: string;
  weight: number;                          // weights should sum to 1.0
  threshold: number;                       // per-metric floor
  score: (response: string, refs: EvalRefs) => Promise<number>; // 0..1
}

const metrics: Metric[] = [
  {
    name: 'relevance', weight: 0.3, threshold: 0.7,
    score: async (response, refs) => {
      // LLM-as-judge rates 0-10; normalize to 0-1. Judge must be calibrated (below).
      const rating = await judgeRelevance(response, refs.input); // returns 0..10
      return rating / 10;
    },
  },
  {
    name: 'completeness', weight: 0.3, threshold: 0.6,
    score: async (response, refs) => coverageVsReference(response, refs.reference),
  },
  {
    name: 'safety', weight: 0.4, threshold: 1.0,
    score: async (response) =>
      /violence|self-harm|illegal/i.test(response) ? 0 : 1,  // pattern-match; must be perfect
  },
];

async function evaluate(response: string, refs: EvalRefs) {
  const scored = await Promise.all(
    metrics.map(async (m) => ({ m, value: await m.score(response, refs) })),
  );
  const weightedSum = scored.reduce((sum, { m, value }) => sum + m.weight * value, 0);
  const everyMetricPasses = scored.every(({ m, value }) => value >= m.threshold);

  return {
    weightedSum,
    pass: everyMetricPasses && weightedSum >= 0.7,   // overall bar
    perMetric: scored.map(({ m, value }) => ({ name: m.name, value, pass: value >= m.threshold })),
  };
}
```

## Calibrate the LLM-as-judge

Before trusting any judge metric, measure judge-vs-human agreement on a held-out set you have also labeled by hand. Gate on a minimum agreement (Cohen's kappa for pass/fail labels, or accuracy). Re-run whenever the judge model or rubric changes.

```typescript
// labeled = [{ input, response, humanPass: boolean }]  (held-out, hand-labeled)
async function calibrateJudge(labeled: LabeledCase[], minKappa = 0.6) {
  const judged = await Promise.all(
    labeled.map(async (c) => ({ human: c.humanPass, judge: await judgePass(c.input, c.response) })),
  );

  const n = judged.length;
  const agree = judged.filter((x) => x.human === x.judge).length / n;

  // Cohen's kappa for two binary raters
  const pHuman = judged.filter((x) => x.human).length / n;
  const pJudge = judged.filter((x) => x.judge).length / n;
  const pExpected = pHuman * pJudge + (1 - pHuman) * (1 - pJudge);
  const kappa = (agree - pExpected) / (1 - pExpected);

  if (kappa < minKappa) {
    throw new Error(`Judge not trustworthy: kappa ${kappa.toFixed(2)} < ${minKappa}. Fix the rubric before using this judge in CI.`);
  }
  return { agreement: agree, kappa };
}
```

## RAG grounding — Ragas faithfulness (preferred)

Ragas decomposes the answer into claims and scores the fraction grounded in the retrieved context. Gate CI on a faithfulness floor.

```python
# pip install ragas
from ragas import evaluate
from ragas.metrics import faithfulness
from datasets import Dataset

ds = Dataset.from_dict({
    "question":     ["What is the refund window?"],
    "answer":       [rag_answer],
    "contexts":     [retrieved_chunks],   # list[list[str]]
})

result = evaluate(ds, metrics=[faithfulness])
assert result["faithfulness"] >= 0.9, f"Ungrounded answer: {result['faithfulness']}"
```

## RAG grounding — hand-rolled claim extraction (no Ragas)

When you can't add Ragas: extract the answer's atomic claims, then assert each is entailed by the concatenated retrieved chunks. Fail on any unsupported claim — an ungrounded claim is a hallucination.

```typescript
async function assertGrounded(answer: string, retrievedDocs: string[]) {
  const context = retrievedDocs.join('\n\n');
  const claims = await extractClaims(answer);           // LLM lists atomic factual claims

  for (const claim of claims) {
    const supported = await isEntailedBy(claim, context); // LLM: is claim supported by context? yes/no
    expect(supported, `Ungrounded claim (hallucination): "${claim}"`).toBe(true);
  }
}
```

## CI cost/budget gate

Evals call LLMs on every run, which costs money. Cache responses for deterministic inputs, and gate the suite on a token/$ budget so a runaway prompt can't blow the CI bill.

```typescript
const BUDGET_USD = 2.0;
let spent = 0;
const cache = new Map<string, string>();   // key = hash(prompt + input + temperature)

async function callLLMBudgeted(prompt: string, input: string, opts: { temperature: number }) {
  const key = hash(prompt + input + opts.temperature);
  if (opts.temperature === 0 && cache.has(key)) return cache.get(key)!;  // safe to cache deterministic-ish calls

  const { text, costUsd } = await callLLM(prompt, input, opts);
  spent += costUsd;
  if (spent > BUDGET_USD) {
    throw new Error(`Eval budget exceeded: $${spent.toFixed(2)} > $${BUDGET_USD}. Fix the prompt or raise the cap deliberately.`);
  }
  if (opts.temperature === 0) cache.set(key, text);
  return text;
}
```
