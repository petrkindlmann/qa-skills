# Coverage as CI Gate

Workflow and script code for PR coverage diffs, threshold configuration, and the ratchet pattern. The decision prose lives in `SKILL.md`.

## Coverage Diff on PRs

Show coverage change per PR so reviewers see the impact of each change.

```yaml
# GitHub Actions: coverage diff comment
- name: Run tests with coverage
  run: npm run test:coverage

- name: Coverage Report
  uses: davelosert/vitest-coverage-report-action@v2
  if: github.event_name == 'pull_request'
  with:
    json-summary-path: coverage/coverage-summary.json
    json-final-path: coverage/coverage-final.json
    vite-config-path: vitest.config.ts
```

Alternative: use `marocchino/sticky-pull-request-comment@v2` with a script that reads `coverage-summary.json`, filters to changed files (via `git diff --name-only origin/main...HEAD`), and renders a markdown table showing per-file line and branch coverage.

## Threshold Configuration

**Global threshold (minimum for the entire project):**

```typescript
// vitest.config.ts
coverage: {
  thresholds: {
    lines: 80,
    branches: 80,
    functions: 80,
    statements: 80,
  },
}
```

**Per-directory thresholds (stricter for critical code):**

```typescript
// vitest.config.ts
coverage: {
  thresholds: {
    // Global baseline
    lines: 75,
    branches: 75,

    // Stricter for critical paths
    "src/payments/**": { lines: 95, branches: 90 },
    "src/auth/**": { lines: 90, branches: 85 },
    "src/utils/**": { lines: 80, branches: 80 },
  },
}
```

**Jest per-file thresholds:**

```javascript
// jest.config.js
module.exports = {
  coverageThreshold: {
    global: { branches: 75, functions: 75, lines: 75, statements: 75 },
    "./src/payments/": { branches: 90, functions: 90, lines: 95, statements: 95 },
    "./src/auth/": { branches: 85, functions: 85, lines: 90, statements: 90 },
  },
};
```

## Ratchet Pattern

Never let coverage decrease. Record the current level as the minimum and update it upward when coverage improves.

```typescript
// scripts/coverage-ratchet.ts
import fs from "fs";
import coverageSummary from "../coverage/coverage-summary.json";

const RATCHET_FILE = ".coverage-ratchet.json";

interface Ratchet {
  lines: number;
  branches: number;
  functions: number;
  statements: number;
  updatedAt: string;
}

// Read current ratchet or initialize
let ratchet: Ratchet;
try {
  ratchet = JSON.parse(fs.readFileSync(RATCHET_FILE, "utf-8"));
} catch {
  ratchet = { lines: 0, branches: 0, functions: 0, statements: 0, updatedAt: "" };
}

const current = (coverageSummary as any).total;
const metrics = ["lines", "branches", "functions", "statements"] as const;
let failed = false;

for (const metric of metrics) {
  const currentPct = current[metric].pct;
  const ratchetPct = ratchet[metric];

  if (currentPct < ratchetPct) {
    console.error(
      `FAIL: ${metric} coverage dropped from ${ratchetPct}% to ${currentPct}% (delta: ${(currentPct - ratchetPct).toFixed(1)}%)`
    );
    failed = true;
  } else if (currentPct > ratchetPct) {
    console.log(`IMPROVED: ${metric} coverage increased from ${ratchetPct}% to ${currentPct}%`);
    ratchet[metric] = Math.floor(currentPct); // Floor to avoid ratcheting on decimals
  } else {
    console.log(`STABLE: ${metric} coverage at ${currentPct}%`);
  }
}

if (failed) {
  console.error("\nCoverage ratchet failed. Coverage must not decrease.");
  console.error("If this is intentional (e.g., removing dead code), update .coverage-ratchet.json manually.");
  process.exit(1);
}

// Update ratchet file
ratchet.updatedAt = new Date().toISOString();
fs.writeFileSync(RATCHET_FILE, JSON.stringify(ratchet, null, 2) + "\n");
console.log(`\nRatchet updated: ${JSON.stringify(ratchet)}`);
```

Commit `.coverage-ratchet.json` to the repo (e.g., `{ "lines": 82, "branches": 78, ... }`). In CI, run the ratchet script after tests. On main branch merges, auto-commit the updated ratchet file if coverage improved.
