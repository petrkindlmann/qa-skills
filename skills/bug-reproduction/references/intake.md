# Extracting the implicit repro from a thin report

A report like *"Checkout is broken, order total is wrong sometimes"* contains almost no
reproducible information. Before writing any code — and **before theorizing a root cause**
— extract or ask for every dimension below. The instinct to jump to "sounds like a float
rounding bug, let me look at the total calc" is the failure mode; resist it until you can
reproduce. You cannot fix what you cannot reproduce.

## The extraction checklist

For *any* bug, you need these. Marked dimensions are the load-bearing ones for a
"wrong total" / data-correctness bug specifically.

| Dimension | Why it changes reproducibility | Ask / extract |
|-----------|-------------------------------|---------------|
| **Exact steps to reproduce** | "Checkout is broken" is a symptom, not a path | The precise click-by-click path that triggered it |
| **Build / version / commit (git SHA)** | The bug may already be fixed, or only on one deploy | Exact build number or commit SHA they were on |
| **Environment** (browser, OS, device) | Locale/rendering/JS-engine differences | Browser + version, OS, mobile vs desktop |
| **Input data** ★ | A "wrong total" depends entirely on the inputs | Cart contents, quantities, the account/user, the discount/coupon, the exact fixture |
| **Expected vs actual** | "Wrong" is meaningless without the right number | What total did they expect, what did they see |
| **Frequency** ★ | "Sometimes" = intermittent — changes the whole strategy | Every time, or intermittent? How many of N attempts? |
| **Locale / timezone / currency** ★ | Rounding, tax, and formatting are locale-specific | Their locale, timezone, and currency |
| **Timestamp of occurrence** | Correlate with deploys, time-of-day bugs, batch jobs | When did it happen (with timezone) |
| **Logs / screenshots / network trace** | Turns hearsay into evidence | Console errors, the failing response body, a HAR |

★ = the dimensions a thin "order total is wrong" report most often omits and that most
determine whether you can reproduce it.

## Why each load-bearing dimension matters for "wrong total"

- **Input data (cart / account / fixture):** a total bug is a pure function of inputs. Two
  items vs three, a percentage coupon vs a fixed one, a tax-exempt account — each can be
  the difference between green and red. Without the exact cart you are guessing.
- **Frequency:** "sometimes" points at non-determinism — a race, an unseeded random
  discount, a time-of-day rule, or a flaky third-party price. That sends you toward the
  determinism work (freeze time, seed RNG, stub network) rather than a straight-line repro.
- **Locale / timezone / currency:** totals involve rounding rules, tax tables, and currency
  minor-units that differ by locale. A total that's "wrong" in `de-DE` (comma decimals,
  19% VAT) may be correct in `en-US`. Reproduce in *their* locale.
- **Build / commit:** if they were on a build from before a fix, there is nothing to
  reproduce. Pin the SHA first.

## Turning answers into a repro spec

Once you have the dimensions, write them down as a single reproducible spec before touching
code:

```
Build:        2.5.1 (commit 3a9f2c1)
Environment:  Chrome 124 / macOS 14 / desktop
Locale:       de-DE, Europe/Berlin, EUR
Data:         account #4821 (tax-exempt=false), cart = [SKU-12 ×3], coupon SAVE10 (10%)
Steps:        1. log in as #4821  2. add SKU-12 ×3  3. apply SAVE10  4. open cart total
Expected:     €27.54
Actual:       €27.55  (off by one minor unit)
Frequency:    every time with this exact cart (deterministic)
```

If you cannot fill a row, that is the next question to the reporter — not a license to
theorize a cause from imagination. Only after this spec reproduces do you minimize and
isolate.
