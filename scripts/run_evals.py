#!/usr/bin/env python3
"""Run qa-skills evals in static, baseline, or live mode.

Each skill has an eval spec at evals/<skill>-evals.json with 8-10 cases. A case
has a prompt, expected_patterns (must appear), and anti_patterns (must not).

Modes
-----
--static    (default, free, CI-safe)
    Does the SKILL.md + references/ CONTENT teach every expected pattern and
    avoid recommending anti-patterns? This is a proxy for "an agent that read
    this skill would produce the right thing." No model calls.

--baseline  (the RED phase of skill-TDD)
    Run each prompt through `claude -p` WITHOUT the skill loaded. Records what a
    bare agent produces. Used when authoring a skill to prove the eval has teeth.

--live      (the GREEN phase / full validation)
    Run each prompt through `claude -p` WITH the skill content prepended. Checks
    the agent's actual output against the patterns.

Live/baseline shell out to the `claude` CLI. If it is absent, those modes error
clearly and static still works.

Usage
-----
    python scripts/run_evals.py --static
    python scripts/run_evals.py --static --skill payment-testing
    python scripts/run_evals.py --live --skill email-testing
    python scripts/run_evals.py --baseline --skill bug-reproduction
    python scripts/run_evals.py --live --all --json results.json
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from eval_patterns import check_case, is_semantic, matches  # noqa: E402

# In static mode an anti-pattern token legitimately appears when the skill is
# WARNING against it ("never use waitForTimeout"). Treat the anti-pattern as a
# static failure only when the skill appears to RECOMMEND it — i.e. it shows up
# without any nearby negative cue. This keeps static mode meaningful (the skill
# must teach the expected patterns) without punishing good anti-pattern docs.
_NEGATIVE_CUES = (
    "avoid", "never", "don't", "do not", "anti-pattern", "anti-patterns",
    "instead of", "bad:", "not ", "no ", "without", "forbid", "wrong", "stop",
    "deprecated", "smell", "flaky", "fragile", "replace", "remove",
)

REPO = Path(__file__).parent.parent
SKILLS = REPO / "skills"
EVALS = REPO / "evals"


def load_skill_text(skill: str) -> str:
    """Full skill content: SKILL.md plus every references/*.md, concatenated."""
    skill_dir = SKILLS / skill
    parts = []
    main = skill_dir / "SKILL.md"
    if main.exists():
        parts.append(main.read_text())
    ref_dir = skill_dir / "references"
    if ref_dir.exists():
        for ref in sorted(ref_dir.glob("*.md")):
            parts.append(ref.read_text())
    return "\n\n".join(parts)


def eval_specs() -> dict[str, Path]:
    return {p.stem.replace("-evals", ""): p for p in sorted(EVALS.glob("*-evals.json"))}


def _negative_regions(lines: list[str]) -> list[bool]:
    """Mark each line as inside a 'warning' region. A line is negative if it (or
    a nearby preceding line) carries a cue: a negative word, a BAD/❌ marker, or
    an Anti-Pattern heading whose section it falls under."""
    flags = [False] * len(lines)
    in_anti_section = False
    cue_window = 0  # lines remaining under the influence of a recent BAD/heading cue
    for i, line in enumerate(lines):
        low = line.lower()
        if low.startswith("## "):
            in_anti_section = "anti-pattern" in low or "anti-patterns" in low \
                or "mistakes" in low or "smell" in low
        if any(c in low for c in ("// bad", "# bad", "❌", "anti-pattern", "wrong:",
                                  "don't", "do not", "never", "avoid", "instead")):
            cue_window = 6  # this and the next few lines are part of the warning
        line_neg = any(cue in low for cue in _NEGATIVE_CUES)
        flags[i] = in_anti_section or cue_window > 0 or line_neg
        if cue_window > 0:
            cue_window -= 1
    return flags


def _recommends_antipattern(pattern: str, text: str) -> bool:
    """In static mode: does the skill RECOMMEND this anti-pattern (bad) vs WARN
    against it (good)? An occurrence inside a warning region (anti-pattern section,
    BAD example, or near a negative cue) is fine. An occurrence in neutral prose
    means the skill is presenting it as acceptable — a real static failure."""
    lines = text.splitlines()
    neg = _negative_regions(lines)
    for alt in pattern.split(" OR "):
        alt = alt.strip()
        for i, line in enumerate(lines):
            stripped = line.lstrip()
            if stripped.startswith("#"):
                continue  # a heading naming the construct is meta, not usage
            low = line.lower()
            # A search/lint command that hunts FOR the anti-pattern (to ban it) is
            # meta, not a recommendation: `grep -rE 'waitForTimeout' tests/`.
            if any(tool in low for tool in ("grep", "rg ", "eslint", "forbid",
                                            "no-restricted", "ripgrep", "lint")):
                continue
            if matches(alt, line) and not neg[i]:
                return True
    return False


def run_claude(prompt: str, system: str | None) -> str:
    cmd = ["claude", "-p", prompt]
    if system:
        cmd += ["--append-system-prompt", system]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    except FileNotFoundError:
        raise SystemExit("ERROR: `claude` CLI not found; --static works without it.")
    except subprocess.TimeoutExpired:
        return "[TIMEOUT]"
    return out.stdout or out.stderr


def eval_skill(skill: str, spec_path: Path, mode: str) -> dict:
    spec = json.loads(spec_path.read_text())
    cases = spec.get("evals", [])
    skill_text = load_skill_text(skill)

    results = []
    for case in cases:
        if mode == "static":
            text = skill_text
        elif mode == "baseline":
            text = run_claude(case["prompt"], None)
        else:  # live
            system = (
                "You have access to the following QA skill. Apply it when answering.\n\n"
                + skill_text
            )
            text = run_claude(case["prompt"], system)

        r = check_case(case, text)
        anti_hit = r.anti_hit
        if mode == "static" and anti_hit:
            anti_hit = [p for p in anti_hit if _recommends_antipattern(p, text)]
        passed = not r.expected_miss and not anti_hit
        results.append(
            {
                "id": r.case_id,
                "passed": passed,
                "missing": r.expected_miss,
                "anti_hit": anti_hit,
                "semantic": r.semantic,
            }
        )

    passed = sum(1 for r in results if r["passed"])
    semantic_total = sum(len(r["semantic"]) for r in results)
    return {
        "skill": skill,
        "mode": mode,
        "total": len(results),
        "passed": passed,
        "failed": len(results) - passed,
        "semantic_deferred": semantic_total,
        "cases": results,
    }


def print_report(report: dict) -> None:
    s = report
    flag = "OK  " if s["failed"] == 0 else "FAIL"
    print(f"  {flag} {s['skill']}: {s['passed']}/{s['total']} pass"
          f"{f', {s['semantic_deferred']} semantic→judge' if s['semantic_deferred'] else ''}")
    for c in s["cases"]:
        if not c["passed"]:
            if c["missing"]:
                print(f"        {c['id']} missing: {c['missing']}")
            if c["anti_hit"]:
                print(f"        {c['id']} ANTI-PATTERN present: {c['anti_hit']}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--static", action="store_true", help="check skill content (default)")
    mode.add_argument("--live", action="store_true", help="run prompts WITH skill via claude")
    mode.add_argument("--baseline", action="store_true", help="run prompts WITHOUT skill")
    ap.add_argument("--skill", help="single skill name")
    ap.add_argument("--all", action="store_true", help="all skills (default if no --skill)")
    ap.add_argument("--json", help="write full results to this path")
    ap.add_argument("--workers", type=int, default=4, help="parallel skills for live/baseline")
    args = ap.parse_args()

    mode_name = "live" if args.live else "baseline" if args.baseline else "static"
    specs = eval_specs()

    if args.skill:
        if args.skill not in specs:
            raise SystemExit(f"No eval spec for '{args.skill}' (evals/{args.skill}-evals.json)")
        targets = {args.skill: specs[args.skill]}
    else:
        targets = specs

    print(f"Running {len(targets)} skill(s) in {mode_name} mode\n")

    reports: list[dict] = []
    if mode_name == "static":
        for skill, path in targets.items():
            reports.append(eval_skill(skill, path, mode_name))
    else:
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futs = {ex.submit(eval_skill, s, p, mode_name): s for s, p in targets.items()}
            for fut in as_completed(futs):
                reports.append(fut.result())

    reports.sort(key=lambda r: r["skill"])
    for r in reports:
        print_report(r)

    total = sum(r["total"] for r in reports)
    passed = sum(r["passed"] for r in reports)
    failed = total - passed
    semantic = sum(r["semantic_deferred"] for r in reports)
    print(f"\nSkills: {len(reports)}  Cases: {total}  Pass: {passed}  Fail: {failed}"
          f"  Semantic→judge: {semantic}")

    if args.json:
        Path(args.json).write_text(json.dumps(reports, indent=2))
        print(f"Wrote {args.json}")

    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
