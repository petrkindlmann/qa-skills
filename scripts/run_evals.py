#!/usr/bin/env python3
"""Run qa-skills evals in static, baseline, or live mode.

Each skill has an eval spec at evals/<skill>-evals.json with 8-10 cases. A case
has a prompt, expected_patterns (must appear), and anti_patterns (must not).

Modes
-----
--static    (default, free, CI-safe)
    Check lexical coverage in SKILL.md + references/ CONTENT, with a heuristic
    for anti-pattern warnings. Prompts are not executed. This measures content
    coverage, not whether an agent produces a correct answer. No model calls.

--baseline  (the RED phase of skill-TDD)
    Run each prompt through `claude -p` WITHOUT the skill loaded. Records what a
    bare agent produces. Used when authoring a skill to prove the eval has teeth.

--live      (the GREEN phase / output-pattern validation)
    Run each prompt through `claude -p` WITH the skill content prepended. Checks
    the agent's actual output against the patterns.

Live/baseline shell out to the `claude` CLI. If it is absent, those modes error
clearly and static still works. They are response-only evaluations: each call
uses an empty working directory, disables automatic context discovery and tools,
and does not execute generated code. This requires a current Claude Code CLI
supporting --safe-mode, --tools, --disallowedTools, and --no-session-persistence.

All scores cover deterministic pattern checks only. Expected AND forbidden
semantic criteria remain deferred to a judge; they are not behavioral passes.
Cases with no checkable criteria and input/model errors cannot pass a threshold.
Exit codes: 0 = pattern threshold met, 1 = pattern failures, 2 = incomplete run
or invalid inputs. JSON reports retain live/baseline outputs and execution errors.

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
import math
import re
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from eval_patterns import check_case, matches, split_alternation, validate_eval_spec  # noqa: E402

# In static mode an anti-pattern token legitimately appears when the skill is
# WARNING against it ("never use waitForTimeout"). Treat the anti-pattern as a
# static failure only when the skill appears to RECOMMEND it — i.e. it shows up
# without any nearby negative cue. This keeps static mode meaningful (the skill
# must teach the expected patterns) without punishing good anti-pattern docs.
_NEGATIVE_CUES = (
    "avoid", "never", "don't", "do not", "anti-pattern", "anti-patterns",
    "instead of", "bad:", "not ", "no ", "without", "forbid", "wrong", "stop",
    "deprecated", "smell", "flaky", "fragile", "replace", "remove",
    "nothing", "cannot", "can't", "won't", "reject", "waste", "unrelated",
    "useless", "unrunnable", "leak",
)
# Markdown emphasis and code ticks hide cues from substring checks: "do **not** poll".
_EMPHASIS = re.compile(r"[*_`]+")
_SENTENCE_END = re.compile(r"[.!?:;)]\s*$")

REPO = Path(__file__).parent.parent
SKILLS = REPO / "skills"
EVALS = REPO / "evals"


def load_skill_text(skill: str) -> str:
    """Full skill content: SKILL.md plus every references/*.md, concatenated."""
    skill_dir = SKILLS / skill
    main = skill_dir / "SKILL.md"
    if not main.is_file():
        raise ValueError(f"{skill}: missing skill file {main}")
    content = main.read_text(encoding="utf-8")
    if not content.strip():
        raise ValueError(f"{skill}: empty skill file {main}")
    parts = [content]
    ref_dir = skill_dir / "references"
    if ref_dir.exists():
        for ref in sorted(ref_dir.glob("*.md")):
            parts.append(ref.read_text(encoding="utf-8"))
    return "\n\n".join(parts)


def eval_specs() -> dict[str, Path]:
    specs = {p.name.removesuffix("-evals.json"): p
             for p in sorted(EVALS.glob("*-evals.json")) if p.is_file()}
    if not specs:
        raise ValueError(f"no eval specs found in {EVALS}")
    return specs


def _negative_regions(lines: list[str]) -> list[bool]:
    """Mark each line as inside a 'warning' region. A line is negative if it (or
    a nearby preceding line) carries a cue: a negative word, a BAD/❌ marker, or
    an Anti-Pattern heading whose section it falls under."""
    flags = [False] * len(lines)
    in_anti_section = False
    cue_window = 0  # lines remaining under the influence of a recent BAD/heading cue
    plain = [_EMPHASIS.sub("", line.lower()) for line in lines]
    for i, line in enumerate(lines):
        low = plain[i]
        if low.startswith("## "):
            in_anti_section = "anti-pattern" in low or "anti-patterns" in low \
                or "mistakes" in low or "smell" in low
        if low.startswith("bad") or any(c in low for c in (
                "// bad", "# bad", "❌", "anti-pattern", "wrong:",
                "don't", "do not", "never", "avoid", "instead")):
            cue_window = 6  # this and the next few lines are part of the warning
        line_neg = any(cue in low for cue in _NEGATIVE_CUES)
        # Markdown wraps sentences: a cue on the previous or next line of the same
        # sentence ("Client-side fakes ... do" / "nothing to Stripe's billing") counts.
        if not line_neg and i and not _SENTENCE_END.search(lines[i - 1]):
            line_neg = any(cue in plain[i - 1] for cue in _NEGATIVE_CUES)
        if not line_neg and i + 1 < len(lines) and not _SENTENCE_END.search(line):
            line_neg = any(cue in plain[i + 1] for cue in _NEGATIVE_CUES)
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
    for alt in split_alternation(pattern):
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


class ModelRunError(RuntimeError):
    """Execution failure with raw diagnostics that must never become an answer."""

    def __init__(self, message: str, output: str = "", stderr: str = ""):
        super().__init__(message)
        self.output = output
        self.stderr = stderr


def _decoded(value: str | bytes | None) -> str:
    # TimeoutExpired may retain bytes even when subprocess.run(text=True).
    return value.decode("utf-8", errors="replace") if isinstance(value, bytes) else value or ""


def run_claude(prompt: str, system: str | None, output_format: str = "text") -> str:
    # Current CLI contract: https://code.claude.com/docs/en/cli-reference
    # Keep skill content as the only difference between live and baseline.
    # --tools disables built-ins; the separate deny rule covers MCP tools.
    # judge_evals.py asks for the "json" envelope to record model and cost.
    if output_format not in {"text", "json"}:
        raise ValueError(f"unsupported output format {output_format!r}")
    cmd = ["claude", "-p", prompt, "--safe-mode", "--tools", "",
           "--disallowedTools", "mcp__*", "--no-session-persistence",
           "--output-format", output_format]
    if system:
        cmd += ["--append-system-prompt", system]
    try:
        with tempfile.TemporaryDirectory(prefix="qa-skills-eval-") as working_directory:
            out = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                                 errors="replace", timeout=180, cwd=working_directory)
    except FileNotFoundError as error:
        raise ModelRunError("`claude` CLI not found; --static works without it") from error
    except subprocess.TimeoutExpired as error:
        raise ModelRunError("`claude` timed out after 180 seconds",
                            _decoded(error.stdout), _decoded(error.stderr)) from error
    except OSError as error:
        raise ModelRunError(f"could not execute `claude`: {error}") from error
    if out.returncode != 0:
        message = f"`claude` exited with status {out.returncode}"
        if any(token in (out.stdout + out.stderr).lower()
               for token in ("unknown option", "unknown argument", "unrecognized option")):
            message += "; update Claude Code to support the response-only isolation flags"
        raise ModelRunError(message, out.stdout, out.stderr)
    if not out.stdout.strip():
        raise ModelRunError("`claude` returned empty stdout", out.stdout, out.stderr)
    return out.stdout


def _prepare_skill(skill: str, spec_path: Path, mode: str) -> tuple[list[dict], str]:
    if mode not in {"static", "baseline", "live"}:
        raise ValueError(f"unknown eval mode {mode!r}")
    try:
        spec = json.loads(spec_path.read_text(encoding="utf-8"))
        cases = validate_eval_spec(spec, expected_skill=skill)
    except (OSError, UnicodeError, ValueError) as error:
        raise ValueError(f"{spec_path}: {error}") from error
    # The RED phase deliberately permits specs written before the skill exists.
    skill_text = "" if mode == "baseline" else load_skill_text(skill)
    return cases, skill_text


def eval_skill(skill: str, spec_path: Path, mode: str) -> dict:
    cases, skill_text = _prepare_skill(skill, spec_path, mode)
    return _eval_cases(skill, cases, skill_text, mode)


def _eval_cases(skill: str, cases: list[dict], skill_text: str, mode: str) -> dict:
    results = []
    for case in cases:
        if mode == "static" and case.get("static") is False:
            # The case checks facts that only a model answer can carry (for example
            # identifiers copied from the prompt); skill content cannot satisfy it.
            results.append({"id": case["id"], "passed": False, "status": "live_only",
                            "missing": [], "anti_hit": [], "semantic": [],
                            "semantic_expected": [], "semantic_anti": [], "checkable_patterns": 0})
            continue
        try:
            if mode == "static":
                text = skill_text
            else:
                system = (
                    "You have access to the following QA skill. Apply it when answering.\n\n"
                    + skill_text
                ) if mode == "live" else None
                text = run_claude(case["prompt"], system)
        except ModelRunError as error:
            results.append({
                "id": case["id"], "passed": False, "status": "error",
                "missing": [], "anti_hit": [], "semantic": [],
                "error": str(error), "output": error.output, "stderr": error.stderr,
            })
            continue

        r = check_case(case, text)
        anti_hit = r.anti_hit
        if mode == "static" and anti_hit:
            anti_hit = [p for p in anti_hit if _recommends_antipattern(p, text)]
        passed = r.checkable > 0 and not r.expected_miss and not anti_hit
        result = {
            "id": r.case_id,
            "passed": passed,
            "status": "uncheckable" if not r.checkable else "pass" if passed else "fail",
            "missing": r.expected_miss,
            "anti_hit": anti_hit,
            "semantic": r.semantic + r.semantic_anti,
            "semantic_expected": r.semantic,
            "semantic_anti": r.semantic_anti,
            "checkable_patterns": r.checkable,
        }
        if mode != "static":
            result["output"] = text
        results.append(result)

    passed = sum(1 for r in results if r["passed"])
    semantic_total = sum(len(r["semantic"]) for r in results)
    return {
        "skill": skill,
        "mode": mode,
        "scope": "skill_content" if mode == "static" else "model_output",
        "total": len(results),
        "passed": passed,
        "failed": sum(r["status"] == "fail" for r in results),
        "errors": sum(r["status"] == "error" for r in results),
        "uncheckable": sum(r["status"] == "uncheckable" for r in results),
        "live_only": sum(r["status"] == "live_only" for r in results),
        "checkable_cases": sum(r["status"] in {"pass", "fail"} for r in results),
        "semantic_deferred": semantic_total,
        "cases": results,
    }


def print_report(report: dict) -> None:
    s = report
    flag = "ERROR" if s["errors"] or s["uncheckable"] else "FAIL" if s["failed"] else "OK  "
    print(f"  {flag} {s['skill']}: {s['passed']}/{s['checkable_cases']} checkable cases pass"
          f"{f', {s['semantic_deferred']} semantic→judge' if s['semantic_deferred'] else ''}")
    for c in s["cases"]:
        if not c["passed"]:
            if c.get("error"):
                print(f"        {c['id']} ERROR: {c['error']}")
            if c["status"] == "uncheckable":
                print(f"        {c['id']} UNCHECKABLE: all criteria require a judge")
            if c["status"] == "live_only":
                print(f"        {c['id']} LIVE-ONLY: checks a model answer, not skill content")
            if c["missing"]:
                print(f"        {c['id']} missing: {c['missing']}")
            if c["anti_hit"]:
                print(f"        {c['id']} ANTI-PATTERN present: {c['anti_hit']}")


def _pass_rate(value: str) -> float:
    rate = float(value)
    if not math.isfinite(rate) or not 0 <= rate <= 100:
        raise argparse.ArgumentTypeError("pass rate must be a finite number from 0 to 100")
    return rate


def _workers(value: str) -> int:
    count = int(value)
    if count < 1:
        raise argparse.ArgumentTypeError("workers must be a positive integer")
    return count


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--static", action="store_true", help="check skill content (default)")
    mode.add_argument("--live", action="store_true", help="run prompts WITH skill via claude")
    mode.add_argument("--baseline", action="store_true", help="run prompts WITHOUT skill")
    selection = ap.add_mutually_exclusive_group()
    selection.add_argument("--skill", help="single skill name")
    selection.add_argument("--all", action="store_true", help="all skills (default if no --skill)")
    ap.add_argument("--json", help="write full results to this path")
    ap.add_argument("--workers", type=_workers, default=4, help="parallel skills for live/baseline")
    ap.add_argument("--min-pass-rate", type=_pass_rate, default=None, metavar="PCT",
                    help="exit 0 if the checkable pass rate is >= PCT (e.g. 90). "
                         "Use in CI to tolerate the documented eval-precision floor "
                         "while still catching real regressions. Without it, any fail "
                         "exits 1.")
    args = ap.parse_args(argv)

    mode_name = "live" if args.live else "baseline" if args.baseline else "static"
    try:
        specs = eval_specs()
        if args.skill:
            if args.skill not in specs:
                raise ValueError(f"no eval spec for '{args.skill}' (evals/{args.skill}-evals.json)")
            targets = {args.skill: specs[args.skill]}
        else:
            targets = specs
            if mode_name != "baseline" and SKILLS.is_dir():
                skills = {p.name for p in SKILLS.iterdir() if p.is_dir() and not p.name.startswith(".")}
                missing = skills - specs.keys()
                if missing:
                    raise ValueError(f"skills missing eval specs: {', '.join(sorted(missing))}")
        # Preflight every spec before the first paid model call. Malformed later
        # cases or skills must not leave a partially executed, apparently valid run.
        prepared = {s: _prepare_skill(s, p, mode_name) for s, p in targets.items()}
    except (OSError, UnicodeError, ValueError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2

    print(f"Running {len(targets)} skill(s) in {mode_name} mode\n")
    if mode_name == "static":
        print("Scope: skill content coverage only; prompts are not executed.")
    else:
        print("Scope: response-only pattern checks on model output; generated code is not executed.")
    print("Semantic criteria require a judge and are excluded from pattern scores.\n")

    reports: list[dict] = []
    if mode_name == "static":
        for skill, (cases, skill_text) in prepared.items():
            reports.append(_eval_cases(skill, cases, skill_text, mode_name))
    else:
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futs = {ex.submit(_eval_cases, s, cases, text, mode_name): s
                    for s, (cases, text) in prepared.items()}
            for fut in as_completed(futs):
                reports.append(fut.result())

    reports.sort(key=lambda r: r["skill"])
    for r in reports:
        print_report(r)

    total = sum(r["total"] for r in reports)
    passed = sum(r["passed"] for r in reports)
    failed = sum(r["failed"] for r in reports)
    errors = sum(r["errors"] for r in reports)
    uncheckable = sum(r["uncheckable"] for r in reports)
    checkable = sum(r["checkable_cases"] for r in reports)
    semantic = sum(r["semantic_deferred"] for r in reports)
    live_only = sum(r.get("live_only", 0) for r in reports)
    print(f"\nSkills: {len(reports)}  Cases: {total}  Pass: {passed}  Fail: {failed}"
          f"  Errors: {errors}  Uncheckable: {uncheckable}  Live-only: {live_only}"
          f"  Semantic→judge: {semantic}")

    if args.json:
        try:
            Path(args.json).write_text(json.dumps(reports, indent=2) + "\n", encoding="utf-8")
        except OSError as error:
            print(f"ERROR: could not write JSON report {args.json}: {error}", file=sys.stderr)
            return 2
        print(f"Wrote {args.json}")

    if errors or uncheckable or not checkable:
        print("ERROR: incomplete evaluation; execution errors or uncheckable cases "
              "cannot be accepted by a pass-rate threshold.", file=sys.stderr)
        return 2

    if args.min_pass_rate is not None:
        rate = 100.0 * passed / checkable
        ok = rate >= args.min_pass_rate
        print(f"Checkable case pass rate: {rate:.1f}% (threshold {args.min_pass_rate:g}%) -> "
              f"{'PASS' if ok else 'FAIL'}")
        return 0 if ok else 1

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
