"""Summarize historical StudyStep runs or replay a saved paired prompt comparison."""

import argparse
import hashlib
import json
from pathlib import Path

from paired_scorecard import compare, prepare


def read_record(path):
    data = path.read_bytes()
    return json.loads(data), hashlib.sha256(data).hexdigest()


def summarize(directory, call_limit):
    run, summary_hash = read_record(directory / "summary.json")
    audit_path = directory / "content-audit.json"
    audit, audit_hash = read_record(audit_path) if audit_path.exists() else ({}, None)
    batches = run.get("batches", [])
    counts = [batch.get("modelCalls") for batch in batches]
    if any(type(n) is not int or n < 0 for n in counts):
        raise ValueError(f"{directory}: invalid batch model-call count")
    return {
        "run": run["runId"],
        "topic": run.get("topic"),
        "model": run.get("model"),
        "seed": run.get("seed"),
        "workflow_status": run["status"],
        "content_status": audit.get("status", "unreviewed"),
        "findings": audit.get("findings", []),
        "limitations": audit.get("limitations", []),
        "batch_count": len(counts),
        "reported_model_calls": run.get("modelCalls"),
        "batches_over_budget": [
            batch["number"] for batch, count in zip(batches, counts) if count > call_limit
        ],
        "budget_status": ("unknown" if not counts else
                          "exceeded" if max(counts) > call_limit else "within"),
        "summary_sha256": summary_hash,
        "audit_sha256": audit_hash,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("runs", nargs="*", type=Path)
    parser.add_argument("--paired", type=Path, metavar="BUNDLE",
                        help="replay a saved prompt comparison offline")
    parser.add_argument("--prepare", type=Path, metavar="PLAN",
                        help="emit an empty paired bundle for a frozen experiment plan")
    parser.add_argument("--call-limit", type=int, default=12, help="model calls per task batch")
    args = parser.parse_args()
    if sum(map(bool, (args.runs, args.paired, args.prepare))) != 1:
        parser.error("provide run directories, --paired BUNDLE or --prepare PLAN")
    if args.call_limit < 1:
        parser.error("--call-limit must be positive")
    try:
        if args.prepare:
            plan, _ = read_record(args.prepare)
            report = prepare(plan)
        elif args.paired:
            bundle, digest = read_record(args.paired)
            report = compare(bundle)
            report["bundle_sha256"] = digest
        else:
            rows = sorted((summarize(d, args.call_limit) for d in args.runs), key=lambda r: r["run"])
            report = {"call_limit_per_batch": args.call_limit, "runs": rows}
    except (OSError, ValueError, KeyError, TypeError, IndexError, AttributeError) as error:
        parser.exit(2, f"Could not read evaluation: {error}\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
