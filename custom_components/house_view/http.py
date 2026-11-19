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
    CONF_PATH,
    CONF_REPO,
    CONF_TOKEN,
    DEMO_HOUSE,
    DOMAIN,
    EVENT_UPDATED,
    HOME_PARAM,
    KEY_EDITS,
    KEY_ORTHO,
    KEY_SCENE,
    KEY_TERRAIN,
    KEYS,
    MAX_BODY_BYTES,
    UNLOCK_HEADER,
    UNLOCK_TTL,
)
from .github import GitHubBackup, GitHubError
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
                "locked": store.lock is not None,
                "demo": store.demo,
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
        body = store.get_bytes(self._key) if store else None
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
        try:
            doc: Any = json.loads(await request.read())
            VALIDATORS[self._key](doc)
        except (ValueError, TypeError) as err:  # json.JSONDecodeError is a ValueError
            return self.json_message(str(err), HTTPStatus.BAD_REQUEST)
        stamp = await store.async_set(self._key, doc)
        _fire(request.app[KEY_HASS], self._key, stamp, store)
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
        VALIDATORS[KEY_TERRAIN](terrain)
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
    terrain = json.loads(await hass.async_add_executor_job(_read_demo, "demo-terrain.json"))
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


class HouseViewGitHubView(HomeAssistantView):
    """POST (admin, unlocked) {"action": "backup" | "restore"}: manual backup to / restore from the private repo."""

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
            action = (await request.json()).get("action")
        except (ValueError, AttributeError):
            action = None
        try:
            if action == "backup":
                docs = {k: b for k in KEYS if (b := store.get_bytes(k)) is not None}
                written = await gh.backup(docs)
                return self.json({"ok": True, "written": written, "message": f"{len(written)} file(s) updated"})
            if action == "restore":
                docs = await gh.restore(KEYS)
                for key, doc in docs.items():
                    VALIDATORS[key](doc)
                for key, doc in docs.items():
                    _fire(hass, key, await store.async_set(key, doc), store)
                return self.json({"ok": True, "restored": list(docs), "message": f"{len(docs)} file(s) restored"})
        except GitHubError as err:
            return self.json_message(str(err), HTTPStatus.BAD_GATEWAY)
        except ValueError as err:
            return self.json_message(f"invalid document in the repository: {err}", HTTPStatus.BAD_GATEWAY)
        return self.json_message("action must be backup or restore", HTTPStatus.BAD_REQUEST)


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
        doc = json.loads(await hass.async_add_executor_job(_read_demo, "demo-edits.json"))
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
