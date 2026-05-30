# Test Patterns — Code

Runnable test code for tool-call validation and nondeterminism strategies. The surrounding decision prose ("verify correct tool selection," "statistical testing over N runs," "property-based assertions") lives in `SKILL.md`; this file holds the implementations.

## Tool selection tests

```typescript
describe('AI tool selection', () => {
  it('selects weather tool for weather queries', async () => {
    const result = await aiAgent.process('What is the weather in Prague?');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('get_weather');
    expect(result.toolCalls[0].arguments.city).toBe('Prague');
  });

  it('selects search tool for factual queries', async () => {
    const result = await aiAgent.process('Who won the 2024 World Series?');
    expect(result.toolCalls.some(tc => tc.name === 'web_search')).toBe(true);
  });

  it('does not call tools for conversational responses', async () => {
    const result = await aiAgent.process('Thank you for your help');
    expect(result.toolCalls).toHaveLength(0);
    expect(result.textResponse).toBeDefined();
  });
});
```

## Statistical testing over N runs

For nondeterministic outputs, run the same test multiple times and assert on aggregate results.

```typescript
async function statisticalAssert(
  fn: () => Promise<string>,
  assertion: (output: string) => boolean,
  { runs = 10, requiredPassRate = 0.8 }: { runs?: number; requiredPassRate?: number } = {},
): Promise<void> {
  const results = await Promise.all(
    Array.from({ length: runs }, () => fn().then(assertion)),
  );
  const passCount = results.filter(Boolean).length;
  const passRate = passCount / runs;

  expect(passRate).toBeGreaterThanOrEqual(requiredPassRate);
}

// Usage
test('summarizer consistently produces concise output', async () => {
  await statisticalAssert(
    () => aiService.summarize(longDocument),
    (summary) => summary.split('.').length <= 5 && summary.length < 500,
    { runs: 10, requiredPassRate: 0.9 },
  );
});
```

## Property-based assertions

Assert on properties that must hold regardless of the specific output.

```typescript
describe('response properties', () => {
  it('classification always returns a valid category', async () => {
    const validCategories = ['billing', 'technical', 'account', 'general'];
    for (const input of testInputs) {
      const result = await aiService.classify(input);
      expect(validCategories).toContain(result.category);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('response language matches request language', async () => {
    const frenchQuery = 'Quel est le prix de cet article?';
    const response = await aiService.chat(frenchQuery);
    const detectedLang = await detectLanguage(response);
    expect(detectedLang).toBe('fr');
  });

  it('structured extraction returns valid JSON schema', async () => {
    const result = await aiService.extractContact(emailText);
    expect(result).toMatchObject({
      name: expect.any(String),
      email: expect.stringMatching(/.+@.+\..+/),
      phone: expect.stringMatching(/^[\d\s\-\+\(\)]+$/),
    });
  });
});
```
