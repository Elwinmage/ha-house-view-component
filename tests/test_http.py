"""Integration tests through the real HA HTTP server (pytest-homeassistant-custom-component)."""

import hashlib
import json
from pathlib import Path
from unittest.mock import patch

from homeassistant.core import callback
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components import house_view
from custom_components.house_view.const import DOMAIN

SCENE = {"levels": [{"id": "l0", "elevation": 0, "rooms": [{"id": "r1", "name": "Salon"}]}]}


def terrain():
    return {"version": 1, "origin": [0, 0], "step": 1, "nx": 3, "nz": 3, "z": [100.0] * 9, "center": [1, 1]}


async def _setup(hass, hass_client, hass_admin_user):
    assert await async_setup_component(hass, "http", {})
    entry = MockConfigEntry(domain=DOMAIN, data={})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return await hass_client()


async def test_roundtrip_and_events(hass, hass_client, hass_admin_user):
    client = await _setup(hass, hass_client, hass_admin_user)
    events = []

    @callback  # run in the event loop: a plain function goes to the thread pool, where the order is not guaranteed
    def _seen(event):
        events.append(event.data["key"])

    hass.bus.async_listen(f"{DOMAIN}_updated", _seen)

    info = await (await client.get("/api/house_view/info")).json()
    assert info["has_scene"] is False
    assert info["latitude"] == hass.config.latitude
    assert (await client.get("/api/house_view/scene")).status == 404

    assert (await client.post("/api/house_view/scene", json=SCENE)).status == 200
    got = await (await client.get("/api/house_view/scene")).json()
    assert got == SCENE

    assert (await client.post("/api/house_view/terrain", json=terrain())).status == 200
    assert (await client.post("/api/house_view/edits", json={"version": 1, "registration": {"rot": 12}})).status == 200
    info = await (await client.get("/api/house_view/info")).json()
    assert info["has_scene"]
    assert info["has_terrain"]
    assert info["has_edits"]
    await hass.async_block_till_done()
    assert events == ["scene", "terrain", "edits"]

    assert (await client.delete("/api/house_view/terrain")).status == 200
    assert (await client.get("/api/house_view/terrain")).status == 404


async def test_rejects_invalid(hass, hass_client, hass_admin_user):
    client = await _setup(hass, hass_client, hass_admin_user)
    r = await client.post("/api/house_view/scene", json={"levels": []})
    assert r.status == 400
    r = await client.post("/api/house_view/terrain", data=b"not json", headers={"Content-Type": "application/json"})
    assert r.status == 400
    bad = terrain()
    bad["z"] = [1.0]
    assert (await client.post("/api/house_view/terrain", json=bad)).status == 400
    assert (await client.get("/api/house_view/scene")).status == 404  # nothing stored by the failed calls


async def test_non_admin_cannot_write(hass, hass_client, hass_read_only_access_token):
    assert await async_setup_component(hass, "http", {})
    entry = MockConfigEntry(domain=DOMAIN, data={})
    entry.add_to_hass(hass)
    await hass.config_entries.async_setup(entry.entry_id)
    client = await hass_client(hass_read_only_access_token)
    assert (await client.post("/api/house_view/scene", json=SCENE)).status == 401
    assert (await client.get("/api/house_view/scene")).status == 404  # reading is allowed (nothing stored)


async def test_persistence_across_reload(hass, hass_client, hass_admin_user):
    client = await _setup(hass, hass_client, hass_admin_user)
    await client.post("/api/house_view/scene", json=SCENE)
    entry = hass.config_entries.async_entries(DOMAIN)[0]
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert await (await client.get("/api/house_view/scene")).json() == SCENE


async def test_unloaded_entry_answers_404(hass, hass_client, hass_admin_user):
    client = await _setup(hass, hass_client, hass_admin_user)
    entry = hass.config_entries.async_entries(DOMAIN)[0]
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert (await client.get("/api/house_view/info")).status == 404


async def test_config_flow_one_entry_per_home(hass):
    """Each home has a name (unique) and a location, and its own storage."""
    # the homes created are not set up here: the flow is tested alone
    with patch("custom_components.house_view.async_setup_entry", return_value=True):
        r = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
        assert r["type"] == "form"
        r = await hass.config_entries.flow.async_configure(r["flow_id"], {"name": " "})
        assert r["errors"] == {"name": "name_required"}
        r = await hass.config_entries.flow.async_configure(
            r["flow_id"], {"name": "Maison", "location": {"latitude": 1.5, "longitude": 2.5, "radius": 100}}
        )
        assert r["type"] == "create_entry"
        assert r["title"] == "Maison"
        assert r["data"]["location"] == {"latitude": 1.5, "longitude": 2.5}
        first = r["data"]["storage"]
        r = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
        r = await hass.config_entries.flow.async_configure(r["flow_id"], {"name": "Maison"})
        assert r["errors"] == {"name": "name_taken"}
        r = await hass.config_entries.flow.async_configure(r["flow_id"], {"name": "Chalet"})
        assert r["type"] == "create_entry"
        assert r["data"]["location"] == {"latitude": hass.config.latitude, "longitude": hass.config.longitude}
        assert r["data"]["storage"] != first


async def test_homes_are_kept_apart(hass, hass_client, hass_admin_user):
    """Two homes: each request names its home (?home=<entry id>); without it, the first home answers."""
    assert await async_setup_component(hass, "http", {})
    old = MockConfigEntry(domain=DOMAIN, title="Maison", data={})  # set up before homes existed: original storage
    chalet = MockConfigEntry(
        domain=DOMAIN,
        title="Chalet",
        data={"storage": "house_view.chalet", "location": {"latitude": 45, "longitude": 6}},
    )
    for e in (old, chalet):
        e.add_to_hass(hass)
        assert await hass.config_entries.async_setup(e.entry_id)
    await hass.async_block_till_done()
    client = await hass_client()
    homes = await (await client.get("/api/house_view/homes")).json()
    assert homes == [{"id": old.entry_id, "title": "Maison"}, {"id": chalet.entry_id, "title": "Chalet"}]

    events = []
    hass.bus.async_listen(f"{DOMAIN}_updated", callback(lambda e: events.append((e.data["key"], e.data["home"]))))
    assert (await client.post(f"/api/house_view/scene?home={chalet.entry_id}", json=SCENE)).status == 200
    assert (await client.get("/api/house_view/scene")).status == 404  # the first home has none
    assert await (await client.get(f"/api/house_view/scene?home={chalet.entry_id}")).json() == SCENE
    assert (await client.get("/api/house_view/scene?home=nope")).status == 404
    info = await (await client.get(f"/api/house_view/info?home={chalet.entry_id}")).json()
    assert (info["home"], info["title"], info["latitude"], info["longitude"]) == (chalet.entry_id, "Chalet", 45, 6)
    info = await (await client.get("/api/house_view/info")).json()
    assert (info["home"], info["latitude"]) == (old.entry_id, hass.config.latitude)
    await hass.async_block_till_done()
    assert events == [("scene", chalet.entry_id)]

    # a renamed home; a deleted home takes its documents along, the other keeps them
    hass.config_entries.async_update_entry(old, title="Maison principale")
    await hass.async_block_till_done()
    assert (await (await client.get("/api/house_view/homes")).json())[0]["title"] == "Maison principale"
    assert (await client.post("/api/house_view/scene", json=SCENE)).status == 200
    assert await hass.config_entries.async_remove(chalet.entry_id)
    await hass.async_block_till_done()
    assert [h["id"] for h in await (await client.get("/api/house_view/homes")).json()] == [old.entry_id]
    assert await (await client.get("/api/house_view/scene")).json() == SCENE
    assert await hass.config_entries.async_remove(old.entry_id)
    await hass.async_block_till_done()
    assert await (await client.get("/api/house_view/homes")).json() == []


async def test_card_bundle_is_served(hass, hass_client, tmp_path, monkeypatch):
    """The card built from /card is served by the integration, at a URL loaded on every dashboard.

    The URL carries the version and a digest of the bundle: building the card again changes it, so that the
    browser never keeps the previous bundle.
    """
    bundle = tmp_path / "house-view-card.js"
    bundle.write_text("console.log('card');")
    monkeypatch.setattr(house_view, "FRONTEND_FILE", bundle)
    hass.config.components.add("frontend")  # pretend the frontend is loaded
    added = []
    monkeypatch.setattr(house_view, "add_extra_js_url", lambda _hass, url: added.append(url))
    assert await async_setup_component(hass, "http", {})
    entry = MockConfigEntry(domain=DOMAIN, data={})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    client = await hass_client()
    res = await client.get("/house_view/house-view-card.js")
    assert res.status == 200
    assert "console.log('card')" in await res.text()
    digest = hashlib.sha256(b"console.log('card');").hexdigest()[:8]
    manifest = Path(house_view.__file__).parent / "manifest.json"
    version = json.loads(manifest.read_text(encoding="utf-8"))["version"]  # not hard-coded: it changes at each release
    assert added == [f"/house_view/house-view-card.js?v={version}-{digest}"]


async def test_missing_bundle_is_not_fatal(hass, hass_client, hass_admin_user, caplog, tmp_path, monkeypatch):
    """Without the built card the integration still works and says why in the log."""
    monkeypatch.setattr(house_view, "FRONTEND_FILE", tmp_path / "absent.js")
    await _setup(hass, hass_client, hass_admin_user)
    assert "card bundle not found" in caplog.text


async def test_bundle_served_without_frontend(hass, hass_client, tmp_path, monkeypatch):
    """Headless setups (no frontend component): the bundle is served but no extra JS URL is registered."""
    bundle = tmp_path / "house-view-card.js"
    bundle.write_text("x")
    monkeypatch.setattr(house_view, "FRONTEND_FILE", bundle)
    added = []
    monkeypatch.setattr(house_view, "add_extra_js_url", lambda _hass, url: added.append(url))
    assert await async_setup_component(hass, "http", {})
    entry = MockConfigEntry(domain=DOMAIN, data={})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    assert added == []


async def test_writes_on_unloaded_entry_and_non_admin_delete(
    hass, hass_client, hass_admin_user, hass_read_only_access_token
):
    client = await _setup(hass, hass_client, hass_admin_user)
    await client.post("/api/house_view/scene", json=SCENE)
    reader = await hass_client(hass_read_only_access_token)
    assert (await reader.delete("/api/house_view/scene")).status == 401
    assert (await client.get("/api/house_view/scene")).status == 200  # still there
    entry = hass.config_entries.async_entries(DOMAIN)[0]
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert (await client.post("/api/house_view/scene", json=SCENE)).status == 404
    assert (await client.delete("/api/house_view/scene")).status == 404
    assert (await client.get("/api/house_view/scene")).status == 404


async def test_document_too_large(hass, hass_client, hass_admin_user):
    client = await _setup(hass, hass_client, hass_admin_user)
    big = b'{"levels": [], "pad": "' + b"x" * (15 * 1024 * 1024 + 10) + b'"}'
    res = await client.post("/api/house_view/scene", data=big, headers={"Content-Type": "application/json"})
    assert res.status == 413


async def test_serialized_form_is_cached_and_refreshed(hass, hass_client, hass_admin_user):
    client = await _setup(hass, hass_client, hass_admin_user)
    await client.post("/api/house_view/scene", json=SCENE)
    store = next(iter(hass.data[DOMAIN].values()))
    first = store.get_bytes("scene")
    assert store.get_bytes("scene") is first  # cached
    other = {"levels": [{"id": "l1", "elevation": 2.5, "rooms": []}]}
    await client.post("/api/house_view/scene", json=other)
    assert await (await client.get("/api/house_view/scene")).json() == other


async def test_demo_home(hass, hass_client, hass_admin_user, hass_read_only_access_token, monkeypatch):
    """The card asks for the demo home: created once with the shipped documents, put back as shipped next time."""
    client = await _setup(hass, hass_client, hass_admin_user)
    reader = await hass_client(hass_read_only_access_token)
    assert (await reader.post("/api/house_view/demo")).status == 401
    assert (await reader.get("/api/house_view/demo")).status == 401

    r = await client.post("/api/house_view/demo")
    assert r.status == 200
    home = (await r.json())["home"]
    await hass.async_block_till_done()
    entry = hass.config_entries.async_get_entry(home)
    assert entry.title == "Démo"
    assert entry.data["demo"] is True
    assert entry.data["location"] == {"latitude": 45.0, "longitude": 2.0}
    info = await (await client.get(f"/api/house_view/info?home={home}")).json()
    assert info["demo"] is True
    assert (info["has_scene"], info["has_terrain"], info["has_edits"]) == (False, False, True)  # flat, no plan
    assert (info["latitude"], info["longitude"]) == (45.0, 2.0)
    assert (await (await client.get("/api/house_view/info")).json())["demo"] is False  # the first home

    # the plan of the house, imported by the card
    house = await (await client.get("/api/house_view/demo")).read()
    assert house[:2] == b"PK"

    # the terrain fetch of the demo home: its steps, then the fictitious terrain centred on the plan (no network)
    monkeypatch.setattr(house_view.http, "DEMO_PACE", 0)
    params = {"lat": 45, "lon": 2, "center": [10, 5]}
    r = await client.post(f"/api/house_view/fetch?home={home}", json=params)
    assert r.status == 202
    for _ in range(50):
        await hass.async_block_till_done()
        job = await (await client.get(f"/api/house_view/fetch?home={home}")).json()
        if job["state"] == "done":
            break
    assert job["state"] == "done"
    got = await (await client.get(f"/api/house_view/terrain?home={home}")).json()
    assert got["center"] == [10, 5]
    assert got["s"]

    # a second time: the same home, its plan and terrain dropped (imported, fetched again), its edits as shipped
    assert (await client.post(f"/api/house_view/scene?home={home}", json=SCENE)).status == 200
    assert (await client.post(f"/api/house_view/edits?home={home}", json={"version": 1})).status == 200
    r = await client.post("/api/house_view/demo")
    assert (await r.json())["home"] == home
    assert len(hass.config_entries.async_entries(DOMAIN)) == 2
    info = await (await client.get(f"/api/house_view/info?home={home}")).json()
    assert info["has_scene"] is False
    assert info["has_terrain"] is False
    assert info["fetch"] == {"state": "idle"}
    edits = await (await client.get(f"/api/house_view/edits?home={home}")).json()
    assert edits["pools"]

    # a second demo entry is refused by the flow
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "demo"})
    assert result["type"] == "abort"
    assert result["reason"] == "demo_exists"

    # the demo entry not loaded (yet): the card is told to try again
    await hass.config_entries.async_unload(home)
    await hass.async_block_till_done()
    assert (await client.post("/api/house_view/demo")).status == 409
