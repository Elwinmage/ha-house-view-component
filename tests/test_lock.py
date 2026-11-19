"""Edit lock: password hash, unlock tokens, enforcement on the HTTP writes, options flow."""

import json

from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.house_view.const import (
    CONF_LOCK,
    DOMAIN,
    UNLOCK_HEADER,
    UNLOCK_MAX_FAILURES,
    UNLOCK_PENALTY,
    UNLOCK_TTL,
)
from custom_components.house_view.lock import Unlocks, hash_password, verify_password

FAST = 1000  # PBKDF2 iterations: enough for the tests
PASSWORD = "s3same"
LOCK = hash_password(PASSWORD, iterations=FAST)
GITHUB = {"repo": "me/house", "token": "t0k", "branch": "main", "path": "house_view"}
SCENE = {"levels": [{"id": "l0", "elevation": 0, "rooms": []}]}
API = "/api/house_view"


def test_hash_and_verify():
    assert set(LOCK) == {"salt", "hash", "iterations"}
    assert PASSWORD not in json.dumps(LOCK)
    assert verify_password(LOCK, PASSWORD)
    assert not verify_password(LOCK, "S3same")
    assert hash_password(PASSWORD, iterations=FAST)["hash"] != LOCK["hash"]  # a new salt each time
    assert hash_password(PASSWORD, LOCK["salt"], FAST) == LOCK
    for damaged in ({}, {**LOCK, "salt": "zz"}, {**LOCK, "iterations": "x"}, {**LOCK, "hash": None}):
        assert not verify_password(damaged, PASSWORD)


def test_tokens_expire_when_unused():
    now = [1000.0]
    unlocks = Unlocks(clock=lambda: now[0])
    token = unlocks.grant()
    assert unlocks.valid(token)
    assert not unlocks.valid(None)
    assert not unlocks.valid("forged")
    for _ in range(3):  # each use gives UNLOCK_TTL more
        now[0] += UNLOCK_TTL - 1
        assert unlocks.valid(token)
    now[0] += UNLOCK_TTL + 1
    assert not unlocks.valid(token)
    other = unlocks.grant()  # granting sweeps the dead tokens
    assert list(unlocks._tokens) == [other]
    unlocks.revoke(None)
    assert unlocks.valid(other)
    unlocks.revoke(other)
    assert not unlocks.valid(other)


def test_wrong_passwords_are_slowed_down():
    now = [0.0]
    unlocks = Unlocks(clock=lambda: now[0])
    for _ in range(UNLOCK_MAX_FAILURES - 1):
        unlocks.fail()
    assert unlocks.blocked() == 0
    unlocks.fail()
    assert unlocks.blocked() == UNLOCK_PENALTY
    now[0] += UNLOCK_PENALTY - 10
    assert unlocks.blocked() == 10
    now[0] += 11
    assert unlocks.blocked() == 0

    for _ in range(UNLOCK_MAX_FAILURES - 1):
        unlocks.fail()
    token = unlocks.grant()  # a correct password forgets the previous mistakes
    unlocks.fail()
    assert unlocks.blocked() == 0

    for _ in range(UNLOCK_MAX_FAILURES):
        unlocks.fail()
    assert unlocks.blocked() == UNLOCK_PENALTY
    unlocks.clear()
    assert unlocks.blocked() == 0
    assert not unlocks.valid(token)


# ---------------------------------------------------------------------------- HTTP


async def _setup(hass, hass_client, options=None, token=None):
    assert await async_setup_component(hass, "http", {})
    entry = MockConfigEntry(domain=DOMAIN, data={}, options=options or {})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry, await (hass_client(token) if token else hass_client())


async def _unlock(client, password=PASSWORD):
    r = await client.post(f"{API}/unlock", json={"password": password})
    assert r.status == 200
    return {UNLOCK_HEADER: (await r.json())["token"]}


async def test_writes_need_the_password(hass, hass_client, hass_admin_user):
    _, client = await _setup(hass, hass_client, {CONF_LOCK: LOCK})
    assert (await (await client.get(f"{API}/info")).json())["locked"] is True
    assert await (await client.get(f"{API}/unlock")).json() == {"locked": True, "unlocked": False}

    # every write is refused, reading is not
    assert (await client.post(f"{API}/scene", json=SCENE)).status == 423
    assert (await client.delete(f"{API}/scene")).status == 423
    assert (await client.post(f"{API}/fetch", json={})).status == 423
    assert (await client.post(f"{API}/github", json={"action": "backup"})).status == 423
    assert (await client.get(f"{API}/fetch")).status == 200
    assert (await client.get(f"{API}/scene")).status == 404  # nothing was stored

    # wrong or malformed passwords (4 tries: one less than the limit)
    assert (await client.post(f"{API}/unlock", json={"password": "nope"})).status == 403
    assert (await client.post(f"{API}/unlock", data="not json")).status == 403
    assert (await client.post(f"{API}/unlock", json=["x"])).status == 403
    assert (await client.post(f"{API}/unlock", json={"password": 1234})).status == 403

    r = await client.post(f"{API}/unlock", json={"password": PASSWORD})
    body = await r.json()
    assert body["locked"] is True
    assert body["ttl"] == UNLOCK_TTL
    head = {UNLOCK_HEADER: body["token"]}
    assert await (await client.get(f"{API}/unlock", headers=head)).json() == {"locked": True, "unlocked": True}
    assert (await client.post(f"{API}/scene", json=SCENE, headers=head)).status == 200
    assert (await client.post(f"{API}/scene", json=SCENE, headers={UNLOCK_HEADER: "forged"})).status == 423
    assert await (await client.get(f"{API}/scene")).json() == SCENE

    # "lock now" of the card
    assert (await client.delete(f"{API}/unlock", headers=head)).status == 200
    assert (await client.delete(f"{API}/scene", headers=head)).status == 423
    assert (await client.delete(f"{API}/unlock")).status == 200  # no token: nothing to forget


async def test_too_many_wrong_passwords(hass, hass_client, hass_admin_user):
    _, client = await _setup(hass, hass_client, {CONF_LOCK: LOCK})
    for _ in range(UNLOCK_MAX_FAILURES):
        assert (await client.post(f"{API}/unlock", json={"password": "nope"})).status == 403
    r = await client.post(f"{API}/unlock", json={"password": PASSWORD})  # even the right one has to wait
    assert r.status == 429
    assert 0 < (await r.json())["retry_after"] <= UNLOCK_PENALTY
    next(iter(hass.data[DOMAIN].values())).unlocks._blocked_until = 0.0  # the wait is over
    assert await _unlock(client)


async def test_password_change_locks_every_card_again(hass, hass_client, hass_admin_user):
    entry, client = await _setup(hass, hass_client, {CONF_LOCK: LOCK})
    head = await _unlock(client)

    hass.config_entries.async_update_entry(entry, options={CONF_LOCK: LOCK, **GITHUB})  # other settings: still unlocked
    await hass.async_block_till_done()
    assert (await client.post(f"{API}/scene", json=SCENE, headers=head)).status == 200

    changed = hash_password("another", iterations=FAST)
    hass.config_entries.async_update_entry(entry, options={CONF_LOCK: changed, **GITHUB})
    await hass.async_block_till_done()
    assert (await client.post(f"{API}/scene", json=SCENE, headers=head)).status == 423
    assert (await client.post(f"{API}/unlock", json={"password": PASSWORD})).status == 403
    assert (await client.post(f"{API}/scene", json=SCENE, headers=await _unlock(client, "another"))).status == 200

    hass.config_entries.async_update_entry(entry, options=GITHUB)  # protection removed
    await hass.async_block_till_done()
    assert (await (await client.get(f"{API}/info")).json())["locked"] is False
    assert await (await client.get(f"{API}/unlock")).json() == {"locked": False, "unlocked": True}
    assert (await client.post(f"{API}/scene", json=SCENE)).status == 200
    r = await client.post(f"{API}/unlock", json={"password": "anything"})
    assert await r.json() == {"ok": True, "locked": False, "token": None}


async def test_unlock_is_for_administrators(hass, hass_client, hass_read_only_access_token):
    _, reader = await _setup(hass, hass_client, {CONF_LOCK: LOCK}, hass_read_only_access_token)
    assert (await reader.post(f"{API}/unlock", json={"password": PASSWORD})).status == 401
    assert (await reader.post(f"{API}/scene", json=SCENE)).status == 401
    assert await (await reader.get(f"{API}/unlock")).json() == {"locked": True, "unlocked": False}


async def test_unlock_view_of_an_unloaded_entry(hass, hass_client, hass_admin_user):
    entry, client = await _setup(hass, hass_client, {CONF_LOCK: LOCK})
    assert await hass.config_entries.async_unload(entry.entry_id)
    for method in ("get", "post", "delete"):
        assert (await getattr(client, method)(f"{API}/unlock")).status == 404


# ---------------------------------------------------------------------------- options flow


async def test_options_flow_lock(hass):
    entry = MockConfigEntry(domain=DOMAIN, data={}, options=dict(GITHUB))
    entry.add_to_hass(hass)

    async def step(data, status):
        r = await hass.config_entries.options.async_init(entry.entry_id)
        assert r["type"] == "menu"
        assert r["menu_options"] == ["github", "lock"]
        r = await hass.config_entries.options.async_configure(r["flow_id"], {"next_step_id": "lock"})
        assert r["type"] == "form"
        assert r["description_placeholders"] == {"status": status}
        return await hass.config_entries.options.async_configure(r["flow_id"], data)

    r = await step({"password": "abc"}, "🔓")
    assert r["errors"] == {"password": "too_short"}
    assert CONF_LOCK not in entry.options

    r = await step({"password": PASSWORD}, "🔓")
    assert r["type"] == "create_entry"
    lock = entry.options[CONF_LOCK]
    assert verify_password(lock, PASSWORD)
    assert PASSWORD not in json.dumps(dict(entry.options))
    assert entry.options["repo"] == GITHUB["repo"]  # the GitHub settings are kept

    await step({}, "🔒")  # empty field: unchanged
    assert entry.options[CONF_LOCK] == lock
    await step({"password": "0000"}, "🔒")
    assert verify_password(entry.options[CONF_LOCK], "0000")
    assert not verify_password(entry.options[CONF_LOCK], PASSWORD)

    await step({"password": "ignored", "remove": True}, "🔒")
    assert dict(entry.options) == GITHUB
