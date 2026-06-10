# Risk-Based Testing — Worked Examples

Four fully-scored examples showing the path from risk score to prescribed coverage.
Each follows the same shape: risk profile (Impact, Probability, composite score, zone),
the failure modes identified in Phase 3, and the coverage prescribed by the Phase-5
by-zone table.

---

## Example 1: E-commerce Checkout

**Risk profile:** Impact 5, Probability 4, Score 20 (CRITICAL)

**Failure modes identified:**
- Payment charged but order not created (race condition)
- Discount stacking applies incorrect total
- Inventory oversold under concurrent load
- Shipping calculator returns wrong rate for international addresses
- Tax calculation wrong for specific jurisdictions

**Test coverage prescribed:**
- Unit tests: discount calculation (all combinations), tax rules (per jurisdiction), inventory decrement logic
- Integration tests: payment gateway communication (success, failure, timeout, duplicate), order creation pipeline, inventory reservation under concurrency
- E2E tests: full checkout flow (guest + logged in), checkout with discount, checkout with international shipping, checkout retry after payment failure
- Load tests: 100 concurrent checkouts for last-stock item
- Monitoring: real-time order completion rate, payment-to-order reconciliation every 5 minutes, revenue anomaly detection

---

## Example 2: Content Loading (Media Platform)

**Risk profile:** Impact 4, Probability 3, Score 12 (HIGH)

**Failure modes identified:**
- CDN cache miss causes origin overload
- Video transcoding fails silently for specific codecs
- Thumbnail generation timeout leaves blank images
- Content recommendation engine returns stale or empty results

**Test coverage prescribed:**
- Unit tests: transcoding pipeline input validation, recommendation scoring algorithm
- Integration tests: CDN purge/refresh flow, transcoding job queue processing, thumbnail generation for each supported format
- E2E tests: content upload through playback, content discovery through recommendation click
- Monitoring: CDN hit ratio, transcoding failure rate, thumbnail generation latency p99

---

## Example 3: Third-Party API Integration

**Risk profile:** Impact 4, Probability 4, Score 16 (CRITICAL)

**Failure modes identified:**
- API rate limit exceeded during peak traffic
- API response schema changes without notice (breaking deserialization)
- API timeout causes cascade failure in synchronous call chain
- API returns 200 with error body (non-standard error handling)

**Test coverage prescribed:**
- Unit tests: response parser for all known response shapes including malformed responses, rate limit backoff calculation, circuit breaker state transitions
- Integration tests: API contract tests (validate response schema against expected shape), timeout handling, retry behavior, circuit breaker activation
- E2E tests: user flow when API is slow (degraded but functional), user flow when API is down (graceful fallback)
- Monitoring: API response time p50/p95/p99, error rate, rate limit proximity, circuit breaker state

---

## Example 4: Authentication Flows

**Risk profile:** Impact 5, Probability 2, Score 10 (HIGH)

**Failure modes identified:**
- Session token not invalidated on password change
- OAuth callback race condition allows account takeover
- MFA bypass through API endpoint that skips MFA check
- Rate limiting not enforced on login endpoint (brute force)

**Test coverage prescribed:**
- Unit tests: token generation and validation, password hashing, MFA code verification, rate limit counter logic
- Integration tests: full auth flow (register, login, logout, password reset), session invalidation on credential change, OAuth flow with all supported providers, MFA enrollment and verification
- E2E tests: login flow (valid credentials, invalid, locked account), password reset flow, MFA flow
- Security tests: brute force attempt (verify rate limiting), session fixation, token reuse after logout
- Monitoring: failed login rate spike, unusual session patterns, MFA bypass attempts
