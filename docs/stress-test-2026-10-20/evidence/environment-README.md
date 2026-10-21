# Environment and coverage-context repair evidence

The four assigned skill/reference files were repaired, with metadata versions test-environments 2.1 and test-suite-curation 1.1. No commit or push was made.

## Executed results

- Before: 11 environment tests produced 9 failure records (one test has two failing subcases); three lifecycle cases passed. All 5 coverage extractor checks failed against the old extractor.
- After: 11 environment tests and 5 coverage extractor tests passed. The initial default-sandbox environment run passed 9 checks and hit socket permission errors in the 2 HTTP healthcheck fixtures; the approved rerun passed all 11. Both logs are retained.
- The environment checks execute the actual Markdown Bash fence with controlled docker/npx stubs, parse the actual Compose YAML fence, and execute the actual Node healthcheck JavaScript against local HTTP 200 and 503 responses.
- The coverage checks execute the actual Python Markdown fence against synthetic CoverageData API records and verify phase union, separate parameter IDs (including an embedded pipe), exclusion of unattributed contexts, query reset, and per-test unique-line counting.
- Scoped git diff --check passed before evidence capture.

## Limits

Docker is unavailable, so no docker compose config, image build, Postgres startup, or container-network runtime was verified. pytest and coverage.py are unavailable, so the context distinction was checked against their official documentation and aggregation was tested using controlled API records. HTTP healthchecks ran outside a container on Node v24.19.0.

## Files

manifest.json records source URLs, tool versions, HEAD, file hashes, and recovery details. before/ and after/ hold snapshots; changes.patch contains the four skill/reference changes and the two regression files. results.json indexes the before/after logs and the successful local-socket rerun. Prior /tmp evidence was lost during the workspace outage; the fresh before/after captures and test runs were performed on 2026-10-21.
