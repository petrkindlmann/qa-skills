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

**ZAP MCP Server (April 2026):** Lets coding agents (Claude Code, Codex, Cursor) drive scans during development — useful for "scan the diff" workflows and AI-augmented security review. Pair with `ai-qa-review` for agent-driven triage. **OWASP PTK** is now bundled with ZAP-launched browsers; PTK findings surface as ZAP alerts, giving one-tool DAST + SAST + SCA flow.

## Dependency Scanning

```yaml
# GitHub Actions: npm audit + Snyk
dependency-check:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - run: npm ci
    - name: npm audit
      run: npm audit --audit-level=high
      continue-on-error: true

    - name: Snyk test
      uses: snyk/actions/node@master
      env:
        SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
      with:
        args: --severity-threshold=high
```

Configure Dependabot in `.github/dependabot.yml` with daily npm updates and security team reviewers.

## SAST (Static Analysis)

ESLint 9 flat config (default for new projects) — pick this for greenfield repos:

```javascript
// eslint.config.js -- ESLint 9 flat config
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

ESLint 8 / `.eslintrc.*` legacy config (only for existing projects still on the old config format):

```javascript
// .eslintrc.js -- legacy config
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

For deeper multi-language SAST, use Semgrep (`semgrep/semgrep-action@v1`) with rulesets `p/owasp-top-ten`, `p/javascript`, `p/typescript`. Re-validate the `p/owasp-top-ten` ruleset against the 2025 list before relying on it as a gate. **Semgrep MCP** (2026) exposes `semgrep_findings` for agent-driven triage — pair with `ai-qa-review` when reviewing AI-authored code.

## Secret Scanning

Use TruffleHog (`trufflesecurity/trufflehog@main`) in CI with `--only-verified` and full git history (`fetch-depth: 0`). For pre-commit prevention, use `git-secrets` with `git secrets --install && git secrets --register-aws`.

## Security as PR Gate

A complete security pipeline has five layers, each as a CI step:

1. **Secret scanning** — TruffleHog with `--only-verified`
2. **Dependency check** — `npm audit --audit-level=high`
3. **SAST** — ESLint security plugins against source
4. **DAST** — ZAP baseline scan against staging URL
5. **Custom auth tests** — `npx playwright test --project=security`

Block merges when `npm audit --json` reports high/critical vulnerabilities. Parse the JSON output and fail the step with `exit 1` if count > 0.
