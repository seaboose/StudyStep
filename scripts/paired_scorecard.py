"""Offline replay of StudyStep prompt comparisons. All input text is data."""

import hashlib
import json
from collections import Counter
from pathlib import Path

ARMS = ("baseline", "candidate")
CRITERIA = ("support", "novelty", "challenge")
RUBRIC = Path(__file__).resolve().parents[1] / "examples/prompt-comparison/rubric.json"
# Approved by the project owner on 2026-11-12. Normalize line endings on checkout.
APPROVED = "fd2251f7b6d145c223cda1901208c2707f784c9076660b31cd6082ddaba94dca"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def fingerprint(value):
    data = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(data.encode()).hexdigest()


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def prepare(plan):
    """Make explicit pending slots for every planned passage and condition."""
    approved = hashlib.sha256(RUBRIC.read_text(encoding="utf-8").encode()).hexdigest()
    require(type(plan["version"]) is int and plan["version"] == 1 and plan["rubric_sha256"] == approved == APPROVED,
            "unknown plan version or unapproved rubric")
    require(plan["kind"] in ("synthetic_control", "experiment"), "unknown evidence kind")
    prompts, settings = plan["prompts"], plan["settings"]
    require(set(prompts) == set(ARMS) and all(map(nonempty, prompts.values()))
            and prompts["baseline"] != prompts["candidate"], "two distinct prompt texts required")
    require(nonempty(settings["model"])
            and (settings["model_version"] is None or nonempty(settings["model_version"]))
            and (settings["seed"] is None or type(settings["seed"]) is int),
            "record model, model_version and seed (null when unknown)")
    for key, limit in (("call_limit", 12), ("deadline_seconds", 600)):
        require(type(settings[key]) is int and 0 < settings[key] <= limit, f"invalid {key}")
    require(type(settings["revision_limit"]) is int and settings["revision_limit"] == 1,
            "comparison allows one revision")
    cases = plan["cases"]
    require(isinstance(cases, list) and cases, "empty case list")
    records = {}
    for case in cases:
        key = case["id"]
        require(all(nonempty(case[k]) for k in ("id", "passage", "goal"))
                and key not in records, "invalid or duplicate case")
        require(case["level"] in ("foundation", "explain", "apply")
                and isinstance(case["previous_questions"], list)
                and all(map(nonempty, case["previous_questions"])), "invalid case context")
        records[key] = {}
        for arm in ARMS:
            bound = [plan["kind"], approved, case, settings, prompts[arm]]
            records[key][arm] = dict(input_sha256=fingerprint(bound), status="pending",
                                     calls=None, note="Awaiting capture.", drafts=[])
    return {"plan": plan, "records": records}


def judgment(attempt, index):
    review = attempt["review"]
    stage = review["stages"][index]
    require(set(stage["ratings"]) == set(CRITERIA), "incomplete rubric")
    require(all(v in ("pass", "fail", "uncertain") for v in stage["ratings"].values()),
            "invalid rubric rating")
    require(nonempty(stage["reason"]) and nonempty(stage["quote"]), "missing review evidence")
    return stage["ratings"]


def score_attempt(attempt, expected, case, limit):
    require(attempt["input_sha256"] == expected["input_sha256"], "mismatched passage, settings or prompt")
    status, calls, drafts = attempt["status"], attempt["calls"], attempt["drafts"]
    require(status in ("pending", "unavailable", "failed", "abstained", "proposed"), "unknown status")
    require(calls is None or (type(calls) is int and calls >= 0), "invalid model-call count")
    require(isinstance(drafts, list) and len(drafts) <= 2, "at most one revision")
    for draft in drafts:
        require(all(nonempty(draft[k]) for k in ("question", "answer", "citation")), "incomplete draft")
    if status == "proposed":
        require(drafts and calls is not None and 0 < calls <= limit, "invalid completed proposal")
    else:
        require(nonempty(attempt["note"]), "record why the proposal is absent")
    if status in ("pending", "unavailable"):
        require(not drafts and calls in (None, 0), "unstarted record contains work")
    digest = fingerprint({k: v for k, v in attempt.items() if k != "review"})
    result = dict(status=status, calls=calls, over_budget=calls is not None and calls > limit,
                  attempt_sha256=digest, draft_count=len(drafts), final=None, repairs={},
                  learner_decision="pending" if status == "proposed" else "no_proposal")
    if "review" not in attempt:
        return result
    review = attempt["review"]
    require(drafts and review["attempt_sha256"] == digest, "stale review")
    decision = review.get("learner_decision", "pending" if status == "proposed" else "no_proposal")
    require(decision in (("accepted", "rejected", "pending") if status == "proposed" else ("no_proposal",)),
            "invalid learner decision")
    if decision in ("accepted", "rejected"):
        require(nonempty(review["decision_reference"]), "cite the learner decision for this proposal")
    require(nonempty(review["reviewer"]) and isinstance(review["stages"], list)
            and len(review["stages"]) == len(drafts), "incomplete review")
    for stage in review["stages"]:
        require(nonempty(stage["quote"]) and stage["quote"] in case["passage"], "review quote outside passage")
    initial = judgment(attempt, 0)
    final = judgment(attempt, -1)
    repairs = review["repairs"]
    require(set(repairs) == {k for k in CRITERIA if initial[k] == "fail"}, "account for each initial defect")
    for key, outcome in repairs.items():
        require(outcome in ("fixed", "unresolved"), "invalid repair decision")
        if outcome == "fixed":
            require(len(drafts) == 2 and drafts[0] != drafts[1] and final[key] == "pass",
                    "repair credit requires a changed, passing revision")
    result.update(initial=initial, last_draft=final, repairs=repairs, learner_decision=decision)
    if status == "proposed":
        result["final"] = final
    return result


def compare(bundle):
    plan, records = bundle["plan"], bundle["records"]
    expected = prepare(plan)["records"]
    require(set(expected) == set(records), "record all planned cases, including missing runs")
    rows, counts = [], {key: Counter() for key in CRITERIA}
    totals = {arm: {"known_calls": 0, "unknown_cost_cases": 0, "statuses": Counter(),
                    "initial_defects": 0, "fixed": 0, "unresolved": 0,
                    "accepted_support": Counter()} for arm in ARMS}
    for case in plan["cases"]:
        key = case["id"]
        require(set(records[key]) == set(ARMS), "record both prompt conditions")
        pair = {}
        for arm in ARMS:
            result = score_attempt(records[key][arm], expected[key][arm], case, plan["settings"]["call_limit"])
            pair[arm] = result
            total = totals[arm]
            total["statuses"][result["status"]] += 1
            total["known_calls"] += result["calls"] or 0
            total["unknown_cost_cases"] += result["calls"] is None
            if result["learner_decision"] == "accepted":
                total["accepted_support"][result["final"]["support"]] += 1
            for outcome in result["repairs"].values():
                total["initial_defects"] += 1
                total[outcome] += 1
        changes = {}
        for criterion in CRITERIA:
            a, b = [(pair[arm]["final"] or {}).get(criterion) for arm in ARMS]
            if None in (a, b):
                change = "unscored"
            elif "uncertain" in (a, b):
                change = "uncertain"
            elif a == b:
                change = "both_" + a
            else:
                change = "gain" if b == "pass" else "regression"
            changes[criterion] = change
            counts[criterion][change] += 1
        rows.append({"case": key, "arms": pair, "paired": changes})
    return dict(kind=plan["kind"], rubric_sha256=APPROVED, plan_sha256=fingerprint(plan),
                planned_pairs=len(rows), criteria=counts, totals=totals, cases=rows)
