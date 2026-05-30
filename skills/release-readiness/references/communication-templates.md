# Release & Rollback Communication Templates

Fill-in-the-blank templates for release and rollback announcements. When to send each and the rollback-decision prose live in `SKILL.md`.

## Release Communication Template

```
Subject: [Release] v{version} — {date}

Status: DEPLOYING / DEPLOYED / ROLLED BACK

Changes:
- {Summary of changes, 3-5 bullet points}

Risk Level: LOW / MEDIUM / HIGH
Rollback Plan: {Revert deploy / Disable feature flag / etc.}
On-Call: {Name, contact}

Monitoring Dashboard: {link}
Release Notes: {link}
```

## Rollback Communication Template

```
Subject: [Rollback] v{version} — {date} {time}

Status: ROLLED BACK

Reason: {Brief description of the issue}
Impact: {Who was affected, for how long}
Current State: Running previous version v{prev_version}

Next Steps:
- Root cause investigation: {owner}
- Fix ETA: {estimate or "investigating"}
- Re-release plan: {TBD after investigation}
```
