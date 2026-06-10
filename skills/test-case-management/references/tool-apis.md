# Tool API Reference — TestRail, Xray, Zephyr Scale, Qase

The four tools look alike but their APIs are genuinely different. The most common
agent failure is cross-wiring them: TestRail's `custom_steps_separated` on a Qase
body, Qase's `Token` header on Zephyr, Bearer on Qase, the deprecated `/rest/raven/1.0/`
path on Xray Cloud. Copy from the correct tool's section below.

| Tool | Base URL | Auth scheme | Create-case endpoint | Step field |
|------|----------|-------------|----------------------|------------|
| TestRail | `{instance}/index.php?/api/v2` | Basic auth `email:api_key` | `add_case/{section_id}` | `custom_steps_separated` (array) |
| Xray Cloud | `https://xray.cloud.getxray.app/api/v2` | 2-step: `/authenticate` → Bearer (24h) | GraphQL `/graphql` `createTest` | `steps[]` `{action, result}` |
| Zephyr Scale Cloud | `https://api.zephyrscale.smartbear.com/v2` | Bearer JWT | `POST /testcases` then `/testcases/{key}/teststeps` | separate `teststeps` call |
| Qase | `https://api.qase.io/v1` | Header `Token: <key>` (NOT Bearer) | `POST /case/{CODE}/bulk` | `steps[]` `{action, expected_result, data}` |

---

## TestRail — `add_case` with separated steps

Endpoint is `add_case/{section_id}` — the case attaches to a **section**, not a suite directly.
Do NOT confuse `add_case` (a test case in the repository) with `add_test` (a test instance
inside a run). Separated steps require the `custom_steps_separated` custom field — an array
of `{content, expected}` objects. The plain `custom_steps` field is a single text blob and
will NOT give you per-step expected results.

Auth is HTTP Basic with `email:api_key` (or `email:password`), not a bearer token.

```bash
curl -u "qa@example.com:YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -X POST "https://example.testrail.io/index.php?/api/v2/add_case/432" \
  -d '{
    "title": "Checkout — expired discount code shows an error",
    "template_id": 2,
    "type_id": 1,
    "priority_id": 3,
    "custom_preconds": "User has items in cart and is on the checkout page. Discount code EXPIRED10 has a past end date.",
    "custom_steps_separated": [
      { "content": "Enter EXPIRED10 in the discount code field and click Apply.",
        "expected": "An inline error reads \"This code has expired.\" The order total is unchanged." },
      { "content": "Confirm the Apply button is re-enabled.",
        "expected": "The Apply button is enabled; no discount line item is added." }
    ]
  }'
```

For bulk, loop one `add_case/{section_id}` call per case (TestRail has no native batch
create-case endpoint). Generate one case per acceptance rule, not one giant case.

`template_id: 2` is the built-in "Test Case (Steps)" template on most instances — confirm
the id via `get_templates/{project_id}` because it varies per project.

---

## Xray on Jira Cloud — two-step auth, then GraphQL

Stale-knowledge trap: the Cloud REST import path `/rest/raven/1.0/...` is the **Server/DC**
path and is the wrong call on Cloud. For Xray Cloud, authenticate first, then use the
**GraphQL** API (`/api/v2/graphql`) — Xray's own docs recommend GraphQL for integration
because it is more powerful than the REST helpers.

### Step 1 — authenticate (returns a bearer token, valid 24h)

```bash
TOKEN=$(curl -s -H "Content-Type: application/json" \
  -X POST "https://xray.cloud.getxray.app/api/v2/authenticate" \
  -d '{ "client_id": "CLIENT_ID", "client_secret": "CLIENT_SECRET" }' | tr -d '"')
```

Do NOT use Jira username/password basic auth for the Xray API — that authenticates against
Jira, not Xray. The Xray API key (client_id + client_secret) is issued in Xray Global Settings.

### Step 2a — create a Manual test via GraphQL `createTest`

```graphql
mutation {
  createTest(
    testType: { name: "Manual" }
    steps: [
      { action: "Submit the login form with a valid email and wrong password.",
        result: "An error \"Invalid credentials\" is shown; attempt counter increments by 1." }
      { action: "Repeat the wrong-password submit until 5 failed attempts.",
        result: "On the 5th failure the account is locked; message reads \"Account locked for 15 minutes.\"" }
    ]
    jira: { fields: { summary: "Login — account locks after 5 failed attempts", project: { key: "WEB" } } }
  ) { test { issueId testType { name } } warnings }
}
```

POST the query to `https://xray.cloud.getxray.app/api/v2/graphql` with
`Authorization: Bearer $TOKEN`.

### Step 2b — import a Gherkin scenario as a **Cucumber** test (not Generic)

A common mistake is importing Gherkin as a `Generic` test, which dumps it into an unparsed
definition field. Use `testType: { name: "Cucumber" }` with the `gherkin` field so Xray
parses the scenario:

```graphql
mutation {
  createTest(
    testType: { name: "Cucumber" }
    gherkin: "Scenario: Apply a valid discount code\n  Given a cart with a $100 subtotal\n  When I apply code SAVE10\n  Then the total is $90"
    jira: { fields: { summary: "Checkout — valid discount reduces total", project: { key: "WEB" } } }
  ) { test { issueId } }
}
```

For 12 cases, batch the mutations (alias multiple `createTest` calls in one document) or loop.
The REST helper `POST /api/v2/import/test/bulk` also exists for JSON-defined manual tests, but
GraphQL `createTest` is the cleaner default for mixed manual + Cucumber sets.

---

## Zephyr Scale on Jira Cloud — create case, then add steps separately

Correct base is `https://api.zephyrscale.smartbear.com/v2` with `Authorization: Bearer <JWT>`
(the API access token from Zephyr Scale settings). Common failures: emitting `/v1/`, using
the wrong host, leaking Qase's `Token` header, or trying to embed steps as a single text blob
in the create-case body. Test steps are a **separate call**: `POST /testcases/{caseKey}/teststeps`.

### Step 1 — create the test case (no steps in this body)

```bash
curl -H "Authorization: Bearer YOUR_JWT" -H "Content-Type: application/json" \
  -X POST "https://api.zephyrscale.smartbear.com/v2/testcases" \
  -d '{
    "projectKey": "WEB",
    "name": "Smoke — user can log in with valid credentials",
    "folderId": 1180,
    "priorityName": "High",
    "statusName": "Approved",
    "objective": "Verify a registered user reaches the dashboard after a valid login."
  }'
```

The response returns the new test case `key` (e.g. `WEB-T42`). Use it in step 2.
`folderId` is numeric — resolve the "Smoke" folder via `GET /folders?projectKey=WEB&folderType=TEST_CASE`.

### Step 2 — add named steps with `mode: APPEND` and `inline` items

```bash
curl -H "Authorization: Bearer YOUR_JWT" -H "Content-Type: application/json" \
  -X POST "https://api.zephyrscale.smartbear.com/v2/testcases/WEB-T42/teststeps" \
  -d '{
    "mode": "APPEND",
    "items": [
      { "inline": {
          "description": "Open /login and submit valid email + password.",
          "testData": "user: smoke@example.com / Passw0rd!",
          "expectedResult": "The dashboard loads and the user menu shows the account name." } }
    ]
  }'
```

Each step is an `inline` object with `description`, `expectedResult`, and optional `testData`.
(`testCaseKey` is an alternative to `inline` for reusing a shared test case as a step.)

---

## Qase — bulk create with the `Token` header

Auth header is `Token: <api_key>` — NOT `Authorization: Bearer`. Reaching for Bearer is the
single most common Qase mistake. Use the bulk endpoint `POST /case/{PROJECT_CODE}/bulk` with a
`cases` array instead of N single `POST /case/{CODE}` calls. Steps are structured objects with
`action`, `expected_result`, and `data` (input data).

```bash
curl -H "Token: YOUR_API_KEY" -H "Content-Type: application/json" \
  -X POST "https://api.qase.io/v1/case/CHK/bulk" \
  -d '{
    "cases": [
      { "title": "Checkout — valid discount code reduces total",
        "suite_id": 17,
        "preconditions": "Cart subtotal is $100. Code SAVE10 is active.",
        "steps": [
          { "action": "Apply code SAVE10 at checkout.",
            "expected_result": "Total drops to $90 and a discount line item appears.",
            "data": "SAVE10" } ] },
      { "title": "Checkout — expired discount code is rejected",
        "suite_id": 17,
        "steps": [
          { "action": "Apply code EXPIRED10 at checkout.",
            "expected_result": "Inline error \"This code has expired.\"; total unchanged.",
            "data": "EXPIRED10" } ] },
      { "title": "Checkout — already-used single-use code is rejected",
        "suite_id": 17,
        "steps": [
          { "action": "Apply single-use code USED10 a second time.",
            "expected_result": "Inline error \"This code has already been used.\"; total unchanged.",
            "data": "USED10" } ] }
    ]
  }'
```

`CHK` is the project code (the short code in the project URL), `suite_id` is the numeric
parent suite. One case per business rule.
