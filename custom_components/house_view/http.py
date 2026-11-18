"""HTTP API used by the card: /api/house_view/{info,scene,terrain,edits}.

Documents are big (a terrain grid is several MB), so they go through plain HTTP rather than the websocket API,
whose messages are limited to a few MB.
"""

from __future__ import annotations

from http import HTTPStatus
import json
from typing import Any

from aiohttp import web
from homeassistant.components.http import KEY_HASS, HomeAssistantView
from homeassistant.const import __version__ as HA_VERSION

from .const import DOMAIN, EVENT_UPDATED, KEYS, MAX_BODY_BYTES
from .store import HouseViewStore
from .validate import VALIDATORS


def _store(request: web.Request) -> HouseViewStore | None:
    return request.app[KEY_HASS].data.get(DOMAIN)


def _is_admin(request: web.Request) -> bool:
    user = request.get("hass_user")
    return bool(user and user.is_admin)


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
        request.app[KEY_HASS].bus.async_fire(EVENT_UPDATED, {"key": self._key, "updated": stamp})
        return self.json({"ok": True, "updated": stamp})

    async def delete(self, request: web.Request) -> web.Response:
        store = _store(request)
        if store is None:
            return self.json_message("House View is not set up", HTTPStatus.NOT_FOUND)
        if not _is_admin(request):
            return self.json_message("Admin only", HTTPStatus.UNAUTHORIZED)
        await store.async_remove(self._key)
        request.app[KEY_HASS].bus.async_fire(EVENT_UPDATED, {"key": self._key, "updated": None})
        return self.json({"ok": True})


def all_views() -> list[HomeAssistantView]:
    return [HouseViewInfoView(), *(HouseViewDataView(k) for k in KEYS)]
