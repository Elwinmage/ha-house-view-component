import pytest

from custom_components.house_view import card_bundle

HOUSE_RELEASES = "https://github.com/Elwinmage/house-catalog/releases/download"
SECTIONS = ("trees", "objects", "pond_fish", "paths", "terraces", "walls", "copings", "fences")


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations, hass, tmp_path):
    """Load the integration, with a config folder of its own per test (the catalog packs are written there)."""
    hass.config.config_dir = str(tmp_path / "config")


@pytest.fixture(autouse=True)
def catalog_offline(aioclient_mock):
    """No release of the catalog can be read: the built-in snapshot serves (tests wanting one serve it themselves)."""
    for section in SECTIONS:
        aioclient_mock.get(f"{HOUSE_RELEASES}/{section}-latest/manifest.json", status=404)


@pytest.fixture(autouse=True)
def bundle_read_at_once(monkeypatch):
    """The card bundle is read without waiting to see whether its file still changes."""
    monkeypatch.setattr(card_bundle, "SETTLE_DELAY", 0)
