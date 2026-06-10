# QA Metrics Dashboards

Different stakeholders need different views of the same underlying data. Build the
view for the audience, not the data warehouse.

## Engineering Dashboard (Daily View)

Lives where engineers already look — in CI, Slack, or the team wiki.

**Include:**
- CI pass rate (today and 7-day trend)
- Top 5 flaky tests with failure count
- Test suite duration by stage (unit, integration, E2E)
- Coverage delta on latest PR (increased/decreased)
- Skipped test count
- Number of quarantined tests awaiting fix

**Exclude:** Business-level metrics, ROI calculations, historical trend analysis beyond 30 days.

**Refresh cadence:** Real-time or per-build.

These are mostly leading indicators — they predict escapes before they happen, which
is why engineers act on them daily.

## Leadership Dashboard (Monthly View)

Answers: "Is quality improving, stable, or declining?"

**Include:**
- Defect escape rate trend (3-6 month view)
- MTTR by severity (monthly average)
- Quality gate pass rate (% of releases that passed all quality gates)
- Automation ROI (cumulative savings)
- Severity distribution trend
- Release confidence score (composite metric, see below)
- DORA metrics if leadership tracks delivery throughput alongside quality (see SKILL.md)

**Exclude:** Individual test names, CI runner details, code-level coverage numbers.

**Refresh cadence:** Monthly or per-release.

These are mostly lagging indicators — you learn after users were (or weren't) hurt,
which is the right altitude for a monthly leadership review.

### Release confidence score (example weighting, not a standard)

```
Release confidence = (0.3 × pass_rate) + (0.3 × (100 - defect_escape_rate))
                   + (0.2 × coverage_score) + (0.2 × (100 - flakiness_rate))
```

Each component is normalized to 0-100 (`coverage_score` = your coverage % capped at
100). This is a *starter* composite, not a canonical formula — pass rate and flakiness
are correlated, so this weighting double-counts test health somewhat. Tune the weights
to what your team actually cares about and treat the absolute number as a trend line,
not a grade. Document whatever weighting you pick so the number stays comparable
month over month.

## Sprint Health Dashboard (Per-Sprint View)

Supports sprint retrospectives and planning.

**Include:**
- Tests added vs. features shipped (ratio)
- Bugs found in sprint vs. bugs escaped to production
- Flakiness rate change during the sprint
- Coverage change during the sprint
- Test debt items created vs. resolved

**Refresh cadence:** Updated at sprint boundaries.

Wire this into the retro template directly so the data drives the discussion instead
of opinions.
