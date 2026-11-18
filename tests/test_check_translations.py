"""The translation checker must flag missing and unexpected keys."""

import importlib.util
import json
import pathlib

spec = importlib.util.spec_from_file_location(
    "check_translations", pathlib.Path(__file__).parents[1] / "scripts" / "check_translations.py"
)
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


def test_repository_is_consistent():
    assert check.main() == 0


def test_flatten():
    assert check.flatten({"a": {"b": 1, "c": {"d": 2}}, "e": 3}) == {"a.b", "a.c.d", "e"}


def test_detects_integration_mismatch(tmp_path, monkeypatch):
    (tmp_path / "en.json").write_text(json.dumps({"a": {"b": "x"}}))
    (tmp_path / "fr.json").write_text(json.dumps({"a": {"c": "y"}}))
    monkeypatch.setattr(check, "TRANSLATIONS", tmp_path)
    errors = check.check_integration()
    assert "fr.json: missing key a.b" in errors
    assert "fr.json: unexpected key a.c" in errors


def test_detects_card_mismatch(tmp_path, monkeypatch):
    i18n = tmp_path / "i18n.js"
    i18n.write_text("const T = {\n  fr: {\n    one: 'a',\n  },\n  en: {\n    one: 'a',\n    two: 'b',\n  },\n};\n")
    monkeypatch.setattr(check, "CARD_I18N", i18n)
    assert check.check_card() == ["card i18n fr: missing key two"]
    i18n.write_text("const T = {\n  fr: {\n    one: 'a',\n  },\n};\n")
    assert check.check_card() == ["card/src/i18n.js: no `en` block found"]
    i18n.write_text("const T = {\n  en: {\n    one: 'a',\n  },\n  fr: {\n    one: 'a',\n    zzz: 'b',\n  },\n};\n")
    assert check.check_card() == ["card i18n fr: unexpected key zzz"]


def test_main_reports_errors(monkeypatch, capsys):
    monkeypatch.setattr(check, "check_integration", lambda: ["boom"])
    monkeypatch.setattr(check, "check_card", list)
    assert check.main() == 1
    assert "boom" in capsys.readouterr().out
