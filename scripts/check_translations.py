#!/usr/bin/env python3
"""Check that every locale file has exactly the keys of en.json, and that the card has the same keys in each language.

Run by pre-commit and CI. Exit code 1 on any mismatch.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRANSLATIONS = ROOT / "custom_components" / "house_view" / "translations"
CARD_I18N = ROOT / "card" / "src" / "i18n.js"


def flatten(doc: dict, prefix: str = "") -> set[str]:
    """Dotted key paths of a nested dict."""
    keys: set[str] = set()
    for k, v in doc.items():
        path = f"{prefix}.{k}" if prefix else k
        keys |= flatten(v, path) if isinstance(v, dict) else {path}
    return keys


def check_integration() -> list[str]:
    errors: list[str] = []
    reference = flatten(json.loads((TRANSLATIONS / "en.json").read_text(encoding="utf-8")))
    for path in sorted(TRANSLATIONS.glob("*.json")):
        keys = flatten(json.loads(path.read_text(encoding="utf-8")))
        for missing in sorted(reference - keys):
            errors.append(f"{path.name}: missing key {missing}")
        for extra in sorted(keys - reference):
            errors.append(f"{path.name}: unexpected key {extra}")
    return errors


def check_card() -> list[str]:
    """Keys of each language block of card/src/i18n.js (`  fr: {` ... `  },`)."""
    text = CARD_I18N.read_text(encoding="utf-8")
    blocks = {
        m.group(1): set(re.findall(r"^\s{4}(\w+):", m.group(2), re.M))
        for m in re.finditer(r"^\s{2}(\w+): \{\n(.*?)^\s{2}\},", text, re.M | re.S)
    }
    if "en" not in blocks:
        return ["card/src/i18n.js: no `en` block found"]
    errors: list[str] = []
    for lang, keys in blocks.items():
        for missing in sorted(blocks["en"] - keys):
            errors.append(f"card i18n {lang}: missing key {missing}")
        for extra in sorted(keys - blocks["en"]):
            errors.append(f"card i18n {lang}: unexpected key {extra}")
    return errors


def main() -> int:
    errors = check_integration() + check_card()
    for e in errors:
        print(e)
    if not errors:
        print("translations OK")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
