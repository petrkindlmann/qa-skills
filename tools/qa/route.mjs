// This is an explicit routing policy, not a model. The host agent reads the
// selected skills and applies their domain reasoning to the actual project.
const rules = [
  ['agentic-browser-testing', /agentic|goal[- ]driven|agent.*explor.*(?:app|browser)/i, 'A browser agent needs a bounded goal and an independent oracle.'],
  ['payment-testing', /payment|checkout|\bstripe\b|\b3ds\b|webhook.*sign|test card/i, 'The goal includes payment behavior and provider contracts.'],
  ['email-testing', /\bemail\b|inbox|\botp\b|magic link|password reset/i, 'The goal includes an inbox or account recovery flow.'],
  ['compliance-testing', /consent|\bgdpr\b|\bcmp\b|cookie.*(?:allow|block)|\bgpc\b|\btcf\b/i, 'The goal asks whether collection is permitted under the configured policy.'],
  ['analytics-tracking-testing', /\bga4\b|analytics|dataLayer|tracking plan|pixel.*fir/i, 'The goal asks whether tracking events carry the correct data.'],
  ['accessibility-testing', /accessib|\ba11y\b|\bwcag\b|screen reader|\baxe\b/i, 'The goal includes accessible controls, navigation, or WCAG checks.'],
  ['ai-system-testing', /(?:our|product|app|application|feature|chatbot|assistant).*(?:\bLLM\b|generative AI|\bAI\b)|(?:\bLLM\b|\bAI\b).*(?:feature|chatbot|prompt injection|evaluation|product)|prompt injection|hallucinat/i, 'An AI feature in the product is the system under test.'],
  ['ai-test-generation', /generate.*tests?|(?:AI|agent).*write.*tests?|tests?.*(?:from|using).*(?:spec|prd|story|requirements)/i, 'The goal is to author executable tests from requirements.'],
  ['selector-drift-recovery', /(?:many|all|bulk|refactor|redesign).*(?:selector|locator|test)|selector drift|bulk.*regenerat/i, 'A UI change broke a group of selectors.'],
  ['test-reliability', /flaky|flakiness|quarantine|one.*(?:locator|selector)|self[- ]healing/i, 'An individual check is unreliable at runtime.'],
  ['ai-bug-triage', /triage|classif|cluster|dedup.*(?:bug|failure)|(?:batch|many|multiple).*(?:CI|failure|bug)/i, 'The goal is to classify a collection of failures.'],
  ['bug-reproduction', /reproduc|repro\b|regression|(?:bug|defect|broken|wrong|fails?).*(?:logout|login|account|session)|logout|old session/i, 'The goal needs a concrete reproduction and a regression assertion.'],
  ['performance-testing', /performance|\bk6\b|load test|lighthouse|web vitals|layout shift|\bcls\b|slow/i, 'The goal includes latency, load, or visible layout stability.'],
  ['security-testing', /security|\bowasp\b|vulnerab|\bxss\b|authorization|access control|session.*revok/i, 'The goal includes authorization or a security boundary.'],
  ['database-testing', /database|migration|\bsql\b|data integrity|idempotency.*index/i, 'The goal includes stored data and schema invariants.'],
  ['mobile-testing', /appium|detox|maestro|real device|android|\bios\b|mobile app/i, 'The goal requires native mobile or device coverage.'],
  ['cross-browser-testing', /cross[- ]browser|browser matrix|browserstack|\bsafari\b|browser engine/i, 'The goal compares browser engines.'],
  ['visual-testing', /visual regression|screenshot|pixel diff|visual test/i, 'The goal compares rendered appearance.'],
  ['contract-testing', /\bpact\b|consumer[- ]driven|contract test/i, 'The goal checks a service contract between consumers and providers.'],
  ['api-testing', /\bapi\b|endpoint|\brest\b|graphql|http contract/i, 'The goal checks an HTTP or GraphQL contract.'],
  ['playwright-automation', /playwright|\be2e\b|end[- ]to[- ]end|page object/i, 'The goal needs scripted browser automation.'],
  ['cypress-automation', /cypress|\bcy\./i, 'The project uses Cypress automation.'],
  ['unit-testing', /unit test|\bjest\b|vitest|pytest|\bmock\b/i, 'The goal checks isolated code behavior.'],
  ['test-suite-curation', /(?:prune|delete|duplicate|redundant|curat).*(?:test|suite)|audit.*suite/i, 'The goal concerns the composition of the regression suite.'],
  ['ai-qa-review', /review.*tests?|test smells|test quality|testability/i, 'The goal asks whether individual tests are sound.'],
  ['ci-cd-integration', /\bci\b|github actions|pipeline|continuous integration/i, 'The workflow must run in continuous integration.'],
  ['release-readiness', /release|go\/no[- ]go|smoke test|ship.*ready/i, 'The goal is a release decision with explicit coverage boundaries.'],
  ['risk-based-testing', /risk matrix|risk.*(?:rank|priorit)|heatmap|focus testing/i, 'Risk determines what to test first.'],
  ['test-planning', /sprint|test plan|what to test/i, 'The goal needs a bounded test plan.'],
  ['test-strategy', /strategy|roadmap|multi[- ]quarter/i, 'The goal concerns a longer-term QA approach.'],
  ['qa-project-bootstrap', /onboard|ramp up|joining.*(?:team|project)/i, 'A person is joining a project with existing QA.'],
  ['qa-start', /from scratch|no (?:qa|tests)|new project|set up qa/i, 'The project needs its first QA foundation.'],
  ['test-environments', /staging|container|docker|test environment/i, 'The goal needs a reproducible test environment.'],
  ['test-data-management', /test data|seed data|factories|fixtures/i, 'The goal needs isolated and reproducible test data.'],
  ['service-virtualization', /wiremock|\bmsw\b|stub api|mock service|third[- ]party.*unreliable/i, 'An external dependency needs a controlled test double.'],
  ['synthetic-monitoring', /synthetic|scheduled probe|uptime|sla check/i, 'The goal asks for recurring checks after release.'],
  ['testing-in-production', /canary|dark launch|feature flag|rollout|roll out/i, 'The goal concerns a controlled production release.'],
  ['observability-driven-testing', /telemetry|traces?.*(?:test|gap)|production (?:logs|errors)/i, 'Production evidence is an input to selecting checks.'],
  ['qa-dashboard', /dashboard|allure|report/i, 'The goal includes a readable evidence report.'],
  ['coverage-analysis', /coverage|istanbul/i, 'The goal asks where measured coverage is missing.'],
  ['chaos-engineering', /chaos|game day|fault injection|resilience/i, 'The goal needs controlled failure injection.'],
  ['test-migration', /migrate|selenium.*playwright|switch framework/i, 'The goal moves tests between frameworks.'],
];

export function routeSkills({ goal = '', project, hasUrl = false }) {
  const matches = rules.filter(([, pattern]) => pattern.test(goal)).map(([skill, , reason]) => ({ skill, reason }));
  // Resolve the overlaps before choosing a primary pair.
  const drop = new Set();
  if (matches.some(item => item.skill === 'ai-system-testing')) drop.add('ai-test-generation');
  if (matches.some(item => item.skill === 'selector-drift-recovery')) drop.add('test-reliability');
  if (matches.some(item => item.skill === 'ai-bug-triage')) { drop.add('bug-reproduction'); drop.add('ci-cd-integration'); }
  if (matches.some(item => item.skill === 'mobile-testing')) drop.add('cross-browser-testing');
  if (matches.some(item => item.skill === 'test-suite-curation')) drop.add('bug-reproduction');
  if (matches.some(item => item.skill === 'analytics-tracking-testing') && /event|pixel|tracking|dataLayer/i.test(goal)) drop.add('payment-testing');
  if (matches.some(item => item.skill === 'database-testing')) {
    if (!/inbox|send|deliver|confirmation|password reset|magic link|\botp\b/i.test(goal)) drop.add('email-testing');
    if (/database migration|schema migration/i.test(goal)) drop.add('test-migration');
  }
  const selected = matches.filter(item => !drop.has(item.skill));
  const changed = (project.changedFiles ?? []).join(' ');
  const supporting = [];
  for (const [pattern, skill, reason] of [
    [/payment|checkout|billing|stripe/i, 'payment-testing', 'Changed paths include a payment flow.'],
    [/consent|cookie|cmp/i, 'compliance-testing', 'Changed paths include consent handling.'],
    [/email|password.reset|mail/i, 'email-testing', 'Changed paths include an email flow.'],
    [/migration|schema|\.sql\b/i, 'database-testing', 'Changed paths include database structure.'],
    [/auth|login|session|logout/i, 'security-testing', 'Changed paths include an authentication boundary.'],
  ]) if (pattern.test(changed)) supporting.push({ skill, reason });
  if (!selected.length) {
    if (hasUrl || project.frameworks.includes('playwright')) selected.push({ skill: 'playwright-automation', reason: 'A browser target or an existing Playwright suite is available.' });
    else if (project.frameworks.includes('cypress')) selected.push({ skill: 'cypress-automation', reason: 'An existing Cypress suite is available.' });
    else if (project.checks.length) selected.push({ skill: 'unit-testing', reason: 'Run the existing project test contract first.' });
    else selected.push({ skill: 'qa-start', reason: 'No executable test contract was discovered.' });
  }
  const primary = selected.slice(0, 2);
  const used = new Set(primary.map(item => item.skill));
  const extra = [...selected.slice(2), ...supporting].filter(item => { if (used.has(item.skill)) return false; used.add(item.skill); return true; }).slice(0, 4);
  return { primary, supporting: extra, method: 'deterministic goal, project, and changed-path routing',
    hostRequired: 'The host agent must read the named SKILL.md files. This CLI does not call a model or author tests.' };
}

export function nextActions(result) {
  const actions = [];
  if (result.checks.some(check => check.status === 'failed')) actions.push({ skill: 'bug-reproduction', action: 'Read the failing evidence, reproduce the behavior, and add or repair the smallest relevant regression within the user-authorized scope. Rerun the same check. Do not weaken its assertion.' });
  if (result.checks.some(check => check.status === 'blocked')) actions.push({ skill: 'test-environments', action: 'Resolve the recorded missing tool, readiness contract, or execution limit, then rerun the blocked check.' });
  if (result.checks.some(check => ['incomplete', 'unverified'].includes(check.status))) actions.push({ skill: 'test-suite-curation', action: 'Review skipped or missing observations and connect a supported test reporter. A command exit code alone is not test evidence.' });
  if (!result.checks.length) actions.push({ skill: 'qa-start', action: 'Choose one critical behavior, author a passing control and a failing control, and declare its command in qa.config.json.' });
  actions.push({ skill: 'qa-dashboard', action: 'Report the observed checks, their target and build, and the uncovered work. Keep any release decision separate from a passing subset.' });
  return actions;
}
