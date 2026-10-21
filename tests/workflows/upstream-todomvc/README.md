# Pinned public TodoMVC application

This fixture serves the original vanilla JavaScript TodoMVC application from
[tastejs/todomvc](https://github.com/tastejs/todomvc/tree/25a9e31eb32db752d959df18e4d214295a2875e8/examples/vanillajs),
commit `25a9e31eb32db752d959df18e4d214295a2875e8`. Original files in `upstream/` and
published dependency assets in `vendor/` are unmodified. `provenance.json` records
each URL and SHA-256, package tarball integrity and exact dependency versions.

```bash
node tests/workflows/upstream-todomvc/server.mjs --port 0 --ready-file /tmp/todo-ready.json
```

Read `base_url` from the readiness file. The server binds only to `127.0.0.1` and
verifies original bytes before listening. The browser makes real local HTTP requests;
no Playwright request-fulfillment adapter replaces the application.

The optional framework-information sidebar receives HTTP 204 for `learn.json` to
avoid its online issue-count lookup. A response content policy prohibits outbound
connections. This hosting policy leaves the todo code unchanged and is disclosed in
the black-box contract. External author/project links are outside the workflow.

## Attribution and licenses

- TodoMVC: [upstream MIT license](upstream/license.md); the page retains author credits.
- `todomvc-common` 1.0.5: [MIT license](vendor/todomvc-common/1.0.5/license),
  [published README](vendor/todomvc-common/1.0.5/readme.md).
- `todomvc-app-css` 2.4.1: [Creative Commons Attribution 4.0 license](vendor/todomvc-app-css/2.4.1/license),
  [published README and credits](vendor/todomvc-app-css/2.4.1/readme.md).

The CSS is credited to the TodoMVC authors, including Sindre Sorhus as named in its
published package. The original assets have not been altered. Their respective
licenses apply in place of this repository's general code license.

## Evaluator-only material

Do not include `faults/`, fixture probes or expected outputs in fresh-agent workspaces.
The application contract and served healthy application are sufficient for test authoring.
`--fault` changes served JavaScript bytes in memory, leaving original files intact.
Each transformation requires one exact source match and fails if the source drifts.

The current upstream ES5 distribution at `ff43b02e59dfa604386bb382034b2cd07c2bcd8a`
uses in-memory storage. Its original files and provenance are retained under
`observations/`. Loss on reload is an observed property of that revision, not asserted
to be an upstream defect. The historical persistent revision is used deliberately
for the persistence requirements of this benchmark.
