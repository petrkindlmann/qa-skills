# Three videos to lead with

Use captured local behavior and retained evidence. Label demonstration applications as
fixtures. A controlled defect comparison establishes sensitivity to that defect; it
does not prove that every application or every bug is covered.

## 1. A passing suite misses the free-shipping boundary

**Hook:** "Three tests passed. This order still charged the wrong amount."

**Audience:** developers and founders who need a useful QA step after a code change.
**Length:** 25–35 seconds. This is the strongest demonstration of the new host workflow.

| Time | Picture | Point |
|---|---|---|
| 0–4 s | Parcel Desk's original suite: 3 passed | Existing tests can leave a behavior gap |
| 4–10 s | Real `POST /quote`, subtotal 5000; shipping 500 | Requirements promise free shipping at this boundary |
| 10–17 s | New regression fails; the code changes `>` to `>=` | The agent reproduces before repairing |
| 17–24 s | Same suite: 49 passed; show the HTML report | Tests, HTTP evidence, and the repair agree |
| 24–30 s | Brief temporary-revert failure, then restored pass | The new assertion detects the original defect |

Suggested task on screen: "Check this app against its requirements, repair reproducible
defects, and leave a report." The actual fresh task is retained with the field-use evidence.

Keep the claim precise: one fresh agent task completed on an API fixture, with 23 unit
and 26 real HTTP cases. The agent used the skills; the local CLI ran checks and produced
reports. There was one application defect, detected by three related assertions.

## 2. The session still works after logout

**Hook:** "The browser signed out. What happens to a copied session?"

**Audience:** app developers, QA engineers, and security-conscious product teams.
**Length:** 20–30 seconds.

| Time | Picture | Point |
|---|---|---|
| 0–5 s | Sign in, copy the session into an independent client | Preserve the exact old credential |
| 5–10 s | Click logout; ordinary browser request receives 401 | The visible logout path appears correct |
| 10–18 s | Independent client replays the old session and receives 200 | The server failed to revoke it |
| 18–25 s | Regression fails on broken fixture, passes on healthy control | The test checks the server-side invariant |

Use the existing `shop-logout` matrix variant and retained independent audit task. If the
recording only switches the fixture fault off, label the second run "healthy control";
do not call that an agent source-code repair. Show one request and assertion clearly.

## 3. Test the tests: 22 deliberate faults

**Hook:** "Would your tests catch a broken app?"

**Audience:** GitHub visitors and short social posts.
**Length:** 8 seconds, looping and understandable without audio.

| Time | Picture | Caption |
|---|---|---|
| 0–2 s | Healthy fixture and passing assertion | Start with a healthy app |
| 2–4 s | 22 numbered fault variants appear | Introduce controlled faults |
| 4–6 s | Their designated assertions fail | Catch the broken behavior |
| 6–8 s | 22/22 detections plus healthy control and evidence | Keep the evidence |

The delivered motion graphic uses the 22-fault campaign at commit
`462126bcc4d3bfe94a7c064b848c690c1366f343`. Its text and counts are rendered by code.
It is an explainer, not a screen recording of real-time execution.

Regenerate with Pillow and ffmpeg installed:

```bash
python3 scripts/render-proof-animation.py --out /absolute/path/to/video-exports
```

Exports: 960×540 looping GIF, 1080×1080 MP4, 1280×720 MP4, PNG covers, and a provenance
manifest. Both videos are eight seconds, H.264, 24 fps, with no required audio track.
The GIF is suitable for a README embed; use the square MP4 for a social feed.

## Claims supported by these demonstrations

- Skills guide the host through a real QA task; the runner records what executed.
- A passing suite can miss a specific boundary or server-side invariant.
- The controlled suite distinguishes 22 known broken variants from its healthy control.
- Reports retain failures, blockers, unrun work, and the evidence behind their status.

Avoid unsupported uniqueness claims, a universal "always works" promise, or an unstaged
claim that a model without these skills always produces bad tests. An app that looks
identical can have an accessibility failure, but a missing label does not itself prove
that Tab navigation fails. Payment fixtures use a local contract, not a real PSP charge.
