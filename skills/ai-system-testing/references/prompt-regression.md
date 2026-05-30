# Prompt Regression — Code

Implementations for the prompt regression workflow. The principles ("version prompts like code," baseline quality, A/B testing) live in `SKILL.md`; this file holds the runnable code.

## Version prompts like code

Prompts are a critical part of your application's behavior. They should be versioned, reviewed, and tested with the same rigor as code.

```typescript
// prompts/summarize.ts
export const SUMMARIZE_PROMPT = {
  version: '1.3',
  template: `Summarize the following document in {{maxSentences}} sentences.
Focus on key findings and actionable insights.
Use professional tone. Do not include opinions or speculation.

Document:
{{document}}`,
  parameters: {
    maxSentences: { type: 'number', default: 3, min: 1, max: 10 },
    document: { type: 'string', required: true },
  },
  changelog: [
    { version: '1.3', change: 'Added "Do not include opinions" constraint' },
    { version: '1.2', change: 'Changed from bullet points to sentences' },
    { version: '1.1', change: 'Added professional tone requirement' },
  ],
};
```

## Baseline response quality

Establish quality baselines for each prompt and detect regressions when prompts, models, or parameters change.

```typescript
// evals/summarize.eval.ts
interface EvalCase {
  input: string;
  criteria: EvalCriteria;
}

interface EvalCriteria {
  maxLength?: number;
  mustContain?: string[];
  mustNotContain?: string[];
  sentenceCount?: { min: number; max: number };
  formatCheck?: RegExp;
}

const summarizeEvalCases: EvalCase[] = [
  {
    input: readFixture('quarterly-report-q3.txt'),
    criteria: {
      maxLength: 500,
      mustContain: ['revenue', 'growth'],
      mustNotContain: ['I think', 'in my opinion', 'probably'],
      sentenceCount: { min: 2, max: 4 },
    },
  },
  {
    input: readFixture('technical-whitepaper.txt'),
    criteria: {
      maxLength: 500,
      mustContain: ['methodology'],
      mustNotContain: ['I think', 'maybe'],
      sentenceCount: { min: 2, max: 4 },
    },
  },
];

describe('summarize prompt regression', () => {
  for (const evalCase of summarizeEvalCases) {
    it(`produces acceptable summary for: ${evalCase.input.slice(0, 50)}...`, async () => {
      const result = await aiService.summarize(evalCase.input, { maxSentences: 3 });

      if (evalCase.criteria.maxLength) {
        expect(result.length).toBeLessThanOrEqual(evalCase.criteria.maxLength);
      }
      if (evalCase.criteria.mustContain) {
        for (const term of evalCase.criteria.mustContain) {
          expect(result.toLowerCase()).toContain(term.toLowerCase());
        }
      }
      if (evalCase.criteria.mustNotContain) {
        for (const term of evalCase.criteria.mustNotContain) {
          expect(result.toLowerCase()).not.toContain(term.toLowerCase());
        }
      }
      if (evalCase.criteria.sentenceCount) {
        const sentences = result.split(/[.!?]+/).filter(s => s.trim().length > 0);
        expect(sentences.length).toBeGreaterThanOrEqual(evalCase.criteria.sentenceCount.min);
        expect(sentences.length).toBeLessThanOrEqual(evalCase.criteria.sentenceCount.max);
      }
    });
  }
});
```

## A/B test prompts

When changing a prompt, run both versions against the eval suite and compare scores.

```typescript
async function abTestPrompts(
  promptA: string,
  promptB: string,
  evalCases: EvalCase[],
  runs: number = 5,
): Promise<{ promptA: EvalScores; promptB: EvalScores; winner: 'A' | 'B' | 'tie' }> {
  const scoresA: number[] = [];
  const scoresB: number[] = [];

  for (const evalCase of evalCases) {
    for (let i = 0; i < runs; i++) {
      const resultA = await callLLM(promptA, evalCase.input);
      const resultB = await callLLM(promptB, evalCase.input);

      scoresA.push(scoreResponse(resultA, evalCase.criteria));
      scoresB.push(scoreResponse(resultB, evalCase.criteria));
    }
  }

  const avgA = average(scoresA);
  const avgB = average(scoresB);
  const winner = Math.abs(avgA - avgB) < 0.05 ? 'tie' : avgA > avgB ? 'A' : 'B';

  return {
    promptA: { mean: avgA, stddev: stddev(scoresA), min: Math.min(...scoresA) },
    promptB: { mean: avgB, stddev: stddev(scoresB), min: Math.min(...scoresB) },
    winner,
  };
}
```
