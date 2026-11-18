"""Integration tests through the real HA HTTP server (pytest-homeassistant-custom-component)."""

import gzip

from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

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
    hass.bus.async_listen(f"{DOMAIN}_updated", lambda e: events.append(e.data["key"]))

    info = await (await client.get("/api/house_view/info")).json()
    assert info["has_scene"] is False and info["latitude"] == hass.config.latitude
    assert (await client.get("/api/house_view/scene")).status == 404

    assert (await client.post("/api/house_view/scene", json=SCENE)).status == 200
    got = await (await client.get("/api/house_view/scene")).json()
    assert got == SCENE

    assert (await client.post("/api/house_view/terrain", json=terrain())).status == 200
    assert (await client.post("/api/house_view/edits", json={"version": 1, "registration": {"rot": 12}})).status == 200
    info = await (await client.get("/api/house_view/info")).json()
    assert info["has_scene"] and info["has_terrain"] and info["has_edits"]
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
