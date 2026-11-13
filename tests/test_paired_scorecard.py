import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / "examples/prompt-comparison"
sys.path.insert(0, str(ROOT / "scripts"))
from paired_scorecard import compare, fingerprint, prepare


class ScorecardTests(unittest.TestCase):
    def setUp(self):
        self.bundle = json.loads((EXAMPLES / "control.json").read_text(encoding="utf-8"))
        self.arm = self.bundle["records"]["vent"]["candidate"]

    def test_saved_control(self):
        report = compare(self.bundle)
        self.assertEqual(report["criteria"]["challenge"], {"gain": 1, "unscored": 1})
        self.assertEqual(report["criteria"]["novelty"], {"uncertain": 1, "unscored": 1})
        self.assertEqual(report["totals"]["candidate"]["fixed"], 2)
        self.assertEqual(report["totals"]["candidate"]["known_calls"], 6)

    def test_changes_require_new_records_and_decisions(self):
        self.arm["drafts"][0]["answer"] += " Changed."
        with self.assertRaisesRegex(ValueError, "stale review"):
            compare(self.bundle)
        self.bundle["plan"]["settings"]["seed"] = 7
        with self.assertRaisesRegex(ValueError, "mismatched"):
            compare(self.bundle)

    def test_regression_and_explicit_learner_decision(self):
        draft = self.arm["drafts"][-1]
        draft["answer"] = "Closing the vent releases warm air."
        review = self.arm.pop("review")
        review.update(attempt_sha256=fingerprint(self.arm), learner_decision="accepted",
                      decision_reference="synthetic learner receipt")
        review["stages"][-1].update(reason="The changed key reverses the cited relationship.")
        review["stages"][-1]["ratings"]["support"] = "fail"
        self.arm["review"] = review
        with self.assertRaisesRegex(ValueError, "repair credit"):
            compare(self.bundle)
        review["repairs"]["support"] = "unresolved"
        report = compare(self.bundle)
        self.assertEqual(report["criteria"]["support"]["regression"], 1)
        self.assertEqual(report["totals"]["candidate"]["accepted_support"], {"fail": 1})

    def test_prepared_plan_has_no_observations(self):
        plan = json.loads((EXAMPLES / "plan.json").read_text(encoding="utf-8"))
        bundle = prepare(plan)
        report = compare(bundle)
        self.assertEqual(report["totals"]["baseline"]["unknown_cost_cases"], len(plan["cases"]))
        self.assertEqual(report["criteria"]["support"], {"unscored": len(plan["cases"])})
        del bundle["records"][plan["cases"][0]["id"]]["candidate"]
        with self.assertRaisesRegex(ValueError, "both prompt"):
            compare(bundle)

    def test_cli_rejects_invalid_bundle_with_no_partial_score(self):
        self.arm["calls"] = 13
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "bad.json"
            file.write_text(json.dumps(self.bundle), encoding="utf-8")
            command = [sys.executable, "-B", str(ROOT / "scripts/run_scorecard.py"), "--paired", str(file)]
            result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertFalse(result.stdout)


if __name__ == "__main__":
    unittest.main()
