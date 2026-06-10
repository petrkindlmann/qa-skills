# Ambiguous-Step Linting

A step is **lintable-bad** when its expected result is not deterministically checkable —
neither a machine nor a second human could agree on pass/fail without guessing. Your job
when asked to "lint" a suite is to FLAG these, not rubber-stamp them. The default failure
mode of an agreeable agent is to say the steps "look fine" or lightly reword them while
leaving the non-verifiable expecteds in place. Do not do that.

## The rule

> Every expected result must name a specific, observable post-condition: an exact value,
> a named UI element and its state, a specific message string, an HTTP status, a count, or
> a time-bounded condition. "Works", "looks right", "is fine", and "wait a bit" are not
> observable post-conditions.

## Lint checklist — flag a step if any is true

| Smell | Why it fails | Fix shape |
|-------|--------------|-----------|
| Vague verb in action ("click around", "test the X", "play with") | Not reproducible; two testers do different things | Name the exact element + action |
| Vague data ("some data", "a value", "stuff") | Not repeatable; outcome depends on what was entered | Give concrete test data |
| Non-observable expected ("everything works", "it looks right", "is fine", "no problems") | No agreed pass/fail | Name the exact observable result |
| Unbounded wait ("wait a bit", "after a while") | Flaky and non-deterministic | Bound it: "within 10 s" or "until the spinner disappears and a row appears" |
| Multiple assertions crammed in one step | Failure is ambiguous about which assertion broke | Split into one assertion per step |
| Expected restates the action ("Click Save" → "Save is clicked") | Verifies nothing | State the post-condition the click causes |

## Worked example — the four classic bad steps, rewritten

Input suite (all four are non-deterministic and must be flagged):

```
1) Open the app.            Expected: app opens.
2) Click around the dashboard. Expected: everything works.
3) Enter some data.         Expected: it looks right.
4) Wait a bit.              Expected: the report is ready.
```

Lint result — every step flagged, then rewritten:

```
1) FLAGGED — "app opens" is borderline; make the post-condition observable.
   Rewrite: Action: Navigate to https://app.example.com/.
            Expected: The login screen renders with email + password fields and a "Log in" button.

2) FLAGGED — "click around" is non-reproducible; "everything works" is non-verifiable.
   Rewrite (split into discrete cases): Action: Click the "Reports" tab in the left nav.
            Expected: The Reports list view loads and shows the "New report" button.

3) FLAGGED — "some data" is not concrete; "it looks right" is not checkable.
   Rewrite: Action: Enter "Q2 Revenue" in Title and "2026-04-01" in Start date, then click Save.
            Expected: A success toast "Report saved" appears and the row "Q2 Revenue" is listed.

4) FLAGGED — "wait a bit" is an unbounded wait; "ready" is not bound to a signal.
   Rewrite: Action: Wait until the generation spinner disappears (max 30 s).
            Expected: The status badge reads "Ready" and a Download button is enabled.
```

Report the counts: e.g. "4 of 4 steps flagged as ambiguous / non-deterministic; all rewritten
with explicit selectors, concrete data, observable expected results, and bounded waits." Never
return "no issues found" for a suite that contains any of the smells above.

## Lint output format (when linting a real suite)

Produce a table: `Step # | Smell(s) | Original expected | Rewritten action | Rewritten expected`,
followed by the rewritten suite ready to paste back. If a step is already deterministic, say so
explicitly — but justify it against the checklist rather than waving it through.
