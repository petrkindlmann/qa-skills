# Deletion-persistence fixture evidence

Evaluator-only controlled probes. These results establish the fixture behavior; they are not fresh-agent suite results.

Repository HEAD observed before this change: `e876dcfd6194066d1d697aea9ca6d7e08d2ce123`; the tested working tree adds the fault and probe. Exact tested evaluator-file SHA-256 values are in `delete-persistence-results.json`.

Runtime: Playwright 1.62.1; Chrome 156.0.8078.47; Node v24.19.0.

```bash
QA_BROWSER_EXECUTABLE=/tmp/qa-skills-chrome/opt/google/chrome/chrome node tests/workflows/upstream-todomvc/faults/probe-delete-persistence.mjs
```

| UI operation | Variant | Next write before reload | Observed after reload |
| --- | --- | --- | --- |
| single-delete | none | None | Keep active |
| single-delete | delete-persistence-lost | None | Keep active; Remove first |
| single-delete | delete-persistence-lost | Add unrelated todo | Keep active; Unrelated later write |
| clear-completed | none | None | Keep active |
| clear-completed | delete-persistence-lost | None | Keep active; Remove first; Remove second |
| clear-completed | delete-persistence-lost | Add unrelated todo | Keep active; Unrelated later write |

All six controlled outcomes matched expectations. Both healthy immediate-reload checks retained the deletion. Both faulty immediate-reload checks restored removed rows, violating deletion persistence. An unrelated later add persisted the pending deletions and masked the fault in both workflows. Every run first observed the removed rows absent from the UI.

There were zero external requests and zero JavaScript page errors. Source inspection confirms Clear completed calls the same Store.remove operation as single-item deletion.

The 19 original upstream/dependency files matched their recorded hashes. All 95 file outputs across the healthy variant and four existing faults matched the pre-change fingerprints; details are retained in `delete-persistence-preservation.json`. Existing server logic and original source bytes were not edited.

Raw records: `delete-persistence-results.json`; stdout: `delete-persistence-probe.log`.
