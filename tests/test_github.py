"""GitHub backup client, HTTP views for fetch / GitHub, options flow."""

import asyncio
import base64
import json

import aiohttp
import pytest
import voluptuous as vol
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.house_view import _async_options_updated, ign
from custom_components.house_view.const import DOMAIN
from custom_components.house_view.github import API, GitHubBackup, GitHubError, blob_sha

REPO = "me/house"
CONTENTS = f"{API}/repos/{REPO}/contents/house_view"
SCENE = {"levels": [{"id": "l0", "elevation": 0, "rooms": []}]}
OPTIONS = {"repo": REPO, "token": "t0k", "branch": "main", "path": "house_view"}


def test_blob_sha_is_git_compatible():
    assert blob_sha(b"hello\n") == "ce013625030ba8dba906f756967f9e9ca394464a"


async def test_backup_writes_only_changed_files(hass, aioclient_mock):
    same = b'{"a": 1}'
    aioclient_mock.get(f"{CONTENTS}/edits.json", json={"sha": blob_sha(same)})
    aioclient_mock.get(f"{CONTENTS}/scene.json", json={"sha": "old"})
    aioclient_mock.get(f"{CONTENTS}/terrain.json", status=404, json={"message": "Not Found"})
    aioclient_mock.put(f"{CONTENTS}/scene.json", json={})
    aioclient_mock.put(f"{CONTENTS}/terrain.json", json={})
    session = aioclient_mock.create_session(hass.loop)
    gh = GitHubBackup(session, f" {REPO}/ ", "t0k", "", "/house_view/")
    written = await gh.backup({"edits": same, "scene": b"{}", "terrain": b"[]"})
    assert written == ["scene", "terrain"]
    puts = [c for c in aioclient_mock.mock_calls if c[0] == "PUT"]
    scene_put = puts[0][2]
    assert scene_put["sha"] == "old"
    assert scene_put["branch"] == "main"
    assert base64.b64decode(scene_put["content"]) == b"{}"
    assert "sha" not in puts[1][2]
    await session.close()


async def test_restore_check_and_errors(hass, aioclient_mock):
    session = aioclient_mock.create_session(hass.loop)
    gh = GitHubBackup(session, REPO, "t0k", path="")
    aioclient_mock.get(f"{API}/repos/{REPO}/contents/scene.json", text=json.dumps(SCENE))
    aioclient_mock.get(f"{API}/repos/{REPO}/contents/terrain.json", status=404)
    assert await gh.restore(("scene", "terrain")) == {"scene": SCENE}

    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{API}/repos/{REPO}/contents/scene.json", text="not json")
    with pytest.raises(GitHubError, match="not valid JSON"):
        await gh.restore(("scene",))

    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{API}/repos/{REPO}", json={"private": True})
    await gh.check()
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{API}/repos/{REPO}", json={"private": False})
    with pytest.raises(GitHubError, match="public"):
        await gh.check()
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{API}/repos/{REPO}", status=404, text="")
    with pytest.raises(GitHubError, match="not found"):
        await gh.check()
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{API}/repos/{REPO}", status=401, json={"message": "Bad credentials"})
    with pytest.raises(GitHubError, match="Bad credentials"):
        await gh.check()
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{API}/repos/{REPO}", status=502, text="<html>gateway</html>")
    with pytest.raises(GitHubError, match="502"):
        await gh.check()
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{API}/repos/{REPO}", exc=aiohttp.ClientError("down"))
    with pytest.raises(GitHubError, match="unreachable"):
        await gh.check()
    await session.close()


# ---------------------------------------------------------------------------- HTTP views


async def _setup(hass, hass_client, options=None):
    assert await async_setup_component(hass, "http", {})
    entry = MockConfigEntry(domain=DOMAIN, data={}, options=options or {})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry, await hass_client()


async def test_github_view(hass, hass_client, hass_admin_user, aioclient_mock):
    _, client = await _setup(hass, hass_client)
    assert (await client.post("/api/house_view/github", json={"action": "backup"})).status == 400  # not configured
    info = await (await client.get("/api/house_view/info")).json()
    assert info["github"] is None

    entry = hass.config_entries.async_entries(DOMAIN)[0]
    hass.config_entries.async_update_entry(entry, options=OPTIONS)
    await hass.async_block_till_done()
    assert (await (await client.get("/api/house_view/info")).json())["github"] == REPO

    await client.post("/api/house_view/scene", json=SCENE)
    aioclient_mock.get(f"{CONTENTS}/scene.json", status=404)
    aioclient_mock.put(f"{CONTENTS}/scene.json", json={})
    r = await client.post("/api/house_view/github", json={"action": "backup"})
    assert (await r.json())["written"] == ["scene"]

    aioclient_mock.clear_requests()
    edits = {"version": 1, "views": []}
    aioclient_mock.get(f"{CONTENTS}/scene.json", text=json.dumps(SCENE))
    aioclient_mock.get(f"{CONTENTS}/edits.json", text=json.dumps(edits))
    for k in ("terrain", "ortho"):
        aioclient_mock.get(f"{CONTENTS}/{k}.json", status=404)
    r = await client.post("/api/house_view/github", json={"action": "restore"})
    assert sorted((await r.json())["restored"]) == ["edits", "scene"]
    assert await (await client.get("/api/house_view/edits")).json() == edits

    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{CONTENTS}/scene.json", text=json.dumps({"levels": []}))  # invalid scene
    for k in ("terrain", "edits", "ortho"):
        aioclient_mock.get(f"{CONTENTS}/{k}.json", status=404)
    assert (await client.post("/api/house_view/github", json={"action": "restore"})).status == 502

    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{CONTENTS}/scene.json", status=403, json={"message": "Resource not accessible"})
    assert (await client.post("/api/house_view/github", json={"action": "restore"})).status == 502
    assert (await client.post("/api/house_view/github", json={"action": "push"})).status == 400
    assert (await client.post("/api/house_view/github", data=b"[1]")).status == 400


async def test_fetch_view(hass, hass_client, hass_admin_user, monkeypatch):
    _, client = await _setup(hass, hass_client)
    assert (await (await client.get("/api/house_view/fetch")).json())["state"] == "idle"
    assert (await client.post("/api/house_view/fetch", json={"lat": 1})).status == 400

    gate = asyncio.Event()
    terrain = {"version": 1, "origin": [0, 0], "step": 1, "nx": 2, "nz": 2, "z": [1, 2, 3, 4], "center": [0, 0]}
    photo = {"version": 1, "bbox": [0, 0, 1, 1], "lat": 1, "lon": 2, "mime": "image/jpeg", "data": "AA=="}
    results = [(terrain, photo, ["ok"]), (terrain, None, ["no photo"]), (terrain, None, ["again"])]

    async def fake_fetch(session, params, run_sync, progress):
        progress("dtm")
        await gate.wait()
        return results.pop(0)

    monkeypatch.setattr(ign, "fetch_all", fake_fetch)
    body = {"lat": 43.4, "lon": 1.3, "center": [0, 0], "size": 40, "provider": "ign"}
    r = await client.post("/api/house_view/fetch", json=body)
    assert r.status == 202
    assert (await client.post("/api/house_view/fetch", json=body)).status == 409  # already running
    gate.set()
    await hass.async_block_till_done()
    st = await (await client.get("/api/house_view/fetch")).json()
    assert st == {"state": "done", "step": None, "message": "ok"}
    info = await (await client.get("/api/house_view/info")).json()
    assert info["has_terrain"]
    assert info["has_ortho"]

    await client.post("/api/house_view/fetch", json=body)  # second run without texture: the old one goes
    await hass.async_block_till_done()
    assert not (await (await client.get("/api/house_view/info")).json())["has_ortho"]
    await client.post("/api/house_view/fetch", json=body)  # nothing to remove this time
    await hass.async_block_till_done()
    assert (await (await client.get("/api/house_view/fetch")).json())["message"] == "again"


@pytest.mark.parametrize(
    ("error", "message"),
    [(ign.FetchError("no data here"), "no data here"), (RuntimeError("boom"), "unexpected error: boom")],
)
async def test_fetch_view_errors(hass, hass_client, hass_admin_user, monkeypatch, error, message):
    _, client = await _setup(hass, hass_client)

    async def failing(*_args):
        raise error

    monkeypatch.setattr(ign, "fetch_all", failing)
    await client.post("/api/house_view/fetch", json={"lat": 43.4, "lon": 1.3, "center": [0, 0], "provider": "ign"})
    await hass.async_block_till_done()
    st = await (await client.get("/api/house_view/fetch")).json()
    assert st["state"] == "error"
    assert st["message"] == message


async def test_fetch_and_github_need_admin_and_entry(hass, hass_client, hass_admin_user, hass_read_only_access_token):
    entry, client = await _setup(hass, hass_client, OPTIONS)
    reader = await hass_client(hass_read_only_access_token)
    assert (await reader.post("/api/house_view/fetch", json={})).status == 401
    assert (await reader.post("/api/house_view/github", json={"action": "backup"})).status == 401
    assert (await reader.get("/api/house_view/fetch")).status == 200
    assert await hass.config_entries.async_unload(entry.entry_id)
    for method, url in (("get", "fetch"), ("post", "fetch"), ("post", "github")):
        assert (await getattr(client, method)(f"/api/house_view/{url}", json={})).status == 404


async def test_options_update_after_unload_is_ignored(hass, hass_client, hass_admin_user):
    entry, _ = await _setup(hass, hass_client)
    assert await hass.config_entries.async_unload(entry.entry_id)
    await _async_options_updated(hass, entry)  # nothing loaded: no error


# ---------------------------------------------------------------------------- options flow


async def test_options_flow(hass, aioclient_mock):
    lock = {"edit_lock": {"salt": "00", "hash": "ab", "iterations": 1}}  # set by the other step of the menu: kept
    entry = MockConfigEntry(domain=DOMAIN, data={}, options=dict(lock))
    entry.add_to_hass(hass)

    async def step(data):
        r = await hass.config_entries.options.async_init(entry.entry_id)
        assert r["type"] == "menu"
        r = await hass.config_entries.options.async_configure(r["flow_id"], {"next_step_id": "github"})
        assert r["type"] == "form"
        return await hass.config_entries.options.async_configure(r["flow_id"], data)

    r = await step({"repo": "", "token": ""})
    assert r["type"] == "create_entry"
    assert r["data"] == lock
    assert (await step({"repo": "noslash", "token": "x"}))["errors"] == {"repo": "bad_repo"}
    assert (await step({"repo": REPO, "token": ""}))["errors"] == {"token": "token_required"}
    aioclient_mock.get(f"{API}/repos/{REPO}", json={"private": False})
    assert (await step({**OPTIONS}))["errors"] == {"base": "repo_public"}
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{API}/repos/{REPO}", status=404, text="")
    assert (await step({**OPTIONS}))["errors"] == {"base": "cannot_connect"}
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{API}/repos/{REPO}", json={"private": True})
    r = await step({**OPTIONS, "repo": f" {REPO} "})
    assert r["type"] == "create_entry"
    assert r["data"] == {**lock, **OPTIONS}

    # the stored token is a secret: the form does not carry it, and an empty field keeps it
    r = await hass.config_entries.options.async_init(entry.entry_id)
    r = await hass.config_entries.options.async_configure(r["flow_id"], {"next_step_id": "github"})
    schema = r["data_schema"].schema
    assert OPTIONS["token"] not in str(schema)
    assert next(key for key in schema if key == "token").default is vol.UNDEFINED
    r = await step({"repo": REPO, "branch": "backup"})
    assert r["type"] == "create_entry"
    assert r["data"] == {**lock, **OPTIONS, "branch": "backup"}
