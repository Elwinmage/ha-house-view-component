"""HTTP API used by the card: /api/house_view/{info,scene,terrain,edits,ortho,fetch,github,unlock}.

Documents are big (a terrain grid is several MB), so they go through plain HTTP rather than the websocket API,
whose messages are limited to a few MB.
"""

from __future__ import annotations

import asyncio
import json
import logging
from http import HTTPStatus
from pathlib import Path
from typing import Any

from aiohttp import web
from homeassistant.components.http import KEY_HASS, HomeAssistantView
from homeassistant.const import __version__ as HA_VERSION
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from . import ign, sources
from .const import (
    CONF_BRANCH,
    CONF_DEMO,
    CONF_HIDE_DEMO,
    CONF_PATH,
    CONF_REPO,
    CONF_TOKEN,
    DEMO_HOUSE,
    DOMAIN,
    EVENT_UPDATED,
    HIDE_DEMO_DEFAULT,
    HOME_PARAM,
    KEY_EDITS,
    KEY_ORTHO,
    KEY_SCENE,
    KEY_TERRAIN,
    KEYS,
    MAX_BODY_BYTES,
    OPTIONAL_KEYS,
    UNLOCK_HEADER,
    UNLOCK_TTL,
)
from .github import REF, GitHubBackup, GitHubError, blob_sha, sync_state
from .lock import verify_password
from .store import HouseViewStore
from .validate import VALIDATORS

_LOGGER = logging.getLogger(__name__)
DEMO_DIR = Path(__file__).parent / "demo"
DEMO_PACE = 1.0  # duration factor of the simulated fetch of the demo (tests make it instant)


def _store(request: web.Request) -> HouseViewStore | None:
    """Store of the home named by the request (`?home=<config entry id>`), else of the first home."""
    homes: dict[str, HouseViewStore] = request.app[KEY_HASS].data.get(DOMAIN) or {}
    home = request.query.get(HOME_PARAM)
    if home:
        return homes.get(home)
    return next(iter(homes.values()), None)


def _home_of(hass: HomeAssistant, store: HouseViewStore) -> str | None:
    return next((k for k, v in (hass.data.get(DOMAIN) or {}).items() if v is store), None)


def _is_admin(request: web.Request) -> bool:
    user = request.get("hass_user")
    return bool(user and user.is_admin)


def _locked(request: web.Request, store: HouseViewStore) -> bool:
    """True when an edit password is set and the request does not carry a live unlock token."""
    return store.lock is not None and not store.unlocks.valid(request.headers.get(UNLOCK_HEADER))


def _refusal(view: HomeAssistantView, request: web.Request, store: HouseViewStore) -> web.Response | None:
    """Why a write is refused (not an administrator, or editing locked), None when it may go on."""
    if not _is_admin(request):
        return view.json_message("Admin only", HTTPStatus.UNAUTHORIZED)
    if _locked(request, store):
        return view.json_message("Editing is locked", HTTPStatus.LOCKED)
    return None


async def _demo_doc(hass: HomeAssistant, name: str) -> Any:
    """A document shipped with the demo home: read and parsed in one executor job, never on the event loop."""
    return await hass.async_add_executor_job(lambda: json.loads(_read_demo(name)))


async def _read_doc(hass: HomeAssistant, body: bytes, key: str) -> Any:
    """
    Parse and check one document, away from the event loop: a terrain is several megabytes of JSON and up to a
    million values checked one by one, which would otherwise hold up every other integration. Raises ValueError.
    """

    def work() -> Any:
        doc = json.loads(body)
        VALIDATORS[key](doc)
        return doc

    return await hass.async_add_executor_job(work)


def _fire(hass: HomeAssistant, key: str, stamp: str | None, store: HouseViewStore | None = None) -> None:
    hass.bus.async_fire(EVENT_UPDATED, {"key": key, "updated": stamp, "home": store and _home_of(hass, store)})


def github_client(hass: HomeAssistant, store: HouseViewStore) -> GitHubBackup | None:
    o = store.options
    if not (o.get(CONF_REPO) and o.get(CONF_TOKEN)):
        return None
    return GitHubBackup(
        async_get_clientsession(hass),
        o[CONF_REPO],
        o[CONF_TOKEN],
        o.get(CONF_BRANCH, "main"),
        # by default each home in its own folder of the repository (the first home where it always was)
        o.get(CONF_PATH, store.prefix.replace(".", "/")),
    )


async def refresh_remote(store: HouseViewStore, gh: GitHubBackup) -> None:
    """Read what GitHub holds (blob ids only, nothing is written); a failure leaves it unknown."""
    try:
        store.remote = await gh.remote_shas(KEYS)
    except GitHubError as err:
        _LOGGER.debug("House View: GitHub not read: %s", err)


async def _github_sync(hass: HomeAssistant, store: HouseViewStore) -> dict[str, str] | None:
    """
    Each document compared with the GitHub backup, for the card's "differs from GitHub" sign. Not known yet: read
    once in the background (a few requests), the card asks again after its next write.
    """
    gh = github_client(hass, store)
    if gh is None:
        return None
    if store.remote is None and (store.remote_job is None or store.remote_job.done()):
        store.remote_job = hass.async_create_background_task(refresh_remote(store, gh), f"{DOMAIN}_github_sync")
    local = {k: await store.async_get_bytes(hass, k) for k in KEYS}
    return sync_state(local, store.remote, OPTIONAL_KEYS)


class HouseViewInfoView(HomeAssistantView):
    """Small status document: what is stored, and the home location from the HA configuration."""

    url = f"/api/{DOMAIN}/info"
    name = f"api:{DOMAIN}:info"
    requires_auth = True

    async def get(self, request: web.Request) -> web.Response:
        store = _store(request)
        if store is None:
            return self.json_message("House View is not set up", HTTPStatus.NOT_FOUND)
        hass = request.app[KEY_HASS]
        cfg = hass.config
        loc = store.location or {}
        return self.json(
            {
                "ha_version": HA_VERSION,
                "home": _home_of(hass, store),
                "title": store.title,
                "latitude": loc.get("latitude", cfg.latitude),
                "longitude": loc.get("longitude", cfg.longitude),
                "elevation": cfg.elevation,
                "country": cfg.country,
                "has_scene": store.has("scene"),
                "has_terrain": store.has("terrain"),
                "has_edits": store.has("edits"),
                "has_ortho": store.has(KEY_ORTHO),
                "github": store.options.get(CONF_REPO) if store.options.get(CONF_TOKEN) else None,
                "github_sync": await _github_sync(hass, store) if _is_admin(request) else None,
                "locked": store.lock is not None,
                "demo": store.demo,
                "hide_demo": bool(store.options.get(CONF_HIDE_DEMO, HIDE_DEMO_DEFAULT)),
                "fetch": store.job,
                "updated": store.updated,
            }
        )


class HouseViewDataView(HomeAssistantView):
    """GET (any user) / POST / DELETE (admin, editing unlocked) of one stored document."""

    requires_auth = True

    def __init__(self, key: str) -> None:
        self._key = key
        self.url = f"/api/{DOMAIN}/{key}"
        self.name = f"api:{DOMAIN}:{key}"

    async def get(self, request: web.Request) -> web.Response:
        store = _store(request)
        body = await store.async_get_bytes(request.app[KEY_HASS], self._key) if store else None
        if body is None:
            return self.json_message("Nothing stored", HTTPStatus.NOT_FOUND)
        resp = web.Response(body=body, content_type="application/json")
        resp.enable_compression()
        return resp

    async def post(self, request: web.Request) -> web.Response:
        store = _store(request)
        if store is None:
            return self.json_message("House View is not set up", HTTPStatus.NOT_FOUND)
        if refusal := _refusal(self, request, store):
            return refusal
        if request.content_length and request.content_length > MAX_BODY_BYTES:
            return self.json_message("Document too large", HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        hass = request.app[KEY_HASS]
        try:
            doc = await _read_doc(hass, await request.read(), self._key)
        except (ValueError, TypeError) as err:  # json.JSONDecodeError is a ValueError
            return self.json_message(str(err), HTTPStatus.BAD_REQUEST)
        stamp = await store.async_set(self._key, doc)
        _fire(hass, self._key, stamp, store)
        return self.json({"ok": True, "updated": stamp})

    async def delete(self, request: web.Request) -> web.Response:
        store = _store(request)
        if store is None:
            return self.json_message("House View is not set up", HTTPStatus.NOT_FOUND)
        if refusal := _refusal(self, request, store):
            return refusal
        await store.async_remove(self._key)
        _fire(request.app[KEY_HASS], self._key, None, store)
        return self.json({"ok": True})


async def run_fetch(hass: HomeAssistant, store: HouseViewStore, params: ign.FetchParams) -> None:
    """Background job: fetch the terrain (and texture), store them, report through store.job."""
    job = store.job

    def progress(step: str) -> None:
        job["step"] = step

    try:
        terrain, photo, notes = await sources.fetch_all(
            async_get_clientsession(hass), params, hass.config.country, hass.async_add_executor_job, progress
        )
        # a fetched terrain holds up to a million values: checked in an executor, like an uploaded one
        await hass.async_add_executor_job(VALIDATORS[KEY_TERRAIN], terrain)
        _fire(hass, KEY_TERRAIN, await store.async_set(KEY_TERRAIN, terrain), store)
        if photo:
            _fire(hass, KEY_ORTHO, await store.async_set(KEY_ORTHO, photo), store)
        elif store.has(KEY_ORTHO):
            await store.async_remove(KEY_ORTHO)
            _fire(hass, KEY_ORTHO, None, store)
        job.update(state="done", step=None, message=" · ".join(notes))
    except (ign.FetchError, ValueError) as err:
        job.update(state="error", step=None, message=str(err))
    except Exception as err:
        _LOGGER.exception("House View terrain fetch failed")
        job.update(state="error", step=None, message=f"unexpected error: {err}")


DEMO_STEPS = (("locate", 1.0), ("dtm", 2.5), ("dsm", 2.0), ("vectors", 1.5))


async def run_demo_fetch(hass: HomeAssistant, store: HouseViewStore, params: ign.FetchParams) -> None:
    """Fetch of the demo home: the steps of a real fetch, then the fictitious terrain centred on the plan."""
    for step, seconds in DEMO_STEPS:
        store.job["step"] = step
        await asyncio.sleep(seconds * DEMO_PACE)
    terrain = await _demo_doc(hass, "demo-terrain.json")
    terrain["center"] = list(params.center)
    _fire(hass, KEY_TERRAIN, await store.async_set(KEY_TERRAIN, terrain), store)
    store.job.update(state="done", step=None, message="démo")


class HouseViewFetchView(HomeAssistantView):
    """GET: state of the terrain fetch job. POST (admin, unlocked): start it (French or worldwide open data)."""

    url = f"/api/{DOMAIN}/fetch"
    name = f"api:{DOMAIN}:fetch"
    requires_auth = True

    async def get(self, request: web.Request) -> web.Response:
        store = _store(request)
        if store is None:
            return self.json_message("House View is not set up", HTTPStatus.NOT_FOUND)
        return self.json(store.job)

    async def post(self, request: web.Request) -> web.Response:
        store = _store(request)
        if store is None:
            return self.json_message("House View is not set up", HTTPStatus.NOT_FOUND)
        if refusal := _refusal(self, request, store):
            return refusal
        if store.job.get("state") == "running":
            return self.json_message("A fetch is already running", HTTPStatus.CONFLICT)
        try:
            params = ign.FetchParams.from_json(await request.json())
        except ValueError as err:
            return self.json_message(str(err), HTTPStatus.BAD_REQUEST)
        hass = request.app[KEY_HASS]
        store.job = {"state": "running", "step": "start", "message": ""}
        # the demo home: the fetch is played with the fictitious terrain, nothing goes to the network
        job = run_demo_fetch(hass, store, params) if store.demo else run_fetch(hass, store, params)
        hass.async_create_background_task(job, f"{DOMAIN}_fetch")
        return self.json(store.job, HTTPStatus.ACCEPTED)


def _backup_message(res: dict[str, Any], missing: list[str]) -> str:
    """What a backup did, for the message the card shows: written, already up to date, not stored here, failed."""
    parts = [f"{len(res['written'])} file(s) updated"]
    if res["unchanged"]:
        parts.append(f"already up to date: {', '.join(res['unchanged'])}")
    if missing:
        parts.append(f"nothing stored: {', '.join(missing)}")
    if res["failed"]:
        parts.append("failed: " + "; ".join(f"{k} ({why})" for k, why in res["failed"].items()))
    return " — ".join(parts)


class HouseViewGitHubView(HomeAssistantView):
    """
    POST (admin, unlocked), only on a request of the user: {"action": "backup"} saves to the private repository,
    {"action": "restore", "ref"?} brings back the last backup or the backup `ref` of the history, {"action":
    "history"} lists the backups, {"action": "status"} compares the documents with GitHub, {"action": "forget",
    "key"} drops from the repository a document this home no longer holds.
    """

    url = f"/api/{DOMAIN}/github"
    name = f"api:{DOMAIN}:github"
    requires_auth = True

    async def post(self, request: web.Request) -> web.Response:
        store = _store(request)
        if store is None:
            return self.json_message("House View is not set up", HTTPStatus.NOT_FOUND)
        if refusal := _refusal(self, request, store):
            return refusal
        hass = request.app[KEY_HASS]
        gh = github_client(hass, store)
        if gh is None:
            return self.json_message("GitHub backup is not configured", HTTPStatus.BAD_REQUEST)
        try:
            req = await request.json()
        except ValueError:
            req = None
        if not isinstance(req, dict):
            req = {}
        action, ref, key = req.get("action"), req.get("ref"), req.get("key")
        run = {
            "status": _gh_status,
            "history": _gh_history,
            "backup": _gh_backup,
            "restore": _gh_restore,
            "forget": _gh_forget,
        }.get(action)
        if run is None:
            return self.json_message(
                "action must be backup, restore, history, status or forget", HTTPStatus.BAD_REQUEST
            )
        if ref is not None and not (action == "restore" and isinstance(ref, str) and REF.match(ref)):
            return self.json_message("ref must be the commit id of a backup", HTTPStatus.BAD_REQUEST)
        if action == "forget":
            if key not in KEYS:
                return self.json_message(f"key must be one of {', '.join(KEYS)}", HTTPStatus.BAD_REQUEST)
            # never drop the backup of a document the home still holds: that is what a backup is for
            if store.has(key):
                return self.json_message("this document is stored here: back it up instead", HTTPStatus.CONFLICT)
        try:
            return self.json(await run(hass, store, gh, req))
        except GitHubError as err:
            return self.json_message(str(err), HTTPStatus.BAD_GATEWAY)
        except ValueError as err:
            return self.json_message(f"invalid document in the repository: {err}", HTTPStatus.BAD_GATEWAY)


async def _gh_status(
    hass: HomeAssistant, store: HouseViewStore, gh: GitHubBackup, _req: dict[str, Any]
) -> dict[str, Any]:
    """Read GitHub again and compare."""
    store.remote = await gh.remote_shas(KEYS)
    return {"ok": True, "sync": await _github_sync(hass, store)}


async def _gh_history(
    _hass: HomeAssistant, _store: HouseViewStore, gh: GitHubBackup, _req: dict[str, Any]
) -> dict[str, Any]:
    """The backups, newest first."""
    return {"ok": True, "backups": await gh.history()}


async def _gh_forget(
    hass: HomeAssistant, store: HouseViewStore, gh: GitHubBackup, req: dict[str, Any]
) -> dict[str, Any]:
    """
    Drop from the repository a document this home no longer holds (the ground texture of a home set up without
    one). The commits stay: an older backup still brings it back.
    """
    key = req["key"]
    removed = await gh.forget(key)
    if store.remote is not None:
        store.remote[key] = None
    msg = f"{key}: removed from GitHub" if removed else f"{key}: nothing to remove on GitHub"
    sync = await _github_sync(hass, store)
    return {"ok": True, "key": key, "removed": removed, "sync": sync, "message": msg}


async def _gh_backup(
    hass: HomeAssistant, store: HouseViewStore, gh: GitHubBackup, _req: dict[str, Any]
) -> dict[str, Any]:
    """Save every stored document that changed."""
    docs = {k: b for k in KEYS if (b := await store.async_get_bytes(hass, k)) is not None}
    # a document that is not stored here cannot be saved: said plainly, it is the usual reason a file is missing
    # from the repository
    missing = [k for k in KEYS if k not in docs]
    res = await gh.backup(docs)
    # what GitHub holds now: the files written or already there; after a failure, read again later
    if store.remote is not None and not res["failed"]:
        store.remote.update({k: blob_sha(docs[k]) for k in res["written"] + res["unchanged"]})
    else:
        store.remote = None
    return {"ok": not res["failed"], "missing": missing, **res, "message": _backup_message(res, missing)}


async def _gh_restore(
    hass: HomeAssistant, store: HouseViewStore, gh: GitHubBackup, req: dict[str, Any]
) -> dict[str, Any]:
    """
    Every document as it was at the backup `ref` (the last backup without it), all checked before any is stored: a
    restore never leaves the home half old, half new. A document the backup did not hold is kept as it is.
    """
    ref = req.get("ref")
    raw = await gh.restore(KEYS, ref)
    docs = {}
    for key, body in raw.items():
        try:
            docs[key] = await _read_doc(hass, body, key)
        except (ValueError, TypeError) as err:
            raise ValueError(f"{gh.file_of(key)}: {err}") from err
    for key, doc in docs.items():
        _fire(hass, key, await store.async_set(key, doc), store)
    store.remote = None  # an older backup differs from the branch: read again
    kept = [k for k in KEYS if k not in docs and store.has(k)]
    msg = f"{len(docs)} file(s) restored" + (f" — not in that backup, kept: {', '.join(kept)}" if kept else "")
    return {"ok": True, "restored": list(docs), "kept": kept, "ref": ref, "message": msg}


class HouseViewUnlockView(HomeAssistantView):
    """Edit lock. GET: state for this card. POST (admin) {"password"}: unlock token. DELETE: lock again."""

    url = f"/api/{DOMAIN}/unlock"
    name = f"api:{DOMAIN}:unlock"
    requires_auth = True

    async def get(self, request: web.Request) -> web.Response:
        store = _store(request)
        if store is None:
            return self.json_message("House View is not set up", HTTPStatus.NOT_FOUND)
        return self.json({"locked": store.lock is not None, "unlocked": not _locked(request, store)})

    async def post(self, request: web.Request) -> web.Response:
        store = _store(request)
        if store is None:
            return self.json_message("House View is not set up", HTTPStatus.NOT_FOUND)
        if not _is_admin(request):
            return self.json_message("Admin only", HTTPStatus.UNAUTHORIZED)
        lock = store.lock
        if lock is None:
            return self.json({"ok": True, "locked": False, "token": None})
        if wait := store.unlocks.blocked():
            return self.json({"message": "Too many wrong passwords", "retry_after": wait}, HTTPStatus.TOO_MANY_REQUESTS)
        try:
            password = (await request.json()).get("password")
        except (ValueError, AttributeError):
            password = None
        hass = request.app[KEY_HASS]
        if not isinstance(password, str) or not await hass.async_add_executor_job(verify_password, lock, password):
            store.unlocks.fail()
            return self.json_message("Wrong password", HTTPStatus.FORBIDDEN)
        return self.json({"ok": True, "locked": True, "token": store.unlocks.grant(), "ttl": UNLOCK_TTL})

    async def delete(self, request: web.Request) -> web.Response:
        store = _store(request)
        if store is None:
            return self.json_message("House View is not set up", HTTPStatus.NOT_FOUND)
        store.unlocks.revoke(request.headers.get(UNLOCK_HEADER))
        return self.json({"ok": True})


class HouseViewHomesView(HomeAssistantView):
    """The homes set up (one config entry each), in their order: [{"id", "title"}]. The card offers them."""

    url = f"/api/{DOMAIN}/homes"
    name = f"api:{DOMAIN}:homes"
    requires_auth = True

    async def get(self, request: web.Request) -> web.Response:
        homes: dict[str, HouseViewStore] = request.app[KEY_HASS].data.get(DOMAIN) or {}
        return self.json([{"id": k, "title": v.title} for k, v in homes.items()])


def _read_demo(name: str) -> bytes:
    return (DEMO_DIR / name).read_bytes()


class HouseViewDemoView(HomeAssistantView):
    """The demo home (admin): POST creates it, or puts it back as shipped; GET gives the plan of its house."""

    url = f"/api/{DOMAIN}/demo"
    name = f"api:{DOMAIN}:demo"
    requires_auth = True

    async def get(self, request: web.Request) -> web.Response:
        if not _is_admin(request):
            return self.json_message("Admin only", HTTPStatus.UNAUTHORIZED)
        body = await request.app[KEY_HASS].async_add_executor_job(_read_demo, DEMO_HOUSE)
        return web.Response(body=body, content_type="application/octet-stream")

    async def post(self, request: web.Request) -> web.Response:
        if not _is_admin(request):
            return self.json_message("Admin only", HTTPStatus.UNAUTHORIZED)
        hass = request.app[KEY_HASS]
        entry = next((e for e in hass.config_entries.async_entries(DOMAIN) if e.data.get(CONF_DEMO)), None)
        if entry is None:
            result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "demo"})
            entry = result["result"]
        store: HouseViewStore | None = (hass.data.get(DOMAIN) or {}).get(entry.entry_id)
        if store is None:
            return self.json_message("The demo home is not loaded", HTTPStatus.CONFLICT)
        # the shipped edits only: the plan is imported by the user (demo-maison.sh3d) and the terrain is "fetched"
        doc = await _demo_doc(hass, "demo-edits.json")
        VALIDATORS[KEY_EDITS](doc)
        _fire(hass, KEY_EDITS, await store.async_set(KEY_EDITS, doc), store)
        store.job = {"state": "idle"}
        for key in (KEY_SCENE, KEY_TERRAIN, KEY_ORTHO):
            if store.has(key):
                await store.async_remove(key)
                _fire(hass, key, None, store)
        return self.json({"home": entry.entry_id})


def all_views() -> list[HomeAssistantView]:
    return [
        HouseViewHomesView(),
        HouseViewDemoView(),
        HouseViewInfoView(),
        HouseViewFetchView(),
        HouseViewGitHubView(),
        HouseViewUnlockView(),
        *(HouseViewDataView(k) for k in KEYS),
    ]
