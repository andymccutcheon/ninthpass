#!/usr/bin/env python3
"""Extract a BODY or enforce orchestration bookkeeping; never generate or score."""

import argparse
import json
import sys
from pathlib import Path

BEGIN = b"<!-- BEGIN BODY -->"
END = b"<!-- END BODY -->"


def extract_body(data: bytes) -> bytes:
    """Keep strictly interior bytes, including their original line endings."""
    if data.count(BEGIN) != 1 or data.count(END) != 1:
        raise ValueError("each BODY marker must occur exactly once")
    start = data.index(BEGIN) + len(BEGIN)
    finish = data.index(END)
    if start > finish:
        raise ValueError("BEGIN BODY must precede END BODY")
    return data[start:finish]


def next_action(history: list[dict]) -> str:
    """Receive Judge decisions, in order, with retries replacing their pass."""
    if not isinstance(history, list) or not history:
        raise ValueError("history must contain at least one Judge decision")
    for decision in history:
        if not isinstance(decision, dict):
            raise ValueError("each history entry must be a decision object")
        if decision.get("verdict") not in {"STOP", "CONTINUE"}:
            raise ValueError("Judge verdict must be STOP or CONTINUE")
        score = decision.get("score")
        if isinstance(score, bool) or not isinstance(score, (int, float)):
            raise ValueError("each Judge decision needs a numeric score")
        if not 0 <= score <= 10:
            raise ValueError("Judge score must be finite and within 0-10")
    if any(decision["verdict"] == "STOP" for decision in history[:-1]):
        raise ValueError("history continued after Judge said STOP")
    if len(history) > 4:
        raise ValueError("history exceeded four scoring rounds")
    # The Judge verdict governs, not a numeric threshold invented by this helper.
    if history[-1]["verdict"] == "STOP":
        return "FINALIZE"
    if len(history) == 4:
        return "CAP_REPORT"
    if len(history) >= 3 and history[-1]["score"] <= history[-2]["score"]:
        return "PAUSE_FOR_USER"
    return "BRIAN"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    extract = commands.add_parser("extract")
    extract.add_argument("source", type=Path)
    extract.add_argument("destination", type=Path)
    decide = commands.add_parser("decide")
    decide.add_argument("history", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "extract":
            body = extract_body(args.source.read_bytes())
            with args.destination.open("xb") as target:
                target.write(body)
            print(f"EXTRACTED: {args.destination}")
        else:
            print(next_action(json.loads(args.history.read_bytes())))
    except (OSError, ValueError) as exc:
        print(f"STOP: {exc}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
