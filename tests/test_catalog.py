"""Trees and objects of the catalog: served to the card, updated from the releases of house-catalog."""

import hashlib
import io
import json
import zipfile
from pathlib import Path

from homeassistant.helpers import entity_registry as er
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.house_view import catalog, catalog_pack, house_catalog_sections
from custom_components.house_view.const import DOMAIN

from .conftest import HOUSE_RELEASES

BUILTIN = Path(catalog.__file__).parent


async def _setup(hass):
    assert await async_setup_component(hass, "http", {})
    entry = MockConfigEntry(domain=DOMAIN, data={})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done(wait_background_tasks=True)
    return entry


async def _catalog(ws, section=None, **extra):
    await ws.send_json_auto_id({"type": f"{DOMAIN}/catalog", **({"section": section} if section else {}), **extra})
    reply = await ws.receive_json()
    assert reply["success"], reply
    return reply["result"]


def _release(aioclient_mock, section, kind, version, entries):
    """Serve a release of a section holding `entries` (id -> descriptor)."""
    records = {}
    for name, data in entries.items():
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr(f"{kind}.json", json.dumps(data))
        blob = buffer.getvalue()
        archive_name = f"{section}-{version}/{kind}.{name}.zip"
        records[f"{kind}.{name}"] = {
            "kind": kind,
            "content_hash": hashlib.sha256(json.dumps(data).encode()).hexdigest(),
            "archive": archive_name,
            "sha256": hashlib.sha256(blob).hexdigest(),
            "size": len(blob),
            "since": version,
        }
        aioclient_mock.get(f"{HOUSE_RELEASES}/{archive_name}", content=blob)
    manifest = {
        "format": 1,
        "section": section,
        "version": version,
        "min_integration": {"house_view": "0.1.0"},
        "notes": f"# {section} {version}",
        "entries": records,
    }
    aioclient_mock.get(f"{HOUSE_RELEASES}/{section}-latest/manifest.json", text=json.dumps(manifest))


def test_the_specs_read_the_house_catalog():
    assert [spec.section for spec in catalog.CATALOGS] == ["trees", "objects", "fish"]
    assert {spec.repository for spec in catalog.CATALOGS} == {"Elwinmage/house-catalog"}
    # the client knows no house: its sections are declared from what house-catalog says of itself
    assert dict.fromkeys(house_catalog_sections.SECTIONS, house_catalog_sections.REPO) == catalog_pack.SECTION_REPOS
    assert catalog_pack.KIND_LAYOUT["tree"] == ("items", "tree.json")
    assert catalog_pack.SECTION_KINDS["objects"] == frozenset({"object"})
    assert catalog_pack.repo_of("equipment") == catalog_pack.REPO
    assert (catalog.TREES.suffix, catalog.OBJECTS.suffix, catalog.FISH.suffix) == ("", "_objects", "_fish")
    assert catalog_pack.SECTION_KINDS["fish"] == frozenset({"fish"})
    # the built-in snapshots are where the client looks for them
    assert (BUILTIN / "catalog_builtin/items/oak/tree.json").is_file()
    assert (BUILTIN / "catalog_builtin_objects/items/chair/object.json").is_file()
    assert (BUILTIN / "catalog_builtin_fish/items/koi/fish.json").is_file()


async def test_offline_the_builtin_catalog_is_served(hass, hass_ws_client, hass_client):
    entry = await _setup(hass)
    ws = await hass_ws_client(hass)

    trees = await _catalog(ws)  # the first section answers by default
    assert trees["section"] == "trees"
    items = trees["data"]["items"]
    assert {"oak", "pine", "yew", "cherry-tree", "apricot-tree"} <= set(items)
    oak = items["oak"]
    assert (oak["source"], oak["shape"], oak["name"]["fr"]) == ("builtin", "round", "Chêne")
    assert set(oak["seasons"]) == {"spring", "summer", "autumn", "winter"}
    assert oak["thumb"].startswith("/house_view_catalog/builtin/items/oak/thumb.webp")

    objects = await _catalog(ws, "objects")
    chair = objects["data"]["items"]["chair"]
    assert (chair["source"], len(chair["parts"])) == ("builtin", 7)
    assert chair["image"].startswith("/house_view_catalog_objects/builtin/items/chair/image.webp")

    # the pictures are public catalog data, served without a session
    client = await hass_client()
    for url in (oak["thumb"], chair["image"]):
        picture = await client.get(url.split("?")[0])
        assert picture.status == 200
        assert (await picture.read())[:4] == b"RIFF"

    # one device: an update per section, one automatic update switch, one "update now" button
    registry = er.async_get(hass)
    entities = sorted(e.entity_id.split(".")[0] for e in er.async_entries_for_config_entry(registry, entry.entry_id))
    assert entities == ["button", "switch", "update", "update", "update"]

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    await ws.send_json_auto_id({"type": f"{DOMAIN}/catalog"})
    assert (await ws.receive_json())["success"] is False


async def test_a_release_and_the_entries_of_the_user_are_merged(hass, hass_ws_client, aioclient_mock):
    aioclient_mock.clear_requests()
    birch = {"name": {"en": "Birch"}, "shape": "round", "evergreen": False}
    _release(aioclient_mock, "trees", "tree", "2026.12.0", {"birch": birch})
    _release(aioclient_mock, "objects", "object", "2026.12.0", {"table": {"name": {"en": "Table"}, "parts": []}})
    aioclient_mock.get(f"{HOUSE_RELEASES}/fish-latest/manifest.json", status=404)
    # an entry saved with the catalog editor: the shared user layer
    mine = Path(hass.config.path("reeftech_catalog/user/trees/items/my-fig/tree.json"))
    await hass.async_add_executor_job(lambda: mine.parent.mkdir(parents=True))
    await hass.async_add_executor_job(mine.write_text, json.dumps({"name": {"en": "My fig"}, "shape": "round"}))

    await _setup(hass)
    ws = await hass_ws_client(hass)
    trees = await _catalog(ws, "trees", refresh=True)
    assert trees["version"] == "2026.12.0"
    items = trees["data"]["items"]
    # three layers, the later one winning on an id: built-in snapshot, release, entries of the user
    assert [items[name]["source"] for name in ("oak", "birch", "my-fig")] == ["builtin", "pack", "user"]
    objects = await _catalog(ws, "objects")
    assert sorted(objects["data"]["items"]) == ["chair", "table"]
    # the fish: no release yet, the built-in snapshot serves
    fish = await _catalog(ws, "fish")
    assert fish["data"]["items"]["koi"]["source"] == "builtin"
