# Filler-phrase blocklist

Copy-paste blocklist of AI-tell phrases that should not survive a QA-report rewrite.
The Verification grep in `SKILL.md` points at this list. If any of these appears in the
rewritten output, it failed.

## Banned filler phrases

```
It is worth noting that
It's worth noting
Moving forward
In conclusion
Despite challenges
Despite several challenges
The team is committed to
The team is aligned
Stakeholders can feel confident
This underscores the importance
underscoring the need
demonstrating significant improvement
showcasing the team's commitment
continued vigilance
proactive testing
mitigate potential issues
potential impact
could potentially
high-risk areas
continuous improvement
enhanced test coverage
comprehensive regression testing
across multiple touchpoints
trend positively
high-quality release
strong collaboration
technical excellence
customer focus
```

## Grep-ready regex (case-insensitive)

Use this as the pattern file for the Verification step. One alternation, anchored on
the most damaging tells:

```
it('?s)? worth noting|moving forward|in conclusion|despite (several )?challenges|the team is (committed|aligned)|stakeholders can feel confident|underscor(es|ing)|demonstrating significant|showcasing the team|continued vigilance|proactive testing|mitigate potential|potential(ly)? impact|high-risk areas|continuous improvement|enhanced test coverage|comprehensive regression|across multiple touchpoints|trend(s|ing)? positively|high-quality release|strong collaboration|technical excellence|customer focus
```

## Synonym-cycling tells (test-result rewording)

When the same outcome is restated four ways, these are the giveaway verbs. One outcome
gets one verb.

```
passed successfully
completed without issues
returned positive results
executed as expected
```

## Passive-voice "who broke it" dodges

Passive constructions used to avoid naming what broke. Rewrite to active voice with a
subject.

```
an issue was identified
a defect was discovered
was discovered that impacts
a defect was identified
```
