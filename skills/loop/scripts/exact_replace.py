#!/usr/bin/env python3
"""Usage: exact_replace.py <target> <fixes.json>  (fixes: [{"old": ..., "new": ...}]; all-or-nothing)."""
import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", type=Path)
    parser.add_argument("fixes", type=Path)
    args = parser.parse_args()
    # Decode bytes directly so unrelated CRLFs and trailing whitespace survive.
    try:
        text = args.target.read_bytes().decode("utf-8")
        fixes = json.loads(args.fixes.read_bytes())
        if not isinstance(fixes, list) or not fixes:
            raise ValueError("fixes must be a nonempty list")
        for fix in fixes:
            if not isinstance(fix, dict) or set(fix) != {"old", "new"}:
                raise ValueError("each fix needs exactly old and new")
            if not isinstance(fix["old"], str) or not fix["old"]:
                raise ValueError("old must be a nonempty string")
            if not isinstance(fix["new"], str):
                raise ValueError("new must be a string")
    except (OSError, ValueError) as exc:
        print(f"STOP: {exc}; nothing written.")
        return 1

    for i, fix in enumerate(fixes, 1):
        count = text.count(fix["old"])
        if count != 1:
            print(f"STOP: fix {i} old string found {count} times (expected 1); nothing written.")
            print(f"old: {fix['old']!r}")
            return 1
        text = text.replace(fix["old"], fix["new"], 1)

    args.target.write_bytes(text.encode("utf-8"))
    for i, fix in enumerate(fixes, 1):
        print(f"APPLIED fix {i}\nbefore: {fix['old']!r}\nafter:  {fix['new']!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
