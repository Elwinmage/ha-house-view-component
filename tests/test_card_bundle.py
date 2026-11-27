"""The bundled card: a loader that follows the file on disk, and the open dashboards told when it changes."""

import hashlib
from datetime import timedelta

from homeassistant.setup import async_setup_component
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry, async_fire_time_changed

from custom_components import house_view
from custom_components.house_view import card_bundle
from custom_components.house_view.card_bundle import DATA_BUNDLE, WATCH_INTERVAL
from custom_components.house_view.const import DOMAIN


async def _setup(hass, tmp_path, monkeypatch, text="first build"):
    bundle = tmp_path / "house-view-card.js"
    bundle.write_text(text)
    monkeypatch.setattr(house_view, "FRONTEND_FILE", bundle)
    monkeypatch.setattr(house_view, "PREVIEW_FILE", tmp_path / "absent.jpg")
    assert await async_setup_component(hass, "http", {})
    assert await async_setup_component(hass, "websocket_api", {})
    entry = MockConfigEntry(domain=DOMAIN, data={})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return bundle


def _build(state, text):
    return f"{state.version}-{hashlib.sha256(text.encode()).hexdigest()[:8]}"


async def test_the_loader_follows_the_bundle_on_disk(hass, hass_client_no_auth, tmp_path, monkeypatch):
    """A bundle built again is the one the next refresh of the browser loads: no restart of Home Assistant."""
    bundle = await _setup(hass, tmp_path, monkeypatch)
    state = hass.data[DATA_BUNDLE]
    first = _build(state, "first build")
    assert state.build == first
    client = await hass_client_no_auth()  # the page loads it as it loads the bundle: without a session
    assert (
        await (await client.get("/api/house_view/card.js")).text()
        == f'import "/house_view/house-view-card.js?v={first}";\n'
    )
    # the bundle under the address of its fingerprint: kept by the browser, it will never change
    res = await client.get(f"/house_view/house-view-card.js?v={first}")
    assert res.headers["Content-Type"].startswith("text/javascript")
    assert (await res.text(), res.headers["Cache-Control"]) == ("first build", "public, max-age=31536000, immutable")
    # the card is built again: the loader names the new bundle, which is the one served
    bundle.write_text("second build, longer")
    second = _build(state, "second build, longer")
    assert (
        await (await client.get("/api/house_view/card.js")).text()
        == f'import "/house_view/house-view-card.js?v={second}";\n'
    )
    res = await client.get(f"/house_view/house-view-card.js?v={second}")
    assert (await res.text(), res.headers["Cache-Control"]) == (
        "second build, longer",
        "public, max-age=31536000, immutable",
    )
    # asked under the fingerprint of before, or under none: the bundle of now, not to be kept
    for address in (f"/house_view/house-view-card.js?v={first}", "/house_view/house-view-card.js"):
        res = await client.get(address)
        assert (await res.text(), res.headers["Cache-Control"]) == ("second build, longer", "no-cache")
    # a bundle that went away (an update half way): the loader says so, and loads nothing
    bundle.unlink()
    res = await client.get("/api/house_view/card.js")
    assert (res.status, await res.text()) == (200, "// House View: card bundle not found\n")
    assert state.build is None
    assert (await client.get("/house_view/house-view-card.js")).status == 404
    assert await state.async_refresh() is None  # still not there: nothing to read


async def test_a_bundle_being_copied_is_not_served_half_way(hass, hass_client_no_auth, tmp_path, monkeypatch):
    """What is served is what was fingerprinted: a file still changing waits for the next occasion."""
    bundle = await _setup(hass, tmp_path, monkeypatch)
    state = hass.data[DATA_BUNDLE]
    first = state.build
    client = await hass_client_no_auth()
    told = []
    stop = state.async_add_listener(lambda: told.append(state.build))
    # a copy in progress: the file grows between two looks, all the looks of this time
    sizes = iter(range(1, 1000))
    real = type(state)._signature
    monkeypatch.setattr(type(state), "_signature", lambda self: (0, next(sizes)))
    assert await state.async_refresh() == first
    assert (state.body, told) == (b"first build", [])
    assert await (await client.get(f"/house_view/house-view-card.js?v={first}")).text() == "first build"
    # the file changes while it is read: not taken either
    bundle.write_text("half")
    looks = iter([(1, 1), (1, 1), (1, 1), (2, 2)] + [(3, 3)] * 50)
    monkeypatch.setattr(type(state), "_signature", lambda self: next(looks))
    monkeypatch.setattr(card_bundle, "SETTLE_LOOKS", 1)
    assert await state.async_refresh() == first
    assert state.body == b"first build"
    # there, but it cannot be read yet: what was read before goes on being served
    monkeypatch.setattr(type(state), "_signature", real)
    with monkeypatch.context() as busy:
        busy.setattr(type(bundle), "read_bytes", lambda _self: (_ for _ in ()).throw(OSError("busy")))
        assert await state.async_refresh() == first
    assert (state.body, told) == (b"first build", [])
    # the copy is over: read, fingerprinted, and the cards are told
    bundle.write_text("second build, whole")
    second = _build(state, "second build, whole")
    assert await state.async_refresh() == second
    assert told == [second]
    # the same bundle copied again: another date, the same content, nothing to tell
    bundle.write_text("second build, whole")
    state._seen = None
    assert await state.async_refresh() == second
    assert told == [second]
    stop()


async def test_the_open_dashboards_are_told(hass, hass_ws_client, tmp_path, monkeypatch):
    """A card gets the fingerprint when it subscribes, and again when the bundle changes."""
    bundle = await _setup(hass, tmp_path, monkeypatch)
    state = hass.data[DATA_BUNDLE]
    first = _build(state, "first build")
    assert state._unwatch is None  # nobody listens: the file is left alone
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "house_view/card/subscribe"})
    assert (await ws.receive_json())["success"]
    assert (await ws.receive_json())["event"] == {"build": first}
    assert state._unwatch is not None
    # a second card on the page
    await ws.send_json({"id": 2, "type": "house_view/card/subscribe"})
    assert (await ws.receive_json())["success"]
    assert (await ws.receive_json())["event"] == {"build": first}
    # nothing changed: nothing is said
    async_fire_time_changed(hass, dt_util.utcnow() + WATCH_INTERVAL + timedelta(seconds=1))
    await hass.async_block_till_done(wait_background_tasks=True)
    # the card is built again: both hear of it at the next look at the file
    bundle.write_text("second build, longer")
    async_fire_time_changed(hass, dt_util.utcnow() + 2 * WATCH_INTERVAL + timedelta(seconds=2))
    await hass.async_block_till_done(wait_background_tasks=True)
    events = [await ws.receive_json(), await ws.receive_json()]
    assert {event["id"] for event in events} == {1, 2}
    assert [event["event"] for event in events] == [{"build": _build(state, "second build, longer")}] * 2
    # the cards go: the file is no longer watched
    await ws.send_json({"id": 3, "type": "unsubscribe_events", "subscription": 1})
    assert (await ws.receive_json())["success"]
    assert state._unwatch is not None  # one card left
    await ws.send_json({"id": 4, "type": "unsubscribe_events", "subscription": 2})
    assert (await ws.receive_json())["success"]
    assert state._unwatch is None
