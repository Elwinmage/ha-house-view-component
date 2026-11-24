"""GitHub backup client, HTTP views for fetch / GitHub, options flow."""

import asyncio
import base64
import json

import aiohttp
import pytest
import voluptuous as vol
from homeassistant.helpers.json import json_bytes
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.house_view import _async_options_updated, ign
from custom_components.house_view.const import DOMAIN, KEYS, OPTIONAL_KEYS
from custom_components.house_view.github import API, GitHubBackup, GitHubError, backups_of, blob_sha, sync_state
from custom_components.house_view.http import _backup_message

REPO = "me/house"
CONTENTS = f"{API}/repos/{REPO}/contents/house_view"
SCENE = {"levels": [{"id": "l0", "elevation": 0, "rooms": []}]}
OPTIONS = {"repo": REPO, "token": "t0k", "branch": "main", "path": "house_view"}


def test_backup_message_says_only_what_there_is():
    """Everything stored and written: the message says that and nothing else."""
    assert _backup_message({"written": ["scene"], "unchanged": [], "failed": {}}, []) == "1 file(s) updated"


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
    res = await gh.backup({"edits": same, "scene": b"{}", "terrain": b"[]"})
    assert res == {"written": ["scene", "terrain"], "unchanged": ["edits"], "failed": {}}
    puts = [c for c in aioclient_mock.mock_calls if c[0] == "PUT"]
    scene_put = puts[0][2]
    assert scene_put["sha"] == "old"
    assert scene_put["branch"] == "main"
    assert base64.b64decode(scene_put["content"]) == b"{}"
    assert "sha" not in puts[1][2]
    await session.close()


async def test_backup_retries_a_conflict(hass, aioclient_mock):
    """Two commits in a row can collide: the sha is read again and the file written once more."""
    session = aioclient_mock.create_session(hass.loop)
    gh = GitHubBackup(session, REPO, "t0k", path="house_view")
    aioclient_mock.get(f"{CONTENTS}/scene.json", json={"sha": "old"})
    aioclient_mock.put(f"{CONTENTS}/scene.json", json={})
    real_put = gh._put
    tries = []

    async def flaky(key, content, sha):
        tries.append(sha)
        if len(tries) == 1:
            raise GitHubError("GitHub 409: is at 1234 but expected 5678", 409)
        await real_put(key, content, sha)

    gh._put = flaky
    assert await gh.backup({"scene": b"{}"}) == {"written": ["scene"], "unchanged": [], "failed": {}}
    assert tries == ["old", "old"]  # the sha was read again before writing once more
    await session.close()


async def test_backup_keeps_going_after_a_refused_file(hass, aioclient_mock):
    """A file GitHub refuses is reported, the following ones are saved all the same."""
    session = aioclient_mock.create_session(hass.loop)
    gh = GitHubBackup(session, REPO, "t0k", path="house_view")
    for key in ("scene", "terrain", "edits"):
        aioclient_mock.get(f"{CONTENTS}/{key}.json", json={"sha": "old"})
    aioclient_mock.put(f"{CONTENTS}/scene.json", status=403, json={"message": "Resource not accessible"})
    aioclient_mock.put(f"{CONTENTS}/terrain.json", status=422, json={"message": "is at 1234 but expected 5678"})
    aioclient_mock.put(f"{CONTENTS}/edits.json", json={})
    res = await gh.backup({"scene": b"{}", "terrain": b"[]", "edits": b"{}"})
    assert res["written"] == ["edits"]
    assert "Resource not accessible" in res["failed"]["scene"]
    assert "expected" in res["failed"]["terrain"]  # a conflict written again, refused again
    await session.close()


async def test_restore_check_and_errors(hass, aioclient_mock):
    session = aioclient_mock.create_session(hass.loop)
    gh = GitHubBackup(session, REPO, "t0k", path="")
    aioclient_mock.get(f"{API}/repos/{REPO}/contents/scene.json", text=json.dumps(SCENE))
    aioclient_mock.get(f"{API}/repos/{REPO}/contents/terrain.json", status=404)
    got = await gh.restore(("scene", "terrain"))  # raw bytes: the view parses them off the event loop
    assert {k: json.loads(v) for k, v in got.items()} == {"scene": SCENE}
    assert gh.file_of("scene") == "scene.json"

    # a file that is not JSON comes back as it is; the view is the one that refuses it (see the restore view)
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{API}/repos/{REPO}/contents/scene.json", text="not json")
    assert await gh.restore(("scene",)) == {"scene": b"not json"}

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
    body = await r.json()
    assert body["written"] == ["scene"]
    assert body["missing"] == ["terrain", "edits", "ortho"]  # nothing else is stored for this home
    assert "nothing stored: terrain, edits, ortho" in body["message"]

    # the same backup again: the file is already up to date, and a refused one is reported without stopping the rest
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{CONTENTS}/scene.json", json={"sha": blob_sha(json_bytes(SCENE))})
    r = await client.post("/api/house_view/github", json={"action": "backup"})
    body = await r.json()
    assert body == {
        "ok": True,
        "missing": ["terrain", "edits", "ortho"],
        "written": [],
        "unchanged": ["scene"],
        "failed": {},
        "message": "0 file(s) updated — already up to date: scene — nothing stored: terrain, edits, ortho",
    }

    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{CONTENTS}/scene.json", json={"sha": "old"})
    aioclient_mock.put(f"{CONTENTS}/scene.json", status=403, json={"message": "Resource not accessible"})
    body = await (await client.post("/api/house_view/github", json={"action": "backup"})).json()
    assert body["ok"] is False
    assert "failed: scene (GitHub 403: Resource not accessible)" in body["message"]

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
    assert (await client.post("/api/house_view/github", data=b"[1]")).status == 400  # JSON, but not an object
    assert (await client.post("/api/house_view/github", data=b"not json")).status == 400


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
    await hass.async_block_till_done(wait_background_tasks=True)  # the fetch runs in the background
    st = await (await client.get("/api/house_view/fetch")).json()
    assert st == {"state": "done", "step": None, "message": "ok"}
    info = await (await client.get("/api/house_view/info")).json()
    assert info["has_terrain"]
    assert info["has_ortho"]

    await client.post("/api/house_view/fetch", json=body)  # second run without texture: the old one goes
    await hass.async_block_till_done(wait_background_tasks=True)
    assert not (await (await client.get("/api/house_view/info")).json())["has_ortho"]
    await client.post("/api/house_view/fetch", json=body)  # nothing to remove this time
    await hass.async_block_till_done(wait_background_tasks=True)
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
    await hass.async_block_till_done(wait_background_tasks=True)
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


# ---------------------------------------------------------------------------- comparison and history


def _commit(sha, date):
    return {"sha": sha, "commit": {"committer": {"date": date}, "message": "House View: update x"}}


def test_backups_group_the_commits_of_one_backup():
    commits = [
        _commit("c3", "2026-11-23T20:00:40Z"),  # one backup: three files, a few seconds apart
        _commit("c2", "2026-11-23T20:00:20Z"),
        _commit("c1", "2026-11-23T20:00:00Z"),
        {"sha": "bad", "commit": {}},  # unreadable: left out
        {"sha": "author", "commit": {"author": {"date": "2026-11-22T10:00:00Z"}}},  # no committer: the author
        _commit("b1", "2026-11-22T09:59:00Z"),
    ]
    assert backups_of(commits) == [
        {"ref": "c3", "date": "2026-11-23T20:00:40Z", "files": 3},
        {"ref": "author", "date": "2026-11-22T10:00:00Z", "files": 2},
    ]
    assert backups_of([]) == []


def test_sync_state_compares_each_document():
    a, b = b'{"a": 1}', b'{"b": 2}'
    remote = {"scene": blob_sha(a), "terrain": blob_sha(a), "edits": None, "ortho": "x"}
    local = {"scene": a, "terrain": b, "edits": b, "ortho": None, "other": None}
    assert sync_state(local, remote) == {"scene": "same", "terrain": "changed", "edits": "local", "ortho": "remote"}
    assert sync_state(local, None) is None


def test_sync_state_keeps_an_optional_document_left_on_github():
    """The home was set up without a ground texture: the copy GitHub keeps is not a difference to warn about."""
    a = b'{"a": 1}'
    remote = {"scene": blob_sha(a), "ortho": "x"}
    local = {"scene": a, "ortho": None}
    assert sync_state(local, remote, OPTIONAL_KEYS) == {"scene": "same", "ortho": "spare"}
    # the same document missing from a home that is not meant to do without it is still a difference
    assert sync_state({"terrain": None}, {"terrain": "x"}, OPTIONAL_KEYS) == {"terrain": "remote"}


async def test_remote_history_and_restore_at_a_backup(hass, aioclient_mock):
    session = aioclient_mock.create_session(hass.loop)
    gh = GitHubBackup(session, REPO, "t0k", path="house_view")
    aioclient_mock.get(f"{CONTENTS}/scene.json", json={"sha": "s1"})
    aioclient_mock.get(f"{CONTENTS}/edits.json", status=404)
    assert await gh.remote_shas(("scene", "edits")) == {"scene": "s1", "edits": None}

    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{API}/repos/{REPO}/commits", json=[_commit("abc1234", "2026-11-23T20:00:00Z")])
    assert await gh.history() == [{"ref": "abc1234", "date": "2026-11-23T20:00:00Z", "files": 1}]
    assert aioclient_mock.mock_calls[-1][1].query["path"] == "house_view"
    assert aioclient_mock.mock_calls[-1][1].query["sha"] == "main"
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{API}/repos/{REPO}/commits", status=404)
    assert await gh.history() == []  # an empty repository
    root = GitHubBackup(session, REPO, "t0k", path="")
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{API}/repos/{REPO}/commits", json=[])
    assert await root.history() == []
    assert "path" not in aioclient_mock.mock_calls[-1][1].query  # the whole repository

    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{CONTENTS}/scene.json", text=json.dumps(SCENE))
    got = await gh.restore(("scene",), "abc1234")
    assert {k: json.loads(v) for k, v in got.items()} == {"scene": SCENE}
    assert aioclient_mock.mock_calls[-1][1].query["ref"] == "abc1234"  # as it was at that backup
    with pytest.raises(ValueError, match="commit id"):
        await gh.restore(("scene",), "main; rm")
    await session.close()


async def test_github_status_history_and_restore_views(hass, hass_client, hass_admin_user, aioclient_mock):
    entry, client = await _setup(hass, hass_client)
    await client.post("/api/house_view/scene", json=SCENE)
    info = await (await client.get("/api/house_view/info")).json()
    assert info["github_sync"] is None  # no GitHub backup set up

    hass.config_entries.async_update_entry(entry, options=OPTIONS)
    await hass.async_block_till_done()
    store = hass.data[DOMAIN][entry.entry_id]
    # not known yet: read once in the background, the scene is not on GitHub
    aioclient_mock.get(f"{CONTENTS}/scene.json", status=404)
    for k in ("terrain", "edits", "ortho"):
        aioclient_mock.get(f"{CONTENTS}/{k}.json", status=404)
    await client.get("/api/house_view/info")
    await hass.async_block_till_done()
    assert (await (await client.get("/api/house_view/info")).json())["github_sync"] == {"scene": "local"}

    # a backup: GitHub holds the scene now, without reading it again
    aioclient_mock.put(f"{CONTENTS}/scene.json", json={})
    await client.post("/api/house_view/github", json={"action": "backup"})
    assert (await (await client.get("/api/house_view/info")).json())["github_sync"] == {"scene": "same"}
    # a change here: differs from GitHub
    await client.post("/api/house_view/edits", json={"version": 1})
    assert (await (await client.get("/api/house_view/info")).json())["github_sync"] == {
        "scene": "same",
        "edits": "local",
    }

    # a failed backup: read again later
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{CONTENTS}/scene.json", json={"sha": blob_sha(json_bytes(SCENE))})
    aioclient_mock.get(f"{CONTENTS}/edits.json", json={"sha": "old"})
    aioclient_mock.put(f"{CONTENTS}/edits.json", status=403, json={"message": "no"})
    await client.post("/api/house_view/github", json={"action": "backup"})
    assert store.remote is None

    # status: read on request
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{CONTENTS}/scene.json", json={"sha": blob_sha(json_bytes(SCENE))})
    for k in ("terrain", "edits", "ortho"):
        aioclient_mock.get(f"{CONTENTS}/{k}.json", status=404)
    body = await (await client.post("/api/house_view/github", json={"action": "status"})).json()
    assert body == {"ok": True, "sync": {"scene": "same", "edits": "local"}}

    # history
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{API}/repos/{REPO}/commits", json=[_commit("abc1234", "2026-11-23T20:00:00Z")])
    body = await (await client.post("/api/house_view/github", json={"action": "history"})).json()
    assert body["backups"][0]["ref"] == "abc1234"

    # restore at a backup that had no edits: the scene comes back, the edits are kept
    old = {"levels": [{"id": "old", "elevation": 0, "rooms": []}]}
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{CONTENTS}/scene.json", text=json.dumps(old))
    for k in ("terrain", "edits", "ortho"):
        aioclient_mock.get(f"{CONTENTS}/{k}.json", status=404)
    body = await (await client.post("/api/house_view/github", json={"action": "restore", "ref": "abc1234"})).json()
    assert body["restored"] == ["scene"]
    assert body["kept"] == ["edits"]
    assert "kept: edits" in body["message"]
    assert all(c[1].query.get("ref") == "abc1234" for c in aioclient_mock.mock_calls)
    assert await (await client.get("/api/house_view/scene")).json() == old
    assert store.remote is None

    # a file of the repository that is not a document: refused, and the file is named
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{CONTENTS}/scene.json", text="not json")
    for k in ("terrain", "edits", "ortho"):
        aioclient_mock.get(f"{CONTENTS}/{k}.json", status=404)
    r = await client.post("/api/house_view/github", json={"action": "restore"})
    assert r.status == 502
    assert "house_view/scene.json" in (await r.json())["message"]

    # a ref that is not a commit id, or with another action: refused before calling GitHub
    for bad in (
        {"action": "restore", "ref": "main"},
        {"action": "restore", "ref": 12},
        {"action": "backup", "ref": "abc1234"},
    ):
        assert (await client.post("/api/house_view/github", json=bad)).status == 400

    # new GitHub settings: read again
    store.remote = {}
    hass.config_entries.async_update_entry(entry, options={**OPTIONS, "branch": "other"})
    await hass.async_block_till_done()
    assert store.remote is None


async def test_github_unreadable_stays_unknown(hass, hass_client, hass_admin_user, aioclient_mock):
    entry, client = await _setup(hass, hass_client, OPTIONS)
    aioclient_mock.get(f"{CONTENTS}/scene.json", status=401, json={"message": "Bad credentials"})
    await client.get("/api/house_view/info")
    await hass.async_block_till_done()
    assert hass.data[DOMAIN][entry.entry_id].remote is None
    assert (await (await client.get("/api/house_view/info")).json())["github_sync"] is None


async def test_forget_gives_up_on_any_other_error(hass, aioclient_mock):
    """A collision is retried; anything else is not, and says so."""
    session = aioclient_mock.create_session(hass.loop)
    gh = GitHubBackup(session, REPO, "t0k", path="house_view")
    aioclient_mock.get(f"{CONTENTS}/ortho.json", json={"sha": "o1"})
    aioclient_mock.delete(f"{CONTENTS}/ortho.json", status=500, json={"message": "boom"})
    with pytest.raises(GitHubError, match="500"):
        await gh.forget("ortho")
    await session.close()


async def test_forget_stops_when_another_commit_got_there_first(hass, monkeypatch):
    """The file collided, and by the time its sha is read again it is already gone: nothing left to drop."""
    gh = GitHubBackup(None, REPO, "t0k", path="house_view")
    shas = ["o1", None]

    async def remote_sha(_key):
        return shas.pop(0)

    async def collide(_key, _sha):
        raise GitHubError("GitHub 409: conflict", 409)

    monkeypatch.setattr(gh, "_remote_sha", remote_sha)
    monkeypatch.setattr(gh, "_del", collide)
    assert await gh.forget("ortho") is False
    assert not shas


async def test_forget_drops_a_file_and_retries_a_collision(hass, aioclient_mock):
    session = aioclient_mock.create_session(hass.loop)
    gh = GitHubBackup(session, REPO, "t0k", path="house_view")

    # nothing to drop
    aioclient_mock.get(f"{CONTENTS}/ortho.json", status=404)
    assert await gh.forget("ortho") is False

    # two commits in a row collide: the sha is read again and the file dropped once more
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{CONTENTS}/ortho.json", json={"sha": "o1"})
    aioclient_mock.delete(f"{CONTENTS}/ortho.json", status=409, json={"message": "conflict"})
    with pytest.raises(GitHubError):
        await gh.forget("ortho")  # the second delete fails too
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{CONTENTS}/ortho.json", json={"sha": "o1"})
    aioclient_mock.delete(f"{CONTENTS}/ortho.json", json={})
    assert await gh.forget("ortho") is True
    assert aioclient_mock.mock_calls[-1][2]["sha"] == "o1"
    await session.close()


async def test_github_keeps_then_forgets_an_optional_document(hass, hass_client, hass_admin_user, aioclient_mock):
    """A home without a ground texture: GitHub keeps its copy without the card calling it a difference."""
    entry, client = await _setup(hass, hass_client, OPTIONS)
    store = hass.data[DOMAIN][entry.entry_id]
    await client.post("/api/house_view/scene", json=SCENE)

    aioclient_mock.get(f"{CONTENTS}/scene.json", json={"sha": blob_sha(json_bytes(SCENE))})
    aioclient_mock.get(f"{CONTENTS}/ortho.json", json={"sha": "o1"})
    for k in ("terrain", "edits"):
        aioclient_mock.get(f"{CONTENTS}/{k}.json", status=404)
    body = await (await client.post("/api/house_view/github", json={"action": "status"})).json()
    assert body["sync"] == {"scene": "same", "ortho": "spare"}

    # dropped from the repository when the user asks for it
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{CONTENTS}/ortho.json", json={"sha": "o1"})
    aioclient_mock.delete(f"{CONTENTS}/ortho.json", json={})
    body = await (await client.post("/api/house_view/github", json={"action": "forget", "key": "ortho"})).json()
    assert body["removed"] is True
    assert body["sync"] == {"scene": "same"}
    assert store.remote["ortho"] is None

    # nothing read from GitHub yet: the file is dropped all the same, and the comparison is read in the background
    store.remote = None
    aioclient_mock.clear_requests()
    for k in KEYS:
        aioclient_mock.get(f"{CONTENTS}/{k}.json", status=404)
    body = await (await client.post("/api/house_view/github", json={"action": "forget", "key": "ortho"})).json()
    assert body["removed"] is False
    assert "nothing to remove" in body["message"]
    await hass.async_block_till_done()

    # a document stored here is never dropped, and the key must be one of the documents
    assert (await client.post("/api/house_view/github", json={"action": "forget", "key": "scene"})).status == 409
    assert (await client.post("/api/house_view/github", json={"action": "forget", "key": "nope"})).status == 400
    assert (await client.post("/api/house_view/github", json={"action": "forget"})).status == 400
