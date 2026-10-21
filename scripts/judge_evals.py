#!/usr/bin/env python3
"""Judge the semantic eval criteria that scripts/run_evals.py defers.

run_evals.py checks lexical criteria and lists the prose ones per case as
"semantic_expected" and "semantic_anti". This script sends those to a model
judge in one of two scopes:

--static         The skill's own content (SKILL.md + references/) is the
                 document. One judge call per skill carries all of its
                 semantic criteria: does the skill teach each expected
                 criterion, does it recommend each anti criterion?
--from-results   A results file written by `run_evals.py --live|--baseline
                 --json`. Each recorded model output is judged against its
                 case's semantic criteria, one call per case: is each expected
                 criterion met by the answer, is each anti criterion present?

Every "yes" must carry a verbatim quote from the judged document. A quote that
cannot be found in the document is reported as "unverified", never as a pass.
Model id, cost and duration come from the CLI's JSON envelope per call.

Exit status: 0 when every criterion is satisfied; 1 when any expected criterion
is not taught/met or any anti criterion is recommended/present; 2 when a judge
call failed, answered malformed JSON, or left a verdict unverified.

Examples:
    python3 scripts/judge_evals.py --static --skill qa-start
    python3 scripts/judge_evals.py --static --all --json docs/evidence/judge-static.json
    python3 scripts/run_evals.py --live --skill email-testing --json live.json
    python3 scripts/judge_evals.py --from-results live.json --json judged.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
from eval_patterns import check_case, validate_eval_spec  # noqa: E402
import run_evals  # noqa: E402

MIN_EVIDENCE = 15
MAX_EVIDENCE = 240

SYSTEM_PROMPT = """You are a strict grader of QA guidance. You receive a DOCUMENT and a numbered
list of CRITERIA. Judge each criterion against the document alone.

[expected] criteria: answer yes only when the document clearly teaches, states or applies the
practice (the same practice in other words counts; an incidental mention does not).
[anti] criteria: answer yes only when the document RECOMMENDS, models or performs that practice
as something to do. Warning against it, listing it as a mistake, or showing it as a bad example
is no.

Respond with JSON only, no prose and no code fences:
{"verdicts": [{"n": 1, "verdict": "yes", "evidence": "<verbatim quote>", "reason": "<one sentence>"}, ...]}
Give one verdict per criterion, in order. For every yes, copy the evidence character for
character from the document (15 to 240 characters); it is checked mechanically and a yes whose
quote is not in the document is discarded. For a no, evidence may be an empty string."""


def collect_criteria(case: dict, text: str) -> list[dict]:
    """The semantic criteria of one case, as run_evals.py classifies them."""
    result = check_case(case, text)
    return ([{"case": case["id"], "kind": "expected", "text": p} for p in result.semantic]
            + [{"case": case["id"], "kind": "anti", "text": p} for p in result.semantic_anti])


def build_prompt(document: str, criteria: list[dict]) -> str:
    lines = [f"{n}. [{c['kind']}] {c['text']}" for n, c in enumerate(criteria, 1)]
    return ("DOCUMENT:\n<<<\n" + document + "\n>>>\n\nCRITERIA:\n" + "\n".join(lines)
            + "\n\nRespond with the JSON object only.")


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def evidence_found(quote: str, document: str) -> bool:
    quote = normalize(quote)
    return len(quote) >= MIN_EVIDENCE and quote in normalize(document)


def parse_envelope(stdout: str) -> dict:
    """The `claude --output-format json` envelope: result text plus usage."""
    try:
        envelope = json.loads(stdout)
    except ValueError as error:
        raise ValueError(f"judge output is not a JSON envelope: {error}") from error
    if not isinstance(envelope, dict) or not isinstance(envelope.get("result"), str):
        raise ValueError("judge envelope has no result text")
    if envelope.get("is_error") or envelope.get("subtype") not in (None, "success"):
        raise ValueError(f"judge call reported {envelope.get('subtype')}: {envelope['result'][:200]}")
    usage = envelope.get("modelUsage") or {}
    return {
        "result": envelope["result"],
        "model": ", ".join(sorted(usage)) if isinstance(usage, dict) else None,
        "cost_usd": envelope.get("total_cost_usd"),
        "duration_ms": envelope.get("duration_ms"),
    }


def parse_verdicts(result: str, count: int) -> list[dict]:
    text = result.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise ValueError("judge answer contains no JSON object")
    try:
        data = json.loads(text[start:end + 1])
    except ValueError as error:
        raise ValueError(f"judge answer is not valid JSON: {error}") from error
    verdicts = data.get("verdicts") if isinstance(data, dict) else None
    if not isinstance(verdicts, list) or len(verdicts) != count:
        raise ValueError(f"judge returned {len(verdicts) if isinstance(verdicts, list) else 'no'} "
                         f"verdicts for {count} criteria")
    cleaned = []
    for n, item in enumerate(verdicts, 1):
        if not isinstance(item, dict) or item.get("n") != n:
            raise ValueError(f"verdict {n} is missing or out of order")
        verdict = str(item.get("verdict", "")).strip().lower()
        if verdict not in {"yes", "no"}:
            raise ValueError(f"verdict {n} is {item.get('verdict')!r}, expected yes or no")
        cleaned.append({"verdict": verdict, "evidence": str(item.get("evidence") or ""),
                        "reason": str(item.get("reason") or "")})
    return cleaned


def status_for(kind: str, verdict: str, verified: bool) -> str:
    if verdict == "no":
        return "not_taught" if kind == "expected" else "not_recommended"
    if not verified:
        return "unverified"
    return "taught" if kind == "expected" else "recommended"


def judge_document(document: str, criteria: list[dict], run=run_evals.run_claude) -> dict:
    """One judge call over a document and its criteria; never raises for model trouble."""
    if not criteria:
        return {"items": [], "error": None, "model": None, "cost_usd": 0, "duration_ms": 0}
    started = time.monotonic()
    try:
        envelope = parse_envelope(run(build_prompt(document, criteria), SYSTEM_PROMPT, "json"))
        verdicts = parse_verdicts(envelope["result"], len(criteria))
    except (run_evals.ModelRunError, ValueError) as error:
        return {"items": [dict(c, status="error") for c in criteria], "error": str(error),
                "model": None, "cost_usd": None,
                "duration_ms": round((time.monotonic() - started) * 1000)}
    items = []
    for criterion, verdict in zip(criteria, verdicts):
        verified = verdict["verdict"] == "yes" and evidence_found(verdict["evidence"], document)
        items.append(dict(criterion, verdict=verdict["verdict"], evidence=verdict["evidence"],
                          reason=verdict["reason"], evidence_verified=verified,
                          status=status_for(criterion["kind"], verdict["verdict"], verified)))
    return {"items": items, "error": None, "model": envelope["model"],
            "cost_usd": envelope["cost_usd"], "duration_ms": envelope["duration_ms"]}


def judge_static(skill: str, spec_path: Path, run=run_evals.run_claude) -> dict:
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    cases = validate_eval_spec(spec, expected_skill=skill)
    document = run_evals.load_skill_text(skill)
    # Live-only cases check facts from the prompt; skill content cannot carry them.
    criteria = [c for case in cases if case.get("static") is not False
                for c in collect_criteria(case, document)]
    judged = judge_document(document, criteria, run)
    return {"skill": skill, "scope": "skill_content", "document_chars": len(document),
            "calls": 1 if criteria else 0, **judged}


def judge_results(path: Path, skill: str | None, run=run_evals.run_claude) -> list[dict]:
    reports = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(reports, list):
        raise ValueError(f"{path}: expected the list written by run_evals.py --json")
    specs = run_evals.eval_specs()
    out = []
    for report in reports:
        name = report.get("skill")
        if skill and name != skill:
            continue
        if report.get("mode") not in {"live", "baseline"}:
            raise ValueError(f"{path}: skill {name!r} was run in {report.get('mode')!r} mode, "
                             "only live or baseline outputs can be judged")
        spec = json.loads(specs[name].read_text(encoding="utf-8"))
        cases = {c["id"]: c for c in validate_eval_spec(spec, expected_skill=name)}
        items, errors, calls, cost, judged_cases = [], [], 0, 0.0, []
        for recorded in report.get("cases", []):
            case = cases.get(recorded.get("id"))
            output = recorded.get("output")
            if case is None or recorded.get("status") == "error" or not isinstance(output, str):
                errors.append(f"{recorded.get('id')}: no recorded output to judge")
                continue
            criteria = collect_criteria(case, output)
            if not criteria:
                continue
            judged = judge_document(output, criteria, run)
            calls += 1
            cost += judged["cost_usd"] or 0
            if judged["error"]:
                errors.append(f"{case['id']}: {judged['error']}")
            items.extend(judged["items"])
            judged_cases.append({"id": case["id"], "model": judged["model"],
                                 "semantic_pass": all(i["status"] in {"taught", "not_recommended"}
                                                      for i in judged["items"])})
        out.append({"skill": name, "scope": f"model_output:{report['mode']}", "calls": calls,
                    "cost_usd": round(cost, 4), "cases": judged_cases, "items": items,
                    "error": "; ".join(errors) or None})
    return out


def summarize(report: dict) -> dict:
    counts = {k: 0 for k in ("taught", "not_taught", "recommended", "not_recommended",
                             "unverified", "error")}
    for item in report["items"]:
        counts[item["status"]] += 1
    counts["criteria"] = len(report["items"])
    counts["failures"] = counts["not_taught"] + counts["recommended"]
    counts["incomplete"] = counts["unverified"] + counts["error"]
    return counts


def print_report(report: dict) -> None:
    c = summarize(report)
    flag = "FAIL" if c["failures"] else "INCOMPLETE" if c["incomplete"] else "PASS"
    print(f"[{flag}] {report['skill']} ({report['scope']}): {c['criteria']} criteria, "
          f"taught {c['taught']}/{c['taught'] + c['not_taught']}, anti recommended "
          f"{c['recommended']}/{c['recommended'] + c['not_recommended']}, unverified "
          f"{c['unverified']}, errors {c['error']}, calls {report['calls']}, "
          f"cost ${report.get('cost_usd') or 0:.3f}")
    for item in report["items"]:
        if item["status"] in {"not_taught", "recommended", "unverified", "error"}:
            print(f"   {item['status']:<15} {item['case']} [{item['kind']}] {item['text']}")
            if item.get("reason"):
                print(f"   {'':<15} judge: {item['reason']}")
    if report.get("error"):
        print(f"   error: {report['error']}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    scope = ap.add_mutually_exclusive_group(required=True)
    scope.add_argument("--static", action="store_true", help="judge skill content")
    scope.add_argument("--from-results", metavar="PATH",
                       help="judge model outputs recorded by run_evals.py --live/--baseline --json")
    selection = ap.add_mutually_exclusive_group()
    selection.add_argument("--skill", help="single skill name")
    selection.add_argument("--all", action="store_true", help="all skills (default)")
    ap.add_argument("--json", help="write full results to this path")
    args = ap.parse_args(argv)

    try:
        if args.static:
            specs = run_evals.eval_specs()
            if args.skill and args.skill not in specs:
                raise ValueError(f"no eval spec for '{args.skill}' (evals/{args.skill}-evals.json)")
            targets = {args.skill: specs[args.skill]} if args.skill else specs
            print(f"Judging skill content of {len(targets)} skill(s); one judge call per skill.\n")
            reports = []
            for skill, spec_path in targets.items():
                report = judge_static(skill, spec_path)
                print_report(report)
                reports.append(report)
        else:
            reports = judge_results(Path(args.from_results), args.skill)
            print(f"Judged recorded model outputs from {args.from_results}\n")
            for report in reports:
                print_report(report)
    except (OSError, UnicodeError, ValueError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2

    totals = {}
    for report in reports:
        for key, value in summarize(report).items():
            totals[key] = totals.get(key, 0) + value
    cost = sum(r.get("cost_usd") or 0 for r in reports)
    print(f"\nSkills: {len(reports)}  Criteria: {totals.get('criteria', 0)}  "
          f"Taught: {totals.get('taught', 0)}  Not taught: {totals.get('not_taught', 0)}  "
          f"Anti recommended: {totals.get('recommended', 0)}  Unverified: {totals.get('unverified', 0)}  "
          f"Errors: {totals.get('error', 0)}  Cost: ${cost:.2f}")

    if args.json:
        try:
            Path(args.json).write_text(json.dumps(reports, indent=2) + "\n", encoding="utf-8")
        except OSError as error:
            print(f"ERROR: could not write JSON report {args.json}: {error}", file=sys.stderr)
            return 2
        print(f"Wrote {args.json}")

    if totals.get("incomplete"):
        print("ERROR: incomplete judging; unverified or failed verdicts are not passes.",
              file=sys.stderr)
        return 2
    return 1 if totals.get("failures") else 0


if __name__ == "__main__":
    sys.exit(main())
