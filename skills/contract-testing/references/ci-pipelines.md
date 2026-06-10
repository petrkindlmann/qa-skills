# Contract Testing CI Pipelines — Code

GitHub Actions workflows for consumer and provider contract verification, plus the `can-i-deploy` deployment gate. The workflow narrative lives in `SKILL.md`; this file holds the YAML and commands.

## Consumer CI Pipeline

```yaml
# .github/workflows/consumer-contract.yml
name: Consumer Contract Tests
on: [push]

jobs:
  contract-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci

      - name: Run consumer contract tests
        run: npm run test:contract

      - name: Publish pacts to broker
        if: github.ref == 'refs/heads/main' || github.event_name == 'pull_request'
        env:
          PACT_BROKER_BASE_URL: ${{ secrets.PACT_BROKER_URL }}
          PACT_BROKER_TOKEN: ${{ secrets.PACT_BROKER_TOKEN }}
        run: |
          npx pact-broker publish ./pacts \
            --consumer-app-version="${{ github.sha }}" \
            --branch="${{ github.head_ref || github.ref_name }}"

      - name: Can I deploy?
        if: github.ref == 'refs/heads/main'
        env:
          PACT_BROKER_BASE_URL: ${{ secrets.PACT_BROKER_URL }}
          PACT_BROKER_TOKEN: ${{ secrets.PACT_BROKER_TOKEN }}
        run: |
          npx pact-broker can-i-deploy \
            --pacticipant="frontend-app" \
            --version="${{ github.sha }}" \
            --to-environment=production \
            --retry-while-unknown=6 \
            --retry-interval=10
```

The `--retry-while-unknown` / `--retry-interval` flags poll the broker while results are still "unknown" — they fix the most common real-world `can-i-deploy` failure: the consumer just published a pact and the provider hasn't finished verifying it yet, so without retries the gate hard-fails on a race instead of waiting for the verification to land.

## Provider CI Pipeline

```yaml
# .github/workflows/provider-contract.yml
name: Provider Contract Verification
on:
  push:
  repository_dispatch:
    types: [pact-changed]  # Triggered by Pact Broker webhook

jobs:
  verify-contracts:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17-alpine
        env: { POSTGRES_DB: testdb, POSTGRES_USER: test, POSTGRES_PASSWORD: test }
        ports: ['5432:5432']
        options: >-
          --health-cmd="pg_isready -U test"
          --health-interval=5s
          --health-timeout=3s
          --health-retries=5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run db:migrate

      - name: Verify provider contracts
        env:
          TEST_DATABASE_URL: postgres://test:test@localhost:5432/testdb
          GIT_COMMIT: ${{ github.sha }}
          GIT_BRANCH: ${{ github.head_ref || github.ref_name }}
          PACT_BROKER_BASE_URL: ${{ secrets.PACT_BROKER_URL }}
          PACT_BROKER_TOKEN: ${{ secrets.PACT_BROKER_TOKEN }}
        run: npm run test:contract:provider

      - name: Can I deploy?
        if: github.ref == 'refs/heads/main'
        env:
          PACT_BROKER_BASE_URL: ${{ secrets.PACT_BROKER_URL }}
          PACT_BROKER_TOKEN: ${{ secrets.PACT_BROKER_TOKEN }}
        run: |
          npx pact-broker can-i-deploy \
            --pacticipant="user-service" \
            --version="${{ github.sha }}" \
            --to-environment=production \
            --retry-while-unknown=6 \
            --retry-interval=10
```

The gate is on `main` deliberately, and you must **never** skip it there: `main` is what reaches production. A skipped `can-i-deploy` on a feature branch costs nothing, but skipping it on `main` ships a version the broker has not confirmed is compatible — which is the exact production break contract testing exists to prevent.

## can-i-deploy

The `can-i-deploy` command is the deployment gate. It checks the Pact Broker matrix to determine if a version is safe to deploy.

```bash
# Check if consumer can be deployed to production.
# --retry-while-unknown waits out the race where provider verification
# of the just-published pact hasn't landed yet.
npx pact-broker can-i-deploy \
  --pacticipant="frontend-app" \
  --version="abc123" \
  --to-environment=production \
  --retry-while-unknown=6 \
  --retry-interval=10

# Output:
# CONSUMER        | C.VERSION | PROVIDER     | P.VERSION | SUCCESS?
# frontend-app    | abc123    | user-service | def456    | true
# frontend-app    | abc123    | order-service| ghi789    | true
#
# All required verification results are published and successful.
# Computer says yes \o/

# Record deployment after successful deploy
npx pact-broker record-deployment \
  --pacticipant="frontend-app" \
  --version="abc123" \
  --environment=production
```

**Never deploy without a passing `can-i-deploy` check.** This is the entire point of contract testing.
