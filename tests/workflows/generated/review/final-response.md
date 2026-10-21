# QA review: Shop and TodoMVC acceptance suites

## Decision and evidence limits

**Request focused changes before treating these suites as complete acceptance coverage.** The most consequential gaps are server-side logout revocation, persistence of TodoMVC removals, and independent checks of Shop prices. The suites otherwise contain useful integration coverage and generally sound scenario isolation.

This is a bounded, static review of the two public contracts, all five JavaScript files in the two requested baseline directories, the shared fixtures/runtime, and the Playwright configuration. I applied skills/ai-qa-review/SKILL.md plus its smell-examples.md and mutation-testing.md references. The project context file contains template placeholders rather than additional project-specific standards.

No application implementation, fault definitions, upstream source/probes, other generated suites, previous reports, or evals were read. The allowed baseline-shop/probe.spec.mjs was reviewed because it is itself selected by the proposed acceptance configuration. No browsers or tests were executed; no pass rate, runtime, mutation score, or observed flakiness is claimed. The request expressly permits code-only findings, so the skill's generic repeated-execution and mutation requirements were not used to expand this task. Only the two requested review artifacts were written.

Here, **proven gap** means the submitted assertions demonstrably do not distinguish the named behaviors. Counterexamples describe possible regressions that would escape those assertions, not defects established in the application.

## Prioritized findings

### 1. High — logout checks cookie removal, but does not establish server-side session revocation

**Evidence:** generated/baseline-shop/shop.spec.mjs:8–16 and 78; fixture-app-contract.md:47–49.

The API test logs in with clients.guest, logs out with that same API context, then checks protected endpoints using that context again. The browser scenario similarly checks page.request after signing out. Both contexts accept the logout response's cookie updates.

A logout implementation that expires the browser cookie but leaves the session usable on the server can pass all these assertions. The requests following logout would simply have no session cookie. The contract specifically requires invalidating the current session, so this is a proven false-negative gap in the test.

**Concrete change:** capture the authenticated shop_session value before logout. After logout, replay that exact old cookie from a separate request context or with an explicit Cookie header and assert 401 with the expected unauthenticated body. Keep the current same-context assertions because they cover the user-facing flow. This is one additional observation within the existing coherent lifecycle, not a reason to split the entire authentication scenario.

**Effort:** small. **Application status:** not investigated; no claim that logout is currently defective.

### 2. High — subsequent TodoMVC mutations can conceal missing persistence in delete and clear-completed

**Evidence:** generated/baseline-todo/todomvc.spec.mjs:172–201 and 204–220; todomvc-contract.md:36–41.

The comprehensive persistence scenario deletes a row at line 211 and clears completed rows at line 212, but then creates more todos at line 213 and changes completion at line 214 before reloading at line 216. The dedicated delete/clear lifecycle never reloads. The duplicate-record deletion scenario at lines 28–46 also does not reload after deletion.

Consequently, an application that updates the in-memory list correctly but forgets to save during row deletion or clear-completed can still pass: a subsequent create or checkbox action could save the entire current list and incidentally persist the earlier removals. This is a proven sequencing blind spot. The reload at lines 167–169 does check removal through empty edits, but that does not establish persistence for the distinct delete-button and clear-completed operations.

**Concrete change:** reload immediately after a row deletion and immediately after clear-completed, before any other data-changing action. In each case assert the retained titles/order and relevant completion state. Also assert empty-state persistence once after clearing the final item. These can be checkpoints in the existing lifecycle; separate scenarios are only necessary if they improve failure localization.

**Effort:** small to moderate. **Application status:** missing persistence is a counterexample, not an observed defect.

### 3. Medium — a single fixed basket does not independently constrain either product price

**Evidence:** generated/baseline-shop/shop.spec.mjs:19–24 and 70–77; generated/baseline-shop/helpers.mjs:42–50 and 53; fixture-app-contract.md:39–41 and 60–65.

The catalog assertion checks currency and SKU names, not prices. The meaningful successful-order money assertions all use two teas and one cup, with total 4200. The generic order helper checks amount type/positivity rather than calculating an independently expected total. Payment events are then built from the returned order amount.

A concrete counterexample is tea priced at 1500 and cup priced at 1200: 2 × 1500 + 1200 still equals 4200. The catalog and checkout assertions shown would accept that regression even though both contracted prices are wrong. A constant-total implementation can similarly escape the current successful-order cases. Payment tests should use the actual order for their payment workflow, but that makes independent price assertions elsewhere necessary.

**Concrete change:** create a one-unit order for each SKU and assert 1200 and 1800 respectively, with the expected item/quantity. Include one successful quantity-10 order to verify the promised inclusive maximum; the existing negative matrix tests 0 and 11 but not acceptance of 10. If the public catalog exposes a documented price field, assert those prices there as well. Keep the existing client-amount tampering check.

**Effort:** small. **Application status:** the compensating-price example demonstrates the gap; it is not a measured implementation failure.

### 4. Medium — the “exact raw bytes” signature case only proves rejection for the canonical payload form

**Evidence:** generated/baseline-shop/shop.spec.mjs:41–48; generated/baseline-shop/helpers.mjs:54–55; fixture-app-contract.md:82–89.

Every valid delivery uses JSON.stringify(event). The whitespace signature test signs bytes plus a space but sends the original bytes and expects rejection. That is useful, but it does not prove that a valid signature over a noncanonical JSON body will be accepted.

A verifier that parses the body and serializes it back into the helper's compact form before computing the HMAC could pass the existing valid cases and reject the whitespace-mismatch case, while incorrectly rejecting a legitimate pretty-printed or trailing-whitespace payload. This is a proven missing distinguishing input, with a hypothetical implementation counterexample.

**Concrete change:** add a raw-body send helper, or one direct request, that sends a deliberately noncanonical valid JSON string and its HMAC over exactly that string. Assert successful receipt and a single fulfillment, then replay the identical bytes and assert duplicate handling. Retain the current rejection checks.

**Effort:** small.

### 5. Low — remove the discovery probe from the ordinary acceptance run

**Evidence:** generated/baseline-shop/probe.spec.mjs:1–2; generated/baseline-shop/shop.spec.mjs:70–78; playwright.config.mjs:10–11; support/fixtures.mjs:12–15.

The configuration includes every *.spec.mjs under the chosen suite. The probe therefore opens a real browser, starts its own Shop scenario, logs in, checks that checkout is enabled, and prints the full accessibility snapshot. The checkout acceptance test already signs in and successfully places an order, providing stronger coverage of the same prerequisite.

**Concrete change:** remove the probe from the acceptance suite or rename/move it outside the selected spec pattern. Preserve it only as an explicitly invoked diagnostic utility if it remains useful. This eliminates one redundant browser scenario and its per-test Shop startup; no measured time saving is claimed.

**Effort:** small.

## Reliability

The most important sequencing issue is finding 2, where later mutations can repair the condition the test intends to observe. I did not establish a current flaky test or a false alarm against a conforming application.

The service runtime polls a readiness file and process state with deadlines (support/runtime.mjs:43–61). Those short polling delays are bounded condition checks, not unconditional browser sleeps, and should not be rejected merely because they use a timer. Restart preserves the database, namespace, and port (runtime.mjs:76–103), which is appropriate for the durability scenarios. There is no need to mock the local HTTP, SQLite, or Mailpit boundaries in these acceptance tests.

Inbox absence is checked with a single search at shop.spec.mjs:96. Whether delayed delivery can evade that check depends on a delivery-timing guarantee not established by these files. This is an unproven risk, not a prioritized defect, and does not justify adding an arbitrary sleep.

## Data isolation and cleanup

No material cross-test contamination defect was established. Shop is test-scoped and receives its own output directory/database (support/fixtures.mjs:12–15; runtime.mjs:76–85). Each Shop instance gets a UUID email suffix; restart reuses it. The Mailpit process is worker-scoped, but messages are searched by exact recipient and deleted by collected message IDs (generated/baseline-shop/helpers.mjs:13–34). These scopes match the public contract.

TodoMVC shares a server per worker, while the Playwright page/context remains test-scoped; browser-local storage therefore remains isolated as required by the contract. Service cleanup runs in finally blocks (support/fixtures.mjs:7–20). No global inbox deletion or intentional sharing of mutable browser state appears in the reviewed files.

Two small cleanup edges exist but are lower priority than the findings above: the clients fixture enters its disposal try/finally only after all contexts are created and authenticated (helpers.mjs:5–11), and one cleanup search failure can prevent the subsequent ID deletion (helpers.mjs:31–33). Their ultimate process-cleanup consequences were not measured. Moving acquisition into the try/finally and preserving collected IDs if a search fails would improve failure-path hygiene if these become operational pain points.

## Diagnostic value

The suite includes specific public-response assertions and independent durable-state checks for orders, receipts, fulfillment, and SMTP errors. These are meaningful checks, particularly the transaction rollback/retry scenario and concurrent event delivery.

Keep coherent authentication, checkout, reset, and TodoMVC lifecycles. Small named test.step sections or descriptive case labels can improve diagnosis of the negative-order matrix without forcing every assertion into a separate expensive scenario. No blocking request is based solely on test length or multiple lifecycle stages.

## Design and runtime cost

Finding 5 is the concrete avoidable runtime cost. The real local services are proportional to the intended acceptance layer, and TodoMVC already amortizes server startup at worker scope. There are no measured timings to justify changing worker counts, reducing real concurrency coverage, or replacing real services.

Deterministic loops over invalid inputs and expected filters are not, by themselves, defects. They execute explicit cases with assertions. Splitting every loop into a new Shop scenario would add database/server setup; use labels or steps first unless independent reporting has material value.

## Readability

The compressed Shop formatting makes review slower, but I have not elevated that into a CI blocker. The TodoMVC helper scopes duplicate-title actions by row position deliberately, and its role/CSS mixture is consistent with the public UI being exercised. No project-specific naming convention can be inferred from the placeholder context file.

## AI-generated tests

No fabricated import or hallucinated locator was demonstrated by this static review. The code's origin alone does not establish a closed implementation/test loop, and the forbidden implementation was not read. In particular, no mutation score is inferred from the presence of generated tests or the number of assertions.

## Coverage

Findings 1–4 are specific contract gaps. Strong existing coverage includes authenticated access, cross-user order privacy, concurrent idempotency, payment replay/conflict/rollback across restart, actual SMTP reset-link consumption, token expiry using the test clock, duplicate-title independence, filtered bulk operations, edit cancellation, and keyboard input.

I have not attempted an exhaustive input or boundary catalogue. Prioritize the four missing distinguishing observations above before broadening acceptance runtime.

## File assessment

Paths in this table are relative to tests/workflows. Severity is the highest finding associated with that file; “Low — no material finding” denotes review coverage, not an asserted defect.

| Reviewed file | Severity | Assessment |
|---|---|---|
| fixture-app-contract.md | Low — reference | Supplies the independent logout, pricing, and byte-signature obligations. |
| todomvc-contract.md | Low — reference | Requires removals and empty state to survive reload. |
| generated/baseline-shop/shop.spec.mjs | High | Findings 1, 3, and 4; strong concurrency and transactional checks otherwise. |
| generated/baseline-shop/helpers.mjs | Medium | Fixed basket/raw serialization support findings 3–4; scoped inbox cleanup is sound. |
| generated/baseline-shop/probe.spec.mjs | Low | Finding 5: redundant diagnostic scenario selected as acceptance. |
| generated/baseline-todo/todomvc.spec.mjs | High | Finding 2: later writes mask removal persistence. |
| generated/baseline-todo/todo-ui.mjs | Low — no material finding | Ordinary user input; duplicate rows deliberately targeted by position. |
| support/fixtures.mjs | Low — no material finding | Test-scoped Shop and worker-scoped services with finalizers. |
| support/runtime.mjs | Low — no material finding | Fresh database paths, unique addresses, bounded readiness/stop polling. |
| playwright.config.mjs | Low | Spec selection includes the discovery probe; no observed scheduling defect. |

## Recommended next step

Make the four targeted assertion/input changes, exclude the discovery probe, and run the two acceptance suites with their real local dependencies. Repeat only enough to investigate a concrete reliability concern or satisfy the team's CI gate. This review does not provide green-run certification.

No lint rule, mutation threshold, CI edit, or commit was added. The identified gaps depend on scenario semantics, so a generic new lint gate is not warranted from this sample. A small later regression experiment that disables logout revocation or persistence at an individual removal operation could validate the new checks, but no such experiment or application change was performed here.
