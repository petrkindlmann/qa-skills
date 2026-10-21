# curated/ manifest

Built 2026-10-21 by tools/build-curated.mjs from decisions.mjs. 66 files copied; 9 tests quarantined in place with test.skip; whole-file duplicates (campaign3/selector-drift-recovery/todomvc.spec.mjs, baseline-shop/probe.mjs) not copied.

Run from the repo root:
```
QA_WORKFLOW_SUITE=/Users/petr/projects/qa-skills/tests/workflows/generated/campaign3/test-suite-curation/curated QA_WORKFLOW_OUTPUT=<out> node node_modules/playwright/cli.js test --config tests/workflows/playwright.config.mjs --workers 2
```

| source (tests/workflows/generated/) | destination (curated/) | changes |
|---|---|---|
| baseline-shop/shop.spec.mjs | baseline-shop/shop.spec.mjs | support import ../../support/ -> ../../../../../support/ |
| baseline-shop/helpers.mjs | baseline-shop/helpers.mjs | support import ../../support/ -> ../../../../../support/ |
| baseline-todo/todomvc.spec.mjs | baseline-todo/todomvc.spec.mjs | support import ../../support/ -> ../../../../../support/; support import ../../support/ -> ../../../../../support/ |
| campaign3/selector-drift-recovery/todo-ui.mjs | baseline-todo/todo-ui.mjs | byte-identical copy |
| review-followup/shop-review.spec.mjs | review-followup/shop-review.spec.mjs | support import ../../support/ -> ../../../../../support/; support import ../../support/ -> ../../../../../support/; R-01: test.skip "logout revokes a previously valid copied session on the server" |
| review-followup/todo-review.spec.mjs | review-followup/todo-review.spec.mjs | support import ../../support/ -> ../../../../../support/; support import ../../support/ -> ../../../../../support/ |
| review-followup/helpers.mjs | review-followup/helpers.mjs | support import ../../support/ -> ../../../../../support/ |
| addons/accessibility.spec.mjs | addons/accessibility.spec.mjs | support import ../../support/ -> ../../../../../support/ |
| addons/database.spec.mjs | addons/database.spec.mjs | support import ../../support/ -> ../../../../../support/ |
| addons/performance.spec.mjs | addons/performance.spec.mjs | support import ../../support/ -> ../../../../../support/ |
| addons/security.spec.mjs | addons/security.spec.mjs | support import ../../support/ -> ../../../../../support/ |
| addons/helpers.mjs | addons/helpers.mjs | support import ../../support/ -> ../../../../../support/ |
| campaign3/analytics-tracking-testing/login-events.spec.mjs | analytics-tracking-testing/login-events.spec.mjs | support import ../../../support/ -> ../../../../../support/ |
| campaign3/analytics-tracking-testing/purchase-events.spec.mjs | analytics-tracking-testing/purchase-events.spec.mjs | support import ../../../support/ -> ../../../../../support/; support import ../../../support/ -> ../../../../../support/ |
| campaign3/analytics-tracking-testing/helpers/datalayer.mjs | analytics-tracking-testing/helpers/datalayer.mjs | byte-identical copy |
| campaign3/analytics-tracking-testing/helpers/plan.mjs | analytics-tracking-testing/helpers/plan.mjs | byte-identical copy |
| campaign3/analytics-tracking-testing/helpers/shop.mjs | analytics-tracking-testing/helpers/shop.mjs | support import ../../../../support/ -> ../../../../../../support/ |
| campaign3/analytics-tracking-testing/helpers/validate.mjs | analytics-tracking-testing/helpers/validate.mjs | byte-identical copy |
| campaign3/analytics-tracking-testing/tracking-plan.json | analytics-tracking-testing/tracking-plan.json | byte-identical copy |
| campaign3/analytics-tracking-testing/selfcheck-validator.mjs | analytics-tracking-testing/selfcheck-validator.mjs | byte-identical copy |
| campaign3/bug-reproduction/report-1-session-revocation.spec.mjs | bug-reproduction/report-1-session-revocation.spec.mjs | support import ../../../support/ -> ../../../../../support/ |
| campaign3/bug-reproduction/report-2-idempotency-conflict.spec.mjs | bug-reproduction/report-2-idempotency-conflict.spec.mjs | support import ../../../support/ -> ../../../../../support/; R-02: test.skip "reusing an Idempotency-Key with a different quantity returns 409 and creates no order"; R-03: test.skip "keys are scoped to the signed-in user, so a conflict is not a global lock on the key" |
| campaign3/bug-reproduction/helpers.mjs | bug-reproduction/helpers.mjs | support import ../../../support/ -> ../../../../../support/ |
| campaign3/bug-reproduction/oracle-sensitivity.mjs | bug-reproduction/oracle-sensitivity.mjs | byte-identical copy |
| campaign3/service-virtualization/stub-fidelity.spec.mjs | service-virtualization/stub-fidelity.spec.mjs | support import ../../../support/ -> ../../../../../support/; support import ../../../support/ -> ../../../../../support/ |
| campaign3/service-virtualization/virtualized-ui.spec.mjs | service-virtualization/virtualized-ui.spec.mjs | support import ../../../support/ -> ../../../../../support/ |
| campaign3/service-virtualization/cassette.mjs | service-virtualization/cassette.mjs | byte-identical copy |
| campaign3/service-virtualization/scenario.mjs | service-virtualization/scenario.mjs | byte-identical copy |
| campaign3/service-virtualization/virtual-api.mjs | service-virtualization/virtual-api.mjs | byte-identical copy |
| campaign3/service-virtualization/record.mjs | service-virtualization/record.mjs | support import ../../../support/ -> ../../../../../support/ |
| campaign3/service-virtualization/recordings/catalog.json | service-virtualization/recordings/catalog.json | byte-identical copy |
| campaign3/service-virtualization/recordings/health.json | service-virtualization/recordings/health.json | byte-identical copy |
| campaign3/service-virtualization/recordings/login-invalid.json | service-virtualization/recordings/login-invalid.json | byte-identical copy |
| campaign3/service-virtualization/recordings/login-ok.json | service-virtualization/recordings/login-ok.json | byte-identical copy |
| campaign3/service-virtualization/recordings/login-throttled.json | service-virtualization/recordings/login-throttled.json | byte-identical copy |
| campaign3/service-virtualization/recordings/logout.json | service-virtualization/recordings/logout.json | byte-identical copy |
| campaign3/service-virtualization/recordings/me-authenticated.json | service-virtualization/recordings/me-authenticated.json | byte-identical copy |
| campaign3/service-virtualization/recordings/me-unauthenticated.json | service-virtualization/recordings/me-unauthenticated.json | byte-identical copy |
| campaign3/service-virtualization/recordings/orders-create-conflict.json | service-virtualization/recordings/orders-create-conflict.json | byte-identical copy |
| campaign3/service-virtualization/recordings/orders-create-invalid.json | service-virtualization/recordings/orders-create-invalid.json | byte-identical copy |
| campaign3/service-virtualization/recordings/orders-create-replayed.json | service-virtualization/recordings/orders-create-replayed.json | byte-identical copy |
| campaign3/service-virtualization/recordings/orders-create.json | service-virtualization/recordings/orders-create.json | byte-identical copy |
| campaign3/service-virtualization/recordings/orders-get-unknown.json | service-virtualization/recordings/orders-get-unknown.json | byte-identical copy |
| campaign3/service-virtualization/recordings/orders-get.json | service-virtualization/recordings/orders-get.json | byte-identical copy |
| campaign3/service-virtualization/recordings/orders-list.json | service-virtualization/recordings/orders-list.json | byte-identical copy |
| campaign3/synthetic-monitoring/health.probe.spec.mjs | synthetic-monitoring/health.probe.spec.mjs | support import ../../../support/ -> ../../../../../support/ |
| campaign3/synthetic-monitoring/order-journey.probe.spec.mjs | synthetic-monitoring/order-journey.probe.spec.mjs | support import ../../../support/ -> ../../../../../support/ |
| campaign3/synthetic-monitoring/password-reset-email.probe.spec.mjs | synthetic-monitoring/password-reset-email.probe.spec.mjs | support import ../../../support/ -> ../../../../../support/ |
| campaign3/synthetic-monitoring/sign-in.probe.spec.mjs | synthetic-monitoring/sign-in.probe.spec.mjs | support import ../../../support/ -> ../../../../../support/ |
| campaign3/synthetic-monitoring/storefront.probe.spec.mjs | synthetic-monitoring/storefront.probe.spec.mjs | support import ../../../support/ -> ../../../../../support/ |
| campaign3/synthetic-monitoring/probe-support.mjs | synthetic-monitoring/probe-support.mjs | support import ../../../support/ -> ../../../../../support/; support import ../../../support/ -> ../../../../../support/ |
| campaign3/synthetic-monitoring/probes.mjs | synthetic-monitoring/probes.mjs | support import ../../../support/ -> ../../../../../support/; support import ../../../support/ -> ../../../../../support/ |
| campaign3/test-migration/todomvc.spec.mjs | test-migration/todomvc.spec.mjs | support import ../../../support/ -> ../../../../../support/; support import ../../../support/ -> ../../../../../support/; R-13: test.skip "duplicate titles remain independent through complete, edit and delete"; R-14: test.skip "filters visibly select the correct subset"; R-15: test.skip "Enter saves an edit and Escape preserves the saved title"; R-16: test.skip "items and their completion persist through reload"; R-17: test.skip "a deleted item stays deleted after reload"; R-18: test.skip "mark-all completes and restores every item" |
| campaign3/test-migration/todo-page.mjs | test-migration/todo-page.mjs | support import ../../../support/ -> ../../../../../support/ |
| campaign3/visual-testing/todomvc-visual.spec.mjs | visual-testing/todomvc-visual.spec.mjs | support import ../../../support/ -> ../../../../../support/; support import ../../../support/ -> ../../../../../support/ |
| campaign3/visual-testing/visual-helpers.mjs | visual-testing/visual-helpers.mjs | support import ../../../support/ -> ../../../../../support/ |
| campaign3/visual-testing/screenshot.css | visual-testing/screenshot.css | byte-identical copy |
| campaign3/visual-testing/todomvc-visual.spec.mjs-snapshots/all-completed-darwin.png | visual-testing/todomvc-visual.spec.mjs-snapshots/all-completed-darwin.png | byte-identical copy |
| campaign3/visual-testing/todomvc-visual.spec.mjs-snapshots/editing-in-progress-darwin.png | visual-testing/todomvc-visual.spec.mjs-snapshots/editing-in-progress-darwin.png | byte-identical copy |
| campaign3/visual-testing/todomvc-visual.spec.mjs-snapshots/empty-state-darwin.png | visual-testing/todomvc-visual.spec.mjs-snapshots/empty-state-darwin.png | byte-identical copy |
| campaign3/visual-testing/todomvc-visual.spec.mjs-snapshots/filter-active-darwin.png | visual-testing/todomvc-visual.spec.mjs-snapshots/filter-active-darwin.png | byte-identical copy |
| campaign3/visual-testing/todomvc-visual.spec.mjs-snapshots/filter-all-darwin.png | visual-testing/todomvc-visual.spec.mjs-snapshots/filter-all-darwin.png | byte-identical copy |
| campaign3/visual-testing/todomvc-visual.spec.mjs-snapshots/filter-completed-darwin.png | visual-testing/todomvc-visual.spec.mjs-snapshots/filter-completed-darwin.png | byte-identical copy |
| campaign3/visual-testing/todomvc-visual.spec.mjs-snapshots/mixed-mobile-darwin.png | visual-testing/todomvc-visual.spec.mjs-snapshots/mixed-mobile-darwin.png | byte-identical copy |
| campaign3/visual-testing/todomvc-visual.spec.mjs-snapshots/row-hover-darwin.png | visual-testing/todomvc-visual.spec.mjs-snapshots/row-hover-darwin.png | byte-identical copy |
| campaign3/visual-testing/todomvc-visual.spec.mjs-snapshots/several-active-darwin.png | visual-testing/todomvc-visual.spec.mjs-snapshots/several-active-darwin.png | byte-identical copy |
