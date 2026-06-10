# Automated Scanning & CI Integration

Tooling config for the five-layer security pipeline. The layer summary and PR-gate prose live in `SKILL.md`.

## OWASP ZAP (DAST)

ZAP 2.17.0 (Dec 2025) reduced duplicate-alert noise; weekly Docker tags follow `w2026-MM-DD`. Pin the GitHub Action to the current major or by SHA; treat the Docker image as `ghcr.io/zaproxy/zaproxy:stable` (the default).

```yaml
# GitHub Actions: ZAP baseline scan against staging
security-scan:
  runs-on: ubuntu-latest
  steps:
    - name: ZAP Baseline Scan
      uses: zaproxy/action-baseline@v0.15.0
      with:
        target: 'https://staging.example.com'
        rules_file_name: '.zap/rules.tsv'
        cmd_options: '-a'
    - name: Upload ZAP Report
      if: always()
      uses: actions/upload-artifact@v5
      with:
        name: zap-report
        path: report_html.html
```

For API scanning, use `zap-api-scan.py` with your OpenAPI spec. For full scans, use `zap-full-scan.py` via Docker (`ghcr.io/zaproxy/zaproxy:stable`).

**ZAP MCP Server (April 2026):** Lets coding agents (Claude Code, Codex, Cursor) drive spider/active-scan/alert-analysis during development — useful for "scan the diff" workflows and AI-augmented security review. Pair with `ai-qa-review` for agent-driven triage. **OWASP PTK** is now bundled with ZAP-launched browsers; PTK findings surface as ZAP alerts, giving one-tool DAST + SAST + SCA flow.

If you build MCP servers, note the separate `action-mcp-scan` GitHub Action / MCP add-on (2026-05-21) scans an MCP server as a *target* (prompt-injection, tool-poisoning, exposed tools) — a different capability from ZAP's MCP-driven scanning above.

## Dependency Scanning

**Default to OSV-Scanner** as the dependency gate, not `npm audit`. `npm audit` is noisy and semver-only (it won't flag non-strict-semver versions, and high alert-fatigue rates were widely reported through 2026); OSV-Scanner is multi-language and queries the OSV database directly, so it works the same for npm, PyPI, Go, and lockfiles in monorepos. Keep `npm audit` only as a quick local check.

```yaml
# GitHub Actions: OSV-Scanner as the failing dependency gate
dependency-check:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v5
    - run: npm ci   # install from the lockfile, never npm install in CI
    - name: OSV-Scanner
      uses: google/osv-scanner-action@v2   # non-zero exit on any vulnerability = failed gate
      with:
        scan-args: '--recursive ./'
```

If you must gate on `npm audit`, parse its JSON and fail explicitly — `npm audit` itself does not reliably exit non-zero at your chosen threshold:

```yaml
    - name: npm audit gate
      run: |
        npm audit --json > audit.json || true
        HIGH=$(jq '.metadata.vulnerabilities.high + .metadata.vulnerabilities.critical' audit.json)
        echo "high+critical: $HIGH"
        if [ "$HIGH" -gt 0 ]; then echo "::error::high/critical vulnerabilities found"; exit 1; fi
```

Snyk (`snyk/actions/node@master`, `--severity-threshold=high`) is a fine commercial alternative. Configure Dependabot in `.github/dependabot.yml` with daily npm updates and security-team reviewers. Trivy and Grype are equivalent OSV-Scanner alternatives if you already run them for container scanning.

## SAST (Static Analysis)

**Semgrep is the SAST gate. `eslint-plugin-security` is a weak secondary signal — do not rely on it alone.** As of mid-2026 `eslint-plugin-security` ships ~13 rules with no meaningful rule growth since 2020; benchmarks put its miss rate around 90% of detectable vulnerabilities. Its latest release (4.0.0) is flat-config-compatible, so the config below runs, but treat it as a cheap lint-time nudge layered under Semgrep, not as your SAST coverage.

ESLint flat config (the only config system on ESLint 10, which shipped Feb 2026 and removed `.eslintrc` entirely):

```javascript
// eslint.config.js -- flat config (ESLint 9 and 10)
import securityPlugin from 'eslint-plugin-security';
import noUnsanitized from 'eslint-plugin-no-unsanitized';

export default [
  securityPlugin.configs.recommended,
  {
    plugins: { 'no-unsanitized': noUnsanitized },
    rules: {
      'security/detect-object-injection': 'warn',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-unsafe-regex': 'error',
      'security/detect-eval-with-expression': 'error',
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'error',
    },
  },
];
```

**Avoid `.eslintrc.*` legacy config — ESLint 10 (Feb 2026) removed eslintrc support entirely; the block below is dead on ESLint 10 and applies only to repos pinned to ESLint 8.** Migrate to flat config rather than adding new eslintrc files.

```javascript
// .eslintrc.js -- pre-ESLint-10 ONLY (ESLint 8); dead on ESLint 9 flat default and removed in ESLint 10
module.exports = {
  plugins: ['security', 'no-unsanitized'],
  extends: ['plugin:security/recommended-legacy'],
  rules: {
    'security/detect-object-injection': 'warn',
    'security/detect-non-literal-regexp': 'warn',
    'security/detect-unsafe-regex': 'error',
    'security/detect-eval-with-expression': 'error',
    'no-unsanitized/method': 'error',
    'no-unsanitized/property': 'error',
  },
};
```

For real multi-language SAST, run Semgrep (`semgrep/semgrep-action@v1`) with rulesets `p/owasp-top-ten`, `p/javascript`, `p/typescript` — this is the gate that should fail the build. Re-validate the `p/owasp-top-ten` ruleset against the 2025 list before relying on it. **Semgrep MCP** (2026) exposes `semgrep_findings` for agent-driven triage — pair with `ai-qa-review` when reviewing AI-authored code.

## Secret Scanning

Use TruffleHog (`trufflesecurity/trufflehog@main`) in CI with `--only-verified` and full git history (`fetch-depth: 0`). For pre-commit prevention, use `git-secrets` with `git secrets --install && git secrets --register-aws`.

## Security as PR Gate

A complete security pipeline has five layers, each as a CI step:

1. **Secret scanning** — TruffleHog with `--only-verified`
2. **Dependency check** — OSV-Scanner (fails on any vuln); `npm audit --audit-level=high` only as a quick local check
3. **SAST** — Semgrep `p/owasp-top-ten` as the gate; ESLint security plugins as a weak secondary signal
4. **DAST** — ZAP baseline scan against staging URL
5. **Custom auth tests** — `npx playwright test --project=security`

OSV-Scanner exits non-zero on any vulnerability, so it gates the merge directly. If you gate on `npm audit` instead, parse `npm audit --json` and fail the step with `exit 1` when high/critical count > 0 (see the Dependency Scanning snippet above) — `npm audit` does not reliably exit non-zero on its own.
