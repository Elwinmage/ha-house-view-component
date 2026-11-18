"""Integration tests through the real HA HTTP server (pytest-homeassistant-custom-component)."""

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


async def test_config_flow_single_instance(hass):
    r = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    assert r["type"] == "form"
    r = await hass.config_entries.flow.async_configure(r["flow_id"], {})
    assert r["type"] == "create_entry"
    r2 = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    assert r2["type"] == "abort"


async def test_card_bundle_is_served(hass, hass_client, tmp_path, monkeypatch):
    """The card built from /card is served by the integration, at a versioned URL loaded on every dashboard."""
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
    assert added == ["/house_view/house-view-card.js?v=0.1.0"]


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
    store = hass.data[DOMAIN]
    first = store.get_bytes("scene")
    assert store.get_bytes("scene") is first  # cached
    other = {"levels": [{"id": "l1", "elevation": 2.5, "rooms": []}]}
    await client.post("/api/house_view/scene", json=other)
    assert await (await client.get("/api/house_view/scene")).json() == other
