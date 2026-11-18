"""HTTP API used by the card: /api/house_view/{info,scene,terrain,edits,ortho,fetch,github}.

Documents are big (a terrain grid is several MB), so they go through plain HTTP rather than the websocket API,
whose messages are limited to a few MB.
"""

from __future__ import annotations

import json
import logging
from http import HTTPStatus
from typing import Any

from aiohttp import web
from homeassistant.components.http import KEY_HASS, HomeAssistantView
from homeassistant.const import __version__ as HA_VERSION
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from . import ign
from .const import (
    CONF_BRANCH,
    CONF_PATH,
    CONF_REPO,
    CONF_TOKEN,
    DOMAIN,
    EVENT_UPDATED,
    KEY_ORTHO,
    KEY_TERRAIN,
    KEYS,
    MAX_BODY_BYTES,
)
from .github import GitHubBackup, GitHubError
from .store import HouseViewStore
from .validate import VALIDATORS

_LOGGER = logging.getLogger(__name__)


def _store(request: web.Request) -> HouseViewStore | None:
    return request.app[KEY_HASS].data.get(DOMAIN)


def _is_admin(request: web.Request) -> bool:
    user = request.get("hass_user")
    return bool(user and user.is_admin)


def _fire(hass: HomeAssistant, key: str, stamp: str | None) -> None:
    hass.bus.async_fire(EVENT_UPDATED, {"key": key, "updated": stamp})


def github_client(hass: HomeAssistant, store: HouseViewStore) -> GitHubBackup | None:
    o = store.options
    if not (o.get(CONF_REPO) and o.get(CONF_TOKEN)):
        return None
    return GitHubBackup(
        async_get_clientsession(hass),
        o[CONF_REPO],
        o[CONF_TOKEN],
        o.get(CONF_BRANCH, "main"),
        o.get(CONF_PATH, "house_view"),
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
        cfg = request.app[KEY_HASS].config
        return self.json(
            {
                "ha_version": HA_VERSION,
                "latitude": cfg.latitude,
                "longitude": cfg.longitude,
                "elevation": cfg.elevation,
                "country": cfg.country,
                "has_scene": store.has("scene"),
                "has_terrain": store.has("terrain"),
                "has_edits": store.has("edits"),
                "has_ortho": store.has(KEY_ORTHO),
                "github": store.options.get(CONF_REPO) if store.options.get(CONF_TOKEN) else None,
                "fetch": store.job,
                "updated": store.updated,
            }
        )


class HouseViewDataView(HomeAssistantView):
    """GET (any user) / POST / DELETE (admin) of one stored document."""

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
        if not _is_admin(request):
            return self.json_message("Admin only", HTTPStatus.UNAUTHORIZED)
        if request.content_length and request.content_length > MAX_BODY_BYTES:
            return self.json_message("Document too large", HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        try:
            doc: Any = json.loads(await request.read())
            VALIDATORS[self._key](doc)
        except (ValueError, TypeError) as err:  # json.JSONDecodeError is a ValueError
            return self.json_message(str(err), HTTPStatus.BAD_REQUEST)
        stamp = await store.async_set(self._key, doc)
        _fire(request.app[KEY_HASS], self._key, stamp)
        return self.json({"ok": True, "updated": stamp})

    async def delete(self, request: web.Request) -> web.Response:
        store = _store(request)
        if store is None:
            return self.json_message("House View is not set up", HTTPStatus.NOT_FOUND)
        if not _is_admin(request):
            return self.json_message("Admin only", HTTPStatus.UNAUTHORIZED)
        await store.async_remove(self._key)
        _fire(request.app[KEY_HASS], self._key, None)
        return self.json({"ok": True})


async def run_fetch(hass: HomeAssistant, store: HouseViewStore, params: ign.FetchParams) -> None:
    """Background job: fetch the terrain (and texture), store them, report through store.job."""
    job = store.job

    def progress(step: str) -> None:
        job["step"] = step

    try:
        terrain, photo, notes = await ign.fetch_all(
            async_get_clientsession(hass), params, hass.async_add_executor_job, progress
        )
        VALIDATORS[KEY_TERRAIN](terrain)
        _fire(hass, KEY_TERRAIN, await store.async_set(KEY_TERRAIN, terrain))
        if photo:
            _fire(hass, KEY_ORTHO, await store.async_set(KEY_ORTHO, photo))
        elif store.has(KEY_ORTHO):
            await store.async_remove(KEY_ORTHO)
            _fire(hass, KEY_ORTHO, None)
        job.update(state="done", step=None, message=" · ".join(notes))
    except (ign.FetchError, ValueError) as err:
        job.update(state="error", step=None, message=str(err))
    except Exception as err:
        _LOGGER.exception("House View terrain fetch failed")
        job.update(state="error", step=None, message=f"unexpected error: {err}")


class HouseViewFetchView(HomeAssistantView):
    """GET: state of the terrain fetch job. POST (admin): start it (cartes.gouv.fr, France only)."""

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
        if not _is_admin(request):
            return self.json_message("Admin only", HTTPStatus.UNAUTHORIZED)
        if store.job.get("state") == "running":
            return self.json_message("A fetch is already running", HTTPStatus.CONFLICT)
        try:
            params = ign.FetchParams.from_json(await request.json())
        except ValueError as err:
            return self.json_message(str(err), HTTPStatus.BAD_REQUEST)
        hass = request.app[KEY_HASS]
        store.job = {"state": "running", "step": "start", "message": ""}
        hass.async_create_background_task(run_fetch(hass, store, params), f"{DOMAIN}_fetch")
        return self.json(store.job, HTTPStatus.ACCEPTED)


class HouseViewGitHubView(HomeAssistantView):
    """POST (admin) {"action": "backup" | "restore"}: manual backup to / restore from the private repository."""

    url = f"/api/{DOMAIN}/github"
    name = f"api:{DOMAIN}:github"
    requires_auth = True

    async def post(self, request: web.Request) -> web.Response:
        store = _store(request)
        if store is None:
            return self.json_message("House View is not set up", HTTPStatus.NOT_FOUND)
        if not _is_admin(request):
            return self.json_message("Admin only", HTTPStatus.UNAUTHORIZED)
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
                    _fire(hass, key, await store.async_set(key, doc))
                return self.json({"ok": True, "restored": list(docs), "message": f"{len(docs)} file(s) restored"})
        except GitHubError as err:
            return self.json_message(str(err), HTTPStatus.BAD_GATEWAY)
        except ValueError as err:
            return self.json_message(f"invalid document in the repository: {err}", HTTPStatus.BAD_GATEWAY)
        return self.json_message("action must be backup or restore", HTTPStatus.BAD_REQUEST)


def all_views() -> list[HomeAssistantView]:
    return [HouseViewInfoView(), HouseViewFetchView(), HouseViewGitHubView(), *(HouseViewDataView(k) for k in KEYS)]
