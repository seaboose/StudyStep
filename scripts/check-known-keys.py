"""Check captured proposals against the frozen case definitions and known keys."""
import json
import sys
from pathlib import Path


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def inspect_run(folder, plan_path=None, keys_path=None, choices_path=None):
    examples = Path(__file__).resolve().parents[1] / "examples/prompt-comparison"
    expected = read(keys_path or examples / "known-keys.json")
    plan = read(plan_path or examples / "known-key-plan.json")
    destinations = read(choices_path) if choices_path else {}
    bundle = read(folder / "bundle.json")
    assert bundle["plan"]["cases"] == plan["cases"]
    assert bundle["plan"]["settings"]["seed"] == plan["settings"]["seed"]
    assert bundle["plan"]["prompts"] == plan["prompts"]
    rows = []
    for case in plan["cases"]:
        for arm, attempt in bundle["records"][case["id"]].items():
            directory = folder / case["id"] / arm
            outcome = read(directory / "outcome.json")
            questions = (outcome.get("proposal") or {}).get("questions", [])
            errors = []
            if len(questions) != 1:
                errors.append(outcome.get("error") or "Expected one proposed question.")
            for question in questions:
                choices = [option["text"] for option in question["options"]]
                key = choices[question["correctIndex"]]
                if key not in expected[case["id"]]:
                    errors.append("Wrong keyed answer: " + key)
                if not any(key in citation["quote"] and citation["quote"] in case["passage"]
                           for citation in question["citations"]):
                    errors.append("Missing exact source support.")
                if case["level"] == "apply":
                    wanted = destinations[case["id"]] if choices_path else ["amber tray", "violet tray", "Neither destination"]
                    if sorted(choices) != sorted(wanted):
                        errors.append("Destination choices are missing or redundant.")
                    if question["prompt"].rstrip(".") != case["goal"].rstrip("."):
                        errors.append("Prediction changed the specified operating condition.")
                elif not ("why " in question["prompt"].lower() and
                          key.casefold() not in question["prompt"].casefold()):
                    errors.append("Explanation stem lacks a why question or supplies the key.")
            calls = len(list(directory.glob("call-*.json")))
            assert calls == attempt["calls"]
            rows.append(dict(case=case["id"], prompt=arm, calls=calls, exceptions=errors))
    return rows


if __name__ == "__main__":
    folder = Path(sys.argv[1])
    rows = inspect_run(folder, *map(Path, sys.argv[2:]))
    output = json.dumps(rows, indent=2, ensure_ascii=False)
    (folder / "key-exceptions.json").write_text(output + "\n", encoding="utf-8")
    print(output)
    sys.exit(any(row["exceptions"] for row in rows))
