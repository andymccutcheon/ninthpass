"""Exercise the unchanged source helpers; no model calls or external packages."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1] / "skills/loop/scripts"
spec = importlib.util.spec_from_file_location("stage_control", SCRIPTS / "stage_control.py")
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)


class SourceHelpersTest(unittest.TestCase):
    def test_extract_preserves_utf8_crlf_and_rejects_bad_markers(self):
        body = "\r\nKeep café [TBD].\r\n".encode()
        self.assertEqual(control.extract_body(b"<!-- BEGIN BODY -->" + body + b"<!-- END BODY -->\nChecklist"), body)
        for bad in (b"", b"<!-- END BODY --><!-- BEGIN BODY -->", b"<!-- BEGIN BODY --><!-- END BODY --><!-- END BODY -->"):
            with self.assertRaises(ValueError):
                control.extract_body(bad)

    def test_decision_stop_cap_plateau_and_invalid_history(self):
        h = lambda scores: [{"score": n, "verdict": "CONTINUE"} for n in scores]
        self.assertEqual(control.next_action(h([7])), "BRIAN")
        self.assertEqual(control.next_action(h([8, 8])), "BRIAN")
        self.assertEqual(control.next_action(h([8, 8, 8])), "PAUSE_FOR_USER")
        self.assertEqual(control.next_action(h([5, 6, 7, 8])), "CAP_REPORT")
        self.assertEqual(control.next_action([{"score": 9, "verdict": "STOP"}]), "FINALIZE")
        for bad in ([], h([1, 2, 3, 4, 5]), [{"score": True, "verdict": "STOP"}], [{"score": 11, "verdict": "CONTINUE"}], [{"score": 9, "verdict": "STOP"}] + h([8])):
            with self.assertRaises(ValueError):
                control.next_action(bad)

    def test_exact_replace_all_or_nothing_and_no_normalization(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / "prompt.md"
            fixes = Path(root) / "fixes.json"
            original = b"Keep [TBD].\r\nKeep quotes.\r\n"
            for replacements, success in (([{"old": "[TBD]", "new": "[TODO]"}], True), ([{"old": "missing", "new": "x"}], False), ([{"old": "Keep", "new": "x"}], False), ([{"old": "[TBD]", "new": "x"}, {"old": "missing", "new": "x"}], False)):
                target.write_bytes(original)
                fixes.write_text(json.dumps(replacements))
                result = subprocess.run([sys.executable, str(SCRIPTS / "exact_replace.py"), str(target), str(fixes)], capture_output=True)
                self.assertEqual(result.returncode == 0, success)
                self.assertEqual(target.read_bytes(), original.replace(b"[TBD]", b"[TODO]") if success else original)

    def test_extract_cli_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as root:
            source, target = Path(root) / "revise.md", Path(root) / "final.md"
            source.write_bytes(b"<!-- BEGIN BODY -->exact\r\n<!-- END BODY -->")
            command = [sys.executable, str(SCRIPTS / "stage_control.py"), "extract", str(source), str(target)]
            self.assertEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertEqual(subprocess.run(command, capture_output=True).returncode, 1)
            self.assertEqual(target.read_bytes(), b"exact\r\n")


if __name__ == "__main__":
    unittest.main()
