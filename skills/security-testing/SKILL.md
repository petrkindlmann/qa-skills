---
name: security-testing
description: >-
  Test application security against OWASP Top 10 vulnerabilities. Covers OWASP ZAP
  integration, dependency scanning (Snyk/Dependabot), SAST with ESLint security
  plugins, auth/session testing (JWT, OAuth), XSS/CSRF/SQLi patterns, and CI
  integration for continuous security validation.
  Use when: "security test," "OWASP," "vulnerability," "pen test," "ZAP," "XSS,"
  "dependency scan," "auth testing."
  Related: ci-cd-integration, compliance-testing, api-testing.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: automation
---

<objective>
Test application security systematically against known vulnerability classes with automated tooling integrated into CI.
</objective>

**Before starting:** Check for `.agents/qa-project-context.md` in the project root. It contains auth mechanisms, compliance requirements, and infrastructure details that determine which security checks apply.

---

## Discovery Questions

1. **Threat model:** Has the team identified key assets, threat actors, and attack surfaces? If not, start with a lightweight threat model before writing security tests.
2. **Auth mechanism:** Session cookies, JWT, OAuth 2.0/OIDC, API keys, or multi-factor? Each has distinct test patterns.
3. **Compliance requirements:** SOC 2, HIPAA, PCI DSS, GDPR? These mandate specific security controls that must be validated.
4. **Existing security tooling:** Already running Snyk, Dependabot, SonarQube, or ZAP? Check CI config for existing security stages.
5. **API surface:** REST, GraphQL, gRPC? Each protocol has specific injection and authorization vulnerabilities.
6. **Deployment model:** Cloud (AWS/GCP/Azure), containers, serverless? Infrastructure misconfigurations are OWASP #5.

---

## Core Principles

1. **Security is a mindset, not a phase.** Security testing is continuous. It runs in CI on every PR, not as a quarterly penetration test.

2. **OWASP Top 10 is the minimum.** It covers the most common and impactful vulnerability classes. It is not exhaustive -- domain-specific threats (healthcare data, financial transactions) require additional analysis.

3. **Shift-left security.** Catch vulnerabilities at the earliest possible stage: SAST in the IDE, dependency scanning on commit, DAST in staging, penetration testing before release.

4. **Defense in depth.** No single tool catches everything. Layer SAST + dependency scanning + DAST + auth testing + secret scanning for comprehensive coverage.

5. **Continuous dependency scanning.** 80%+ of application code is third-party. Known vulnerabilities in dependencies are the lowest-effort attack vector. Scan on every build.

---

## OWASP Top 10 (2025) Testing Checklist

The 2025 list re-orders categories and introduces two new ones. Major changes from 2021:

- **A03 Software Supply Chain Failures** is new (replaces "Vulnerable and Outdated Components"; broadens to provenance, build pipeline trust, SBOM).
- **A10 Mishandling of Exceptional Conditions** is new. SSRF is no longer standalone — its tests now sit under A01 (access control) and A06 (insecure design).
- **A02 Security Misconfiguration** moved up from A05.
- **A07 Authentication Failures** — name shortened (drops "Identification and").
- **A09 Security Logging and Alerting Failures** — name updated (was "Logging and Monitoring").

Source: https://owasp.org/Top10/2025/

For runnable test code per category, see `references/owasp-tests.md`.

### A01: Broken Access Control

The #1 vulnerability. Users can act outside their intended permissions. SSRF (server-side request forgery) is now treated as an access-control failure when the server is induced to access internal resources on behalf of an attacker.

**What to test:**
- Insecure Direct Object References (IDOR): change resource IDs in URLs/API calls to access other users' data
- Missing function-level access control: access admin endpoints as a regular user
- Path traversal: `../../etc/passwd` in file parameters
- CORS misconfiguration: can a malicious origin make authenticated requests?
- SSRF: user-supplied URLs reaching internal networks, cloud metadata endpoints, or `file://` schemes

### A02: Security Misconfiguration

Default credentials, unnecessary features enabled, overly verbose errors. Promoted from A05 in 2021 — misconfigurations remain the easiest way for attackers to walk in.

**What to test:**
- Debug/stack traces disabled in production
- Default credentials changed
- Unnecessary HTTP methods disabled
- Directory listing disabled
- Admin panels not publicly accessible
- Cloud storage buckets not publicly readable/writable

### A03: Software Supply Chain Failures

New in 2025. Goes beyond "outdated dependencies" to cover provenance, build pipeline integrity, and the supply chain end-to-end.

**What to test:**
- Lockfile integrity: `package-lock.json` / `pnpm-lock.yaml` / `requirements.txt` is committed and CI installs from it (`npm ci`, not `npm install`)
- SBOM generated and stored as a build artifact (Syft, `actions/dependency-review-action`)
- Provenance attestation produced for built artifacts (SLSA v1.0 levels 2/3, signed with `cosign` / Sigstore)
- Dependency review on every PR (blocks new high-severity vulnerabilities entering the lockfile)
- CI/CD pipeline secrets not exposed to forks or untrusted code paths
- Self-hosted runners not running untrusted PR code without job-level isolation

See `references/owasp-tests.md` for the dependency-review/SBOM/provenance workflow and lockfile-drift check.

### A04: Cryptographic Failures

Sensitive data exposed due to weak or missing encryption.

**What to test:**
- Data in transit: TLS version, cipher suites, HSTS header
- Data at rest: passwords hashed with bcrypt/argon2 (not MD5/SHA1)
- Sensitive data in URLs, logs, or error messages
- Cookies missing `Secure`, `HttpOnly`, `SameSite` flags

### A05: Injection

Untrusted data sent to an interpreter as part of a command or query.

**What to test:**
- SQL injection in query parameters, form fields, headers
- XSS (reflected, stored, DOM-based) in user-generated content
- CSRF on state-changing operations
- Command injection in file names, search queries, webhook URLs

### A06: Insecure Design

Flawed architecture that cannot be fixed by implementation alone. Includes design-level vectors for SSRF (URL-accepting features without an allow-list), credential stuffing without rate limits, and business-logic abuse.

**What to test:** Rate limiting on auth endpoints (fire 15 concurrent login attempts, expect 429), business logic abuse (negative quantities, coupon stacking), missing account lockout after failed attempts, allow-list architecture for any feature that fetches a user-supplied URL.

### A07: Authentication Failures

Broken authentication, weak passwords, credential stuffing. See `references/auth-tests.md`.

### A08: Software or Data Integrity Failures

Unsigned updates, insecure deserialization, untrusted CI/CD pipelines.

**What to test:**
- Subresource Integrity (SRI) on CDN scripts
- Content Security Policy headers

### A09: Security Logging and Alerting Failures

Insufficient logging *and* missing alerts on the events that are logged. Renamed in 2025 to emphasize that logs without alerts are evidence after the fact, not detection.

**What to test:**
- Failed login attempts are logged AND trigger an alert when above threshold
- Admin actions are audit-logged AND alert on out-of-hours admin events
- Logs do not contain sensitive data (passwords, tokens, PII)
- Alert pipeline is itself monitored (alerts about absent alerts)

### A10: Mishandling of Exceptional Conditions

New in 2025. Errors and unexpected states are an attack surface — fail-open defaults, uncaught exceptions leaking internals, race conditions in error paths, and security checks that get skipped when "something went wrong."

**What to test:**
- Error responses do not leak stack traces, framework names, or DB schema
- Auth failures fail closed (deny by default), not open
- Timeouts and partial failures do not bypass authorization checks
- Resource cleanup happens on every error path (locks released, transactions rolled back)
- Fuzzing: send malformed payloads to every endpoint and verify responses stay within the documented error contract

---

## Automated Security Scanning

A complete pipeline layers DAST, dependency scanning, SAST, and secret scanning. Tooling config and CI workflows are in `references/scanning-and-ci.md`.

- **OWASP ZAP (DAST):** baseline scan against staging on every PR; `zap-api-scan.py` for APIs. ZAP MCP Server (2026) lets coding agents drive "scan the diff" workflows.
- **Dependency scanning:** `npm audit --audit-level=high` + Snyk + Dependabot.
- **SAST:** `eslint-plugin-security` + `eslint-plugin-no-unsanitized`; Semgrep for deeper multi-language analysis (`p/owasp-top-ten`).
- **Secret scanning:** TruffleHog with `--only-verified` in CI; `git-secrets` pre-commit.

---

## Auth Testing Patterns

Session management, JWT (expiry, `alg: none` confusion), and RBAC matrix tests. Full code in `references/auth-tests.md`. Also test session rotation after login, JWT signed with the wrong key, and OAuth state-parameter tampering.

---

## CI Integration

A complete security pipeline has five layers, each as a CI step:

1. **Secret scanning** -- TruffleHog with `--only-verified`
2. **Dependency check** -- `npm audit --audit-level=high`
3. **SAST** -- ESLint security plugins against source
4. **DAST** -- ZAP baseline scan against staging URL
5. **Custom auth tests** -- `npx playwright test --project=security`

### Security as PR Gate

Block merges when `npm audit --json` reports high/critical vulnerabilities. Parse the JSON output and fail the step with `exit 1` if count > 0. See `references/scanning-and-ci.md` for the full pipeline.

---

## Anti-Patterns

**Security testing only before release.** Vulnerabilities found late are expensive to fix. Run security scans on every PR, not quarterly.

**Relying on a single tool.** ZAP misses auth logic bugs. Snyk misses custom code vulnerabilities. ESLint misses runtime issues. Layer multiple tools for defense in depth.

**Ignoring npm audit warnings.** "We'll fix it later" becomes a backlog of known vulnerabilities. Treat high/critical dependency vulnerabilities as build failures.

**Testing only happy-path auth.** Login works -- great. Does logout actually invalidate the session? Can an expired token still access resources? Does role escalation work?

**Hardcoding secrets in test files.** Security tests that contain real API keys or passwords are themselves a vulnerability. Use environment variables and CI secrets.

**Skipping SSRF testing.** Any feature that accepts a URL (webhooks, image uploads, imports) is an SSRF vector. Test with internal network addresses.

**Testing only known payloads.** The XSS and SQLi payloads in the references are examples, not an exhaustive list. Use tools like ZAP that maintain current payload databases.

---

## Done When

- OWASP Top 10 checklist reviewed against the application and each item marked as tested, mitigated, or accepted risk with justification.
- ZAP passive scan run against the staging environment with all findings triaged (critical/high addressed, medium/low tracked in backlog).
- Dependency scanning enabled on the repository via Snyk or Dependabot, with high/critical vulnerabilities treated as build failures.
- SAST lint rules (ESLint security plugin or Semgrep) enabled in CI and producing zero unresolved errors on the main branch.
- Auth and session edge cases explicitly tested: CSRF protection, token expiry rejection, session invalidation on logout, and role escalation prevention.

## Reference Files (in `references/`)

- **owasp-tests.md** — Runnable test code for OWASP A01–A10 (IDOR, SSRF, injection, crypto, supply chain, exceptional conditions).
- **scanning-and-ci.md** — ZAP, dependency, SAST, secret-scanning tooling config and the five-layer CI pipeline.
- **auth-tests.md** — Session, JWT, and RBAC test patterns for A07.

## Related Skills

- **ci-cd-integration** -- Pipeline stages for security scanning, gating deployments on security results.
- **compliance-testing** -- Mapping security tests to regulatory requirements (SOC 2, HIPAA, PCI).
- **api-testing** -- API-specific security patterns: auth header validation, input sanitization, rate limiting.
- **test-environments** -- Secure test environment configuration, secret management, network isolation.
- **database-testing** -- Data integrity validation, access control at the database level.
