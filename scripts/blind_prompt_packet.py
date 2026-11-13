"""Create a blind worksheet from a locked StudyStep comparison bundle."""

import argparse
import json
import secrets
from pathlib import Path

from paired_scorecard import CRITERIA, RUBRIC, compare, fingerprint


def make_packet(bundle_path):
    bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
    report = compare(bundle)
    rubric = json.loads(RUBRIC.read_text(encoding="utf-8"))
    histories = []
    for case, result in zip(bundle["plan"]["cases"], report["cases"]):
        for arm, attempt in bundle["records"][case["id"]].items():
            if attempt["status"] == "pending":
                raise ValueError("Finish capture before preparing the worksheet.")
            if attempt["drafts"]:
                histories.append((case, arm, attempt["drafts"], result["arms"][arm]["attempt_sha256"]))
    if not histories:
        raise ValueError("No assembled drafts available for blind review.")
    secrets.SystemRandom().shuffle(histories)
    lines = ["# StudyStep blind scoring worksheet", "",
             "Reviewer alias ____________________", "",
             "Score each version independently. Use **pass**, **fail**, or **uncertain** for each criterion. "
             "Give a short reason and copy an exact excerpt from the frozen passage for each version. "
             "Keep the review IDs when returning your scores.", "", "## Approved rubric v1", ""]
    for criterion, description in rubric["criteria"].items():
        lines.extend([f"- **{criterion.title()}** — {description}"])
    lines.extend(["", rubric["judgments"], "", rubric["repair"], ""])
    key = {"bundle_sha256": fingerprint(bundle), "items": {}}
    for case, arm, drafts, digest in histories:
        label = secrets.token_hex(4).upper()
        while label in key["items"]:
            label = secrets.token_hex(4).upper()
        key["items"][label] = {"case": case["id"], "arm": arm, "attempt_sha256": digest}
        level = {"apply": "Application", "explain": "Explanation", "foundation": "Foundation"}[case["level"]]
        lines.extend([f"## Review {label}", "", f"**Target** — {level}. {case['goal']}", "",
                      "**Frozen passage**", "", case["passage"], "", "**Prior questions**", ""])
        lines.extend("- " + question for question in case["previous_questions"])
        for draft in drafts:
            stage = "Initial draft" if draft["writer_attempt"] == 1 else "Revision"
            lines.extend(["", f"### {stage}", "", draft["question"], ""])
            lines.extend(f"{chr(65 + i)}. {option}" for i, option in enumerate(draft["options"]))
            lines.extend(["", "**Keyed answer** — " + draft["answer"],
                          "", "**Draft citation** — " + draft["citation"], ""])
            lines.extend([f"- {criterion.title()} rating __________" for criterion in CRITERIA])
            lines.extend(["- Reason for ratings ________________________________________",
                          "- Exact passage excerpt _____________________________________"])
        lines.extend(["", "**Repair decision** — For each failed initial criterion, enter its name, "
                      "the original defect, and fixed or unresolved. A failure without a revision is unresolved. "
                      "Leave blank if there were no initial failures.", "",
                      "_________________________________________________________________", ""])
    folder = bundle_path.parent
    # Refuse to overwrite an issued worksheet or silently rotate its key.
    with (folder / "private-review-key.json").open("x", encoding="utf-8") as handle:
        json.dump(key, handle, indent=2)
    with (folder / "blind-scoring.md").open("x", encoding="utf-8") as handle:
        handle.write("\n".join(lines))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    make_packet(parser.parse_args().bundle)
