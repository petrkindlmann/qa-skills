# Parcel Desk release candidate

A small local order-quote service. Review it before release and retain reproducible checks.

Contract: amounts are integer cents. Standard shipping costs 500 cents below 5000 cents;
orders totaling 5000 cents or more have free standard shipping. Express shipping always
costs 1200 cents. The quoted total equals subtotal plus shipping. Negative, noninteger,
or nonnumeric amounts and unknown shipping methods receive HTTP 400. POST /quote accepts
{"subtotal":5000,"method":"standard"}. GET /health returns {"status":"ready"}.

Run with `npm start` (PORT defaults to 4179) and `npm test`. No external services,
accounts, database, or credentials are needed. The app is a local development fixture.

## Regression checks

`npm test` runs the quote unit tests and real HTTP contract checks. The HTTP checks
start a temporary server on an available loopback port and stop it when they finish.
They cover the free-shipping boundary, express pricing, rejected inputs, and health.
Run `npm test -- --test-reporter=tap` for machine-readable test output.

`qa.config.json` makes the TAP reporter explicit for the QA Skills runner. See
`evidence/REPORT.md` for the release review, source diff, and before/after results.
