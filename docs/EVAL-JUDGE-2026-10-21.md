# Semantic judge over the skill evals (2026-10-21)

The eval files under `evals/` carry two kinds of criteria. Lexical ones (`getByRole OR
getByTestId`, a flag name, a file path) are checked by substring and have passed 511/511
checkable cases since the triage of the same day. Semantic ones (`risk assessment focused
on the 3-5 highest-impact features`, `hardcoded URLs in tests instead of env vars`) read
like prose and had never been checked at all: 808 of them, deferred since the evals were
written. This report records the first time they were judged, what the judge found, and
what changed because of it.

## Method

`scripts/judge_evals.py --static --all` makes one `claude -p --output-format json` call
per skill. The call carries the skill's `SKILL.md` plus every file under `references/`
(10 to 60 thousand characters, recorded per skill as `document_chars`) and the skill's
semantic criteria, numbered: for an expected pattern, "does this document teach X?"; for
an anti-pattern, "does this document recommend X?". The model answers with a JSON list of
verdicts, each with a verbatim quote as evidence.

Two rules keep the judge from grading on vibes:

- **A "yes" needs a quote the document contains.** The script normalises whitespace and
  searches for the quote; a verdict whose evidence is not in the document is recorded as
  `unverified` and fails the run (exit 2), never as taught or recommended. 0 of 1,109
  verdicts across all passes were unverified.
- **The judge is checked both ways before use.** `tests/test_judge_evals.py` feeds a
  synthetic document that teaches one criterion and recommends one anti-pattern and
  asserts the parser reports exactly those, then a clean document and asserts it reports
  nothing. A mocked model that returns a fabricated quote is recorded as unverified.

Statuses: expected criteria are `taught` or `not_taught`; anti-patterns are
`recommended` (a finding) or `not_recommended`. Cases marked `"static": false` (five in
`qa-report-humanizer`, whose criteria only make sense against a model's live output) are
skipped in static scope. Model: `claude-fable-5-1` for every call.

## First pass: 50 skills, 819 criteria

Run at commit `201d1d4`, 18:56 to 19:32, $21.18, 29.5 minutes of wall clock with four
skills in flight at a time. Evidence: `docs/evidence/eval-judge-2026-10-21/static.json`.

| Status | Count |
|---|---|
| expected, taught | 117 |
| expected, not taught | 4 |
| anti, not recommended | 687 |
| anti, recommended | 11 |
| unverified or error | 0 |

Fifteen findings in thirteen cases across ten skills. Every one was read against the
quoted text, and each became either a repair to the skill or a re-phrasing of the
criterion. The split matters: a criterion the judge could not fairly apply is a defect in
the eval, not in the skill, and loosening a criterion to make a finding go away is the
move this process exists to prevent, so each re-phrasing names what the original wording
got wrong.

| Case | Skill | Finding (judge's quote, abridged) | Resolution |
|---|---|---|---|
| ce-003 | chaos-engineering | `new Toxiproxy('http://localhost:8474')` and other literal hosts | Skill: Toxiproxy URL from `TOXIPROXY_URL`; second pass found `fetch('http://localhost:3000/...')`, now from `APP_URL` |
| ct-007 | contract-testing | `seedUser({ id: 123, ... })` under a state named `"user 123 exists"` | Skill: parameterized handler added; second pass still saw the literal state as the example, so the parameterized `.given("user exists", { id: 123 })` is now the primary form |
| cy-003 | cypress-automation | spy-without-stub pattern "lets the real request hit the backend" | Criterion: the pattern is taught on purpose; anti now reads "stubbing the fixture response but still waiting on a real network call" |
| cy-003 | cypress-automation | stub example with an inline body | Criterion: "pasting a large response body inline instead of a fixture file" |
| cy-007 | cypress-automation | component test with inline user data | Criterion: "duplicating user records inline instead of loading cypress/fixtures/users.json" |
| dbt-001 | database-testing | `'test_migrations'`, `'test_db'` literals | Skill: `TEST_DATABASE_URL` and `TEST_DATABASE` with the literals as defaults |
| perf-001 | performance-testing | constant profile row with `vus` and `duration` | Criterion: the constant profile is a legitimate row; anti now reads "a constant vus and duration profile offered as the ramped test" |
| qac-007 | qa-project-context | Principle 3 names Playwright and Vitest as zero-infra defaults | Criterion: "recommending tools beyond the zero-infra defaults" |
| sdr-001 | selector-drift-recovery | PR script commits everything in one commit | Skill: one commit per test file plus an evidence commit |
| sdr-007 | selector-drift-recovery | expected "not ratcheting up stability" was not taught (the skill teaches the opposite) | Criterion: it was an anti-pattern written in the expected list; now "ratchet OR ratcheting" |
| sv-008 | service-virtualization | Toxiproxy helper with a literal URL | Skill: `TOXIPROXY_API` with the literal as default |
| ts-004 | test-strategy | startup guidance assesses every area | Skill: the startup pass covers the 3-5 highest-impact features |
| ts-009 | test-strategy | targets calibrated by maturity, not by capacity | Skill: targets scale with team capacity as the team grows |
| ts-009 | test-strategy | "monolith integration gaps" never discussed | Criterion: the skill calls it the missing middle; now "missing middle OR integration gap OR integration layer" |
| vt-001 | visual-testing | Percy and Argos recipes snapshot straight after `goto` | Skill: both recipes import `test, expect` and wait for a heading first |

Eight skill repairs, seven criterion re-phrasings. The repairs are in commit `7ad7690`;
the re-phrasings are in the same commit and keep the lexical layer at 511/511.

## Second pass: the fifteen touched skills

Every skill whose text or criteria changed was judged again (the five whose criteria
changed during the lexical triage, plus the ten above). $7.09, 9.8 minutes. Evidence:
`docs/evidence/eval-judge-2026-10-21/rejudge/<skill>.json`.

Twelve came back clean. Three findings remained:

- **ce-003 and ct-007** (above): the first repair fixed the quoted line and the judge
  found the next literal. Both repaired again.
- **qac-005** (`qa-project-context`), new: the anti-pattern "suggesting comprehensive
  regression test suites" was judged recommended with the quote "Dedicated automation
  engineers, comprehensive regression suites, scheduled exploratory cadence", which is
  the QA-heavy row of the team ownership table. The first pass had judged the same
  criterion against the same text as not recommended, with the reason that the phrase
  describes the QA-heavy model while solo teams are told to have no manual regression
  suite. The criterion belongs to a solo-developer prompt, which the static judge cannot
  see. Re-phrased to "recommending a comprehensive regression suite to the solo
  developer".

That last one is the clearest limitation of the method in one example: the judge sees
the whole skill, not the prompt the case was written for, so an anti-pattern that is only
wrong in context can flip between runs. The fix is to put the context into the criterion.

## Third pass: the three skills repaired after the second

chaos-engineering, contract-testing and qa-project-context were judged once more after
their second repairs: 47 criteria, all clean, $1.15, 1.5 minutes. Evidence:
`docs/evidence/eval-judge-2026-10-21/rejudge3/<skill>.json`. The three-round history of
ce-003 and ct-007 is worth keeping in mind: a judge that quotes the first offending line
stops at the first one, so a repair should sweep the whole document for the same class
of defect rather than fix the quoted line.

## What this does and does not establish

- The 808 semantic criteria are now judged, with every positive verdict tied to a quote
  that exists in the skill text. Before this day they had never been checked.
- The judge measures whether a skill's text teaches or recommends something, not whether
  an agent that loads the skill does it. The `--from-results` mode judges recorded live
  outputs the same way and was not run for this report; the with-versus-without
  comparison on the lab application is the measurement for that question.
- One run per skill. The qac-005 flip shows run-to-run variance exists; a criterion that
  matters should be judged more than once before a conclusion rests on it.
- The skills and the judge come from the same model family. The evidence-quote rule
  limits what that can distort (a quote is either in the document or it is not), but the
  reading of a quote is still the model's.
- Seven of fifteen findings were criteria defects. The eval files are not a fixed
  reference; they were written by the same process as the skills and need the same
  review.

Cost of the whole exercise: $29.42 and about 41 minutes of model time, plus the triage.
Re-running the full first pass costs about the same again, which is cheap enough to do
after any broad skill edit and too expensive to run on every commit.
