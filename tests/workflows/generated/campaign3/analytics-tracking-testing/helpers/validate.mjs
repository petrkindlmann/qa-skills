// Port of references/tracking-plan.md "Validate normalized payloads" to plain ESM.
// Only the TypeScript annotations were removed; the logic is the recipe's.

export function validateEvent(plan, eventName, payload) {
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!object(plan)) throw new Error('Tracking plan must be an object');
  if (!Object.hasOwn(plan, eventName)) return [{ param: eventName, problem: 'missing', expected: 'event in plan' }];
  const required = plan[eventName]?.required;
  const checkRules = rules => {
    if (!object(rules) || !Object.keys(rules).length) throw new Error('Required tracking fields must be nonempty');
    for (const rule of Object.values(rules)) {
      if (rule === 'string' || rule === 'number') continue;
      if (!object(rule) || Object.keys(rule).length !== 1 || !Object.hasOwn(rule, 'array')) {
        throw new Error('Unsupported tracking field rule');
      }
      checkRules(rule.array);
    }
  };
  checkRules(required);
  const violations = [];
  const inspect = (rules, value, prefix) => {
    if (!object(value)) { violations.push({ param: prefix || eventName, problem: 'type', expected: 'object' }); return; }
    for (const [name, rule] of Object.entries(rules)) {
      const param = prefix ? `${prefix}.${name}` : name;
      if (!Object.hasOwn(value, name) || value[name] === undefined) {
        violations.push({ param, problem: 'missing' }); continue;
      }
      const actual = value[name];
      if (rule === 'string') {
        if (typeof actual !== 'string' || !actual.trim()) violations.push({ param, problem: 'type', expected: 'nonempty string' });
      } else if (rule === 'number') {
        if (typeof actual !== 'number' || !Number.isFinite(actual)) violations.push({ param, problem: 'type', expected: 'finite number' });
      } else if (!Array.isArray(actual) || actual.length === 0) {
        violations.push({ param, problem: 'type', expected: 'nonempty array' });
      } else {
        for (let i = 0; i < actual.length; i++) inspect(rule.array, actual[i], `${param}[${i}]`);
      }
    }
  };
  inspect(required, payload, '');
  return violations;
}
