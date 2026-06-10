---
name: security-testing
description: >-
  Test application security against OWASP Top 10 (2025) with automated CI tooling: OWASP ZAP
  (DAST), dependency/supply-chain scanning (OSV-Scanner, SBOM, provenance), Semgrep SAST,
  auth/session tests (JWT, OAuth, RBAC), and XSS/CSRF/SQLi/SSRF Playwright patterns.
  Use when: "security test," "OWASP," "vulnerability," "ZAP," "XSS," "SSRF," "dependency scan,"
  "auth testing," "OWASP LLM Top 10." Scope is automated scanning + negative-path security tests in CI, not manual penetration testing.
  Not for: mapping security controls to regulations (SOC 2, HIPAA, PCI, GDPR) — use compliance-testing;
  pipeline stage wiring and deploy gating mechanics — use ci-cd-integration; purely functional API auth/input
  tests with no attacker model — see api-testing; testing your product's own LLM features or defending the
  agent itself (prompt-injection detector, indirect injection, jailbreak red-teaming) — use ai-system-testing.
  Related: ci-cd-integration, compliance-testing, api-testing, shift-left-testing, ai-system-testing.
license: MIT
metadata:
  author: kindlmann
  version: "2.1"
  category: specialized
---

<objective>
A login test that only checks the happy path passes while an expired JWT still grants admin, an
IDOR lets user A read user B's orders, and a webhook field reaches `169.254.169.254`. This skill
forces the negative-path checks — broken access control, injection, SSRF, auth bypass, supply-chain
drift — into CI on every PR, layered across DAST, SCA, SAST, and custom Playwright tests so no single
tool's blind spot ships. It produces runnable tests mapped to the OWASP Top 10 (2025) plus the CI
gates that fail the build when a category regresses.
</objective>

## Discovery Questions

Check `.agents/qa-project-context.md` first — if it exists, use it and skip anything already answered there (auth mechanism, compliance requirements, infrastructure). Then:

1. **Threat model:** Has the team identified key assets, threat actors, and attack surfaces? If not, do a lightweight threat model before writing tests — it tells you which categories matter most.
2. **Auth mechanism:** Session cookies, JWT, OAuth 2.0/OIDC, API keys, or MFA? Each has distinct negative-path tests (alg confusion, session fixation, state tampering).
3. **Compliance requirements:** SOC 2, HIPAA, PCI DSS, GDPR? These mandate specific controls — map them with `compliance-testing`; this skill only proves the controls behave.
4. **Existing security tooling:** Already running OSV-Scanner, Snyk, Dependabot, Semgrep, or ZAP? Check CI config for existing security stages before adding duplicates.
5. **API surface:** REST, GraphQL, gRPC? Each protocol has specific injection and authorization vectors.
6. **Deployment model:** Cloud (AWS/GCP/Azure), containers, serverless? Cloud-metadata endpoints are prime SSRF targets and misconfiguration is A02.

---

## Core Principles

1. **Security is continuous, not a phase.** Scans run in CI on every PR, not as a quarterly penetration test. A vulnerability caught on the PR that introduced it costs minutes; the same vulnerability found in prod costs an incident.

2. **OWASP Top 10 is the floor, not the ceiling.** It covers the most common impactful classes. Domain-specific threats (healthcare data, financial transactions, multi-tenant isolation) need their own analysis on top.

3. **Defense in depth — no single tool catches everything.** ZAP misses auth-logic bugs, SCA misses your custom code, Semgrep misses runtime issues. Layer DAST + SCA + SAST + auth tests + secret scanning. When one layer's blind spot is another layer's coverage, a regression has to beat all of them. SCA earns its layer because most of the shipped code is third-party — known CVEs in dependencies are the lowest-effort attack vector, so scan on every build.

4. **Shift-left.** Catch each class at the earliest stage: SAST and secret scanning on commit, dependency/supply-chain checks on the PR, DAST in staging, custom auth tests on every run. See `shift-left-testing` for the dev-QA workflow this rides on.

5. **Test the attacker, not the user.** Happy-path auth proves login works. Security tests prove logout invalidates the session, an expired token is rejected, role escalation fails, and a malformed payload fails closed. The negative path IS the test.

---

## OWASP Top 10 (2025) Testing Checklist

The 2025 list (final, owasp.org/Top10/2025/) re-orders categories and introduces two new ones. Changes from 2021:

- **A03 Software Supply Chain Failures** is new (replaces "Vulnerable and Outdated Components"; broadens to provenance, build-pipeline trust, SBOM).
- **A10 Mishandling of Exceptional Conditions** is new. SSRF is no longer standalone — its tests now sit under A01 (access control) and A06 (insecure design).
- **A02 Security Misconfiguration** moved up from A05.
- **A07 Authentication Failures** — name shortened (drops "Identification and").
- **A09 Security Logging and Alerting Failures** — renamed (was "Logging and Monitoring").

For runnable test code per category, see `references/owasp-tests.md`.

### A01: Broken Access Control

The #1 vulnerability. Users act outside intended permissions. SSRF is now an access-control failure when the server is induced to reach internal resources for an attacker.

**What to test:** IDOR (change resource IDs to reach other users' data), missing function-level access control (admin endpoints as a regular user), path traversal (`../../etc/passwd`), CORS misconfiguration, SSRF (user URLs reaching internal networks, cloud-metadata endpoints, `file://`).

### A02: Security Misconfiguration

Default credentials, unnecessary features, verbose errors. Promoted from A05 — still the easiest way in.

**What to test:** stack traces disabled in prod, default credentials changed, unnecessary HTTP methods (e.g. TRACE) disabled, directory listing off, admin panels not public, cloud buckets not public.

### A03: Software Supply Chain Failures

New in 2025. Beyond "outdated dependencies" — provenance, build-pipeline integrity, the supply chain end-to-end.

**What to test:** lockfile committed and CI installs from it (`npm ci`, never `npm install`); SBOM generated and stored as a build artifact (Syft / `anchore/sbom-action`); provenance attestation for built artifacts (SLSA v1.0 L2/3, signed via `cosign` / `actions/attest-build-provenance`); dependency review on every PR; CI secrets not exposed to forks; self-hosted runners isolated from untrusted PR code.

See `references/owasp-tests.md` for the dependency-review / SBOM / provenance workflow and the lockfile-drift check.

### A04: Cryptographic Failures

Sensitive data exposed via weak or missing encryption.

**What to test:** TLS version / cipher suites / HSTS; passwords hashed with bcrypt/argon2 (not MD5/SHA1); no sensitive data in URLs, logs, or errors; cookies carry `Secure`, `HttpOnly`, `SameSite`; security headers present (HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options`).

### A05: Injection

Untrusted data sent to an interpreter.

**What to test:** SQL injection in params/fields/headers; XSS (reflected, stored, DOM) in user content; CSRF on state-changing operations; command injection in filenames, search queries, webhook URLs.

### A06: Insecure Design

Flawed architecture implementation alone can't fix. Includes design-level SSRF (URL-accepting features without an allow-list), credential stuffing without rate limits, business-logic abuse.

**What to test:** rate limiting on auth endpoints (fire 15 concurrent login attempts, expect a `429` in the responses); business-logic abuse (negative quantities, coupon stacking); account lockout after failed attempts; allow-list architecture for any feature that fetches a user-supplied URL.

### A07: Authentication Failures

Broken authentication, weak passwords, credential stuffing. Session rotation after login, expired/`alg:none` JWT rejection, RBAC matrix, OAuth state tampering. See `references/auth-tests.md`.

### A08: Software or Data Integrity Failures

Unsigned updates, insecure deserialization, untrusted CI/CD.

**What to test:** Subresource Integrity (SRI) on CDN scripts; Content-Security-Policy header present and free of `'unsafe-inline'` / `'unsafe-eval'`.

### A09: Security Logging and Alerting Failures

Insufficient logging *and* missing alerts on what is logged. Renamed in 2025 to stress that logs without alerts are after-the-fact evidence, not detection.

**What to test:** failed logins logged AND alerting above threshold; admin actions audit-logged AND alerting on out-of-hours events; logs free of secrets/PII; the alert pipeline itself monitored.

### A10: Mishandling of Exceptional Conditions

New in 2025. Errors and unexpected states are an attack surface — fail-open defaults, uncaught exceptions leaking internals, race conditions in error paths, security checks skipped when "something went wrong."

**What to test:** error responses leak no stack traces / framework names / DB schema; auth fails closed (deny by default); timeouts and partial failures never bypass authorization; resource cleanup on every error path; fuzz every endpoint and verify responses stay within the documented error contract.

---

## OWASP LLM Top 10 (2025)

If your app embeds an LLM (chatbot, RAG, agent, copilot), the classic Top 10 above does not cover its failure modes — use the OWASP Gen AI Security Project's separate list (genai.owasp.org/llm-top-10/). This is the security/CI-gate view: one-line "what to test" per category. For the DEEP behavioral coverage of LLM01 and LLM02 — indirect injection via tool/RAG data, defend-the-tester technique, jailbreak red-teaming, and the runnable injection detector — hand off to `ai-system-testing`; do not duplicate it here.

| ID | Category | What to test |
|----|----------|--------------|
| **LLM01** | Prompt Injection | Direct + indirect injection (instructions hidden in retrieved docs, tool output, file content) override system intent. → DEEP coverage in `ai-system-testing`. |
| **LLM02** | Sensitive Information Disclosure | Model leaks PII, secrets, other tenants' data, or training data via crafted prompts. → DEEP coverage (detector, scoped tests) in `ai-system-testing`. |
| **LLM03** | Supply Chain | Provenance of models, adapters, datasets, and plugins; pinned/verified weights; poisoned third-party model or LoRA. |
| **LLM04** | Data and Model Poisoning | Training/fine-tune/RAG-ingest data integrity; backdoors and bias injected via tainted sources. |
| **LLM05** | Improper Output Handling | LLM output reaching a downstream interpreter unsanitized — XSS, SSRF, SQLi, command injection from generated text. |
| **LLM06** | Excessive Agency | Agent has more tools/permissions/autonomy than the task needs; can delete, pay, or email without a human gate. |
| **LLM07** | System Prompt Leakage | System prompt extractable, and — worse — relied on to hold secrets or enforce authz that belongs server-side. |
| **LLM08** | Vector and Embedding Weaknesses | RAG retrieval crosses tenant/permission boundaries; embedding inversion; poisoned vectors returned as context. |
| **LLM09** | Misinformation | Confident fabrication (hallucinated facts, fake citations/URLs, unsafe code) accepted as authoritative. |
| **LLM10** | Unbounded Consumption | No token/rate/cost ceilings — prompt-driven resource exhaustion, denial-of-wallet, model extraction by query volume. |

LLM05 (Improper Output Handling) is where the classic Top 10 reconnects: treat LLM output as untrusted input and re-run the A05 Injection checks on anything it produces.

---

## Automated Security Scanning

A complete pipeline layers DAST, dependency/supply-chain scanning, SAST, and secret scanning. Config and CI workflows are in `references/scanning-and-ci.md`.

- **OWASP ZAP (DAST):** baseline scan against staging on every PR; `zap-api-scan.py` for APIs. ZAP 2.17.0 is current (weekly `w2026-MM-DD` Docker tags). The **ZAP MCP Server (April 2026)** lets coding agents drive spider/active-scan/alert-analysis for "scan the diff" workflows.
- **Dependency / supply-chain:** **OSV-Scanner is the default gate** — multi-language and exits non-zero on any vuln. Add SBOM (Syft) + provenance (`cosign` / `attest-build-provenance`) for A03. `npm audit --audit-level=high` is a noisy semver-only quick check, not the gate (it won't flag non-strict-semver versions and doesn't reliably exit non-zero).
- **SAST:** **Semgrep `p/owasp-top-ten` is the SAST gate.** `eslint-plugin-security` is a weak secondary signal — see the note below; keep it as a lint-time nudge, not coverage.
- **Secret scanning:** TruffleHog with `--only-verified` in CI; `git-secrets` pre-commit.

**Avoid relying on `eslint-plugin-security` as your SAST gate** — as of mid-2026 it ships ~13 rules, has had no meaningful rule growth since 2020, and benchmarks put its miss rate near 90% of detectable vulnerabilities. Its 4.0.0 release is flat-config-compatible so the config runs, but layer it *under* Semgrep, never instead of it.

**ESLint 10 (Feb 2026) removed `.eslintrc` entirely** — only flat config (`eslint.config.js`) works. Any `.eslintrc.*` security config is dead on ESLint 10; use it only for repos pinned to ESLint 8. See `references/scanning-and-ci.md` for both blocks.

---

## Auth Testing Patterns

Session management, JWT (expiry, `alg: none` confusion, wrong-key signing), and RBAC matrix tests. Full code in `references/auth-tests.md`. Also test session rotation after login (session fixation) and OAuth state-parameter tampering.

---

## CI Integration

A complete security pipeline has five layers, each a CI step:

1. **Secret scanning** — TruffleHog with `--only-verified`
2. **Dependency check** — OSV-Scanner (fails on any vuln); SBOM + provenance for A03
3. **SAST** — Semgrep `p/owasp-top-ten` as the gate; ESLint security plugins as a weak secondary
4. **DAST** — ZAP baseline scan against staging URL
5. **Custom auth tests** — `npx playwright test --project=security`

**Security as PR gate:** OSV-Scanner exits non-zero on any vulnerability and gates the merge directly. If you gate on `npm audit` instead, parse `npm audit --json` and `exit 1` when high/critical count > 0 — `npm audit` does not reliably exit non-zero on its own. See `references/scanning-and-ci.md` for the runnable gate.

---

## Anti-Patterns

**Security testing only before release.** Late findings are expensive. Scan every PR, not quarterly.

**Relying on a single tool.** ZAP misses auth-logic bugs; SCA misses custom code; ESLint misses runtime issues. Layer multiple tools.

**Treating a near-dead linter as SAST coverage.** `eslint-plugin-security` alone catches almost nothing (~13 rules, 2020-era detection). Gate on Semgrep `p/owasp-top-ten`; keep the linter as a nudge.

**Ignoring dependency warnings.** "Fix it later" becomes a backlog of known CVEs. Fail the build on high/critical via OSV-Scanner.

**Testing only happy-path auth.** Login works — fine. Does logout invalidate the session? Can an expired token still access resources? Does role escalation work?

**Hardcoding secrets in test files.** Tests holding real keys are themselves a vulnerability. Use env vars and CI secrets.

**Skipping SSRF testing.** Any URL-accepting feature (webhooks, image uploads, imports) is an SSRF vector. Test internal addresses and cloud-metadata endpoints.

**Asserting a single status where several are valid.** SSRF/CSRF/exceptional-condition tests have a set of acceptable codes. Use `expect([400, 403, 422]).toContain(response.status())` — `toBeOneOf` is not a built-in matcher and throws at runtime.

**Testing only known payloads.** The XSS/SQLi payloads in the references are examples, not exhaustive. Use ZAP's maintained payload database for breadth.

---

## Verification

Prove the assertions actually fire — a security suite that passes vacuously (wrong URL, matcher never reached) is worse than none.

1. **Point one negative-path test at a deliberately vulnerable target** and confirm it FAILS. Run a known-vulnerable app such as OWASP Juice Shop locally:
   ```bash
   docker run --rm -p 3000:3000 bkimminich/juice-shop
   BASE_URL=http://localhost:3000 npx playwright test --project=security
   ```
   The IDOR / injection / missing-header tests should report failures. If everything is green against Juice Shop, your assertions aren't reaching the app — fix selectors/URLs before trusting a green run against your own staging.
2. **Confirm the matcher form runs.** `grep -r "toBeOneOf" tests/` must return nothing — every acceptable-set assertion uses `expect([...]).toContain(...)`.
3. **Confirm the gate fails on a planted vuln.** Add a known-vulnerable dependency, run the OSV-Scanner step, and verify the job exits non-zero. Remove it after.

---

## Done When

- A committed `owasp-coverage.md` (or a CI job asserting it) maps every OWASP 2025 category to at least one tagged test, or to a recorded "mitigated / accepted risk" entry with justification — no category is silently absent.
- OSV-Scanner (or equivalent) runs in CI and the job exits non-zero on high/critical vulnerabilities — verified by the planted-vuln check in Verification.
- Semgrep `p/owasp-top-ten` runs in CI and reports zero unresolved findings on the main branch (ESLint security plugins may run as a secondary, non-gating signal).
- ZAP baseline scan runs against staging and uploads its report as a CI artifact on every run (`if: always()`).
- The security Playwright project (`--project=security`) exits 0 against staging AND produces failures when pointed at OWASP Juice Shop (proves assertions fire).
- Auth/session edge cases each have a passing test: CSRF rejection, expired-token rejection, `alg:none` rejection, session invalidation on logout, RBAC role-escalation prevention.
- No real secrets in test files (`grep` / TruffleHog clean).

## Related Skills

- **ci-cd-integration** — pipeline stage wiring and deploy gating mechanics; go there for *how* to run these steps, here for *what* they assert.
- **compliance-testing** — mapping security controls to regulations (SOC 2, HIPAA, PCI, GDPR); this skill proves the controls work, that one proves you have the right ones.
- **ai-system-testing** — your product's own LLM features. Owns the deep OWASP LLM Top 10 work: indirect prompt injection, the injection detector, sensitive-info-disclosure tests, jailbreak red-teaming. This skill names the LLM categories for CI gating; that one defends the agent.
- **api-testing** — functional REST/GraphQL auth, input, and rate-limit tests without an attacker model; go there when there's no threat being simulated.
- **shift-left-testing** — the dev-QA workflow, TDD, and definition-of-done that the shift-left principle here rides on.
- **test-environments** — secure test-environment config, secret management, network isolation.
- **database-testing** — data integrity and access control at the database level.

## Reference Files (in `references/`)

- **owasp-tests.md** — runnable Playwright code for OWASP A01–A10 (IDOR, SSRF, injection, crypto, security headers, rate-limiting, supply-chain SBOM/provenance, exceptional conditions), plus the acceptable-status-set matcher note.
- **scanning-and-ci.md** — ZAP, OSV-Scanner/Snyk, Semgrep + ESLint flat-config SAST, secret scanning, and the five-layer CI pipeline with the runnable dependency gate.
- **auth-tests.md** — session, JWT (`alg:none`, expiry), and RBAC matrix tests for A07.
