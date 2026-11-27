"""The bundled Lovelace card, served so that a new bundle needs no restart of Home Assistant.

Home Assistant loads a tiny loader on every dashboard (`LOADER_URL`). It lives under `/api/`, which neither the
browser nor the service worker of Home Assistant keeps, and does one thing: import the bundle under an address that
carries the fingerprint of the file as it is on disk right now (`CARD_URL?v=<version>-<digest>`). A bundle replaced
on disk is therefore the one a plain refresh of the browser loads, and the bundle itself is kept by the browser for
as long as it does not change.

What is served is what was fingerprinted: the bundle is read once, when its file has stopped changing (a copy in
progress is never served half-way), and kept in memory. A browser can thus never keep a truncated bundle under the
address of a whole one.

The dashboards that are open are told as well (`house_view/card/subscribe`): each card gets the fingerprint when it
subscribes and again when it changes, compares it with its own and offers to reload the page, or reloads it by
itself (card option `auto_reload`). The file is looked at every few seconds, only while a card is subscribed.
"""

from __future__ import annotations

import asyncio
import hashlib
from collections.abc import Callable
from datetime import timedelta
from pathlib import Path
from typing import Any

import voluptuous as vol
from aiohttp import web
from homeassistant.components.http import KEY_HASS, HomeAssistantView
from homeassistant.components.websocket_api import async_register_command
from homeassistant.components.websocket_api.connection import ActiveConnection
from homeassistant.components.websocket_api.decorators import websocket_command
from homeassistant.components.websocket_api.messages import event_message
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers.event import async_track_time_interval

from .const import CARD_URL, DOMAIN, LOADER_URL

DATA_BUNDLE = f"{DOMAIN}_card_bundle"
# How often the file is looked at while a dashboard is open (its date and size: it is read again only when they change)
WATCH_INTERVAL = timedelta(seconds=15)
# A file that changed is read once its date and size are the same at two looks this far apart (seconds), and it is
# given up for this time after that many looks: a copy still going on is read at the next occasion
SETTLE_DELAY = 0.3
SETTLE_LOOKS = 6
# The bundle under the address of its fingerprint never changes: the browser keeps it for a year
KEPT = "public, max-age=31536000, immutable"
NOT_KEPT = "no-cache"

Signature = tuple[int, int]


class CardBundle:
    """The bundle as last read (fingerprint and content), with the cards waiting to hear that it changed."""

    def __init__(self, hass: HomeAssistant, path: Path, version: str) -> None:
        self.hass = hass
        self.path = path
        self.version = version
        self.build: str | None = None  # "<version>-<digest>" of the content, None without a file
        self.body = b""
        self._seen: Signature | None = None  # date and size of the file when it was read
        self._lock = asyncio.Lock()
        self._listeners: set[Callable[[], None]] = set()
        self._unwatch: CALLBACK_TYPE | None = None

    def _signature(self) -> Signature | None:
        """Date and size of the file, None when it is not there (in the executor)."""
        try:
            stat = self.path.stat()
        except OSError:
            return None
        return (stat.st_mtime_ns, stat.st_size)

    def _load(self) -> tuple[Signature | None, bytes]:
        """The content of the file, with its date and size when they did not move meanwhile (in the executor)."""
        before = self._signature()
        try:
            body = self.path.read_bytes()
        except OSError:
            return None, b""
        return (before if before == self._signature() else None), body

    async def _settled(self) -> tuple[Signature | None, bytes] | None:
        """The file once it has stopped changing: its date and size, and its content. None while it still changes."""
        job = self.hass.async_add_executor_job
        last = await job(self._signature)
        for _ in range(SETTLE_LOOKS):
            if last is None:
                return None, b""  # no file (any more)
            await asyncio.sleep(SETTLE_DELAY)
            now = await job(self._signature)
            if now == last:
                seen, body = await job(self._load)
                if seen == last:
                    return seen, body
                now = await job(self._signature)
            last = now
        return None

    async def async_refresh(self, _now: Any = None) -> str | None:
        """Look at the file again; the cards are told when its fingerprint changed. Returns the fingerprint."""
        async with self._lock:
            if await self.hass.async_add_executor_job(self._signature) == self._seen:
                return self.build
            settled = await self._settled()
            if settled is None:
                return self.build  # being written: what was read before is still what is served
            self._seen, self.body = settled
            build = f"{self.version}-{hashlib.sha256(self.body).hexdigest()[:8]}" if self._seen else None
            if build != self.build:
                self.build = build
                for listener in list(self._listeners):
                    listener()
            return self.build

    @callback
    def async_add_listener(self, listener: Callable[[], None]) -> CALLBACK_TYPE:
        """Call `listener` when the fingerprint changes. The file is watched while there is a listener."""
        self._listeners.add(listener)
        if self._unwatch is None:
            self._unwatch = async_track_time_interval(
                self.hass, self.async_refresh, WATCH_INTERVAL, cancel_on_shutdown=True
            )

        @callback
        def _remove() -> None:
            self._listeners.discard(listener)
            if not self._listeners and self._unwatch is not None:
                self._unwatch()
                self._unwatch = None

        return _remove


class CardLoaderView(HomeAssistantView):
    """The loader: one line importing the bundle under its fingerprint of the moment. Never kept by the browser."""

    url = LOADER_URL
    name = f"api:{DOMAIN}:card"
    requires_auth = False  # loaded by the page itself, like the bundle: nothing in it but the fingerprint

    async def get(self, request: web.Request) -> web.Response:
        bundle: CardBundle = request.app[KEY_HASS].data[DATA_BUNDLE]
        build = await bundle.async_refresh()
        text = f'import "{CARD_URL}?v={build}";\n' if build else "// House View: card bundle not found\n"
        return web.Response(text=text, content_type="text/javascript", headers={"Cache-Control": NOT_KEPT})


class CardBundleView(HomeAssistantView):
    """The bundle itself, as it was fingerprinted: kept by the browser under the address of its fingerprint."""

    url = CARD_URL
    name = f"{DOMAIN}:card"
    requires_auth = False

    async def get(self, request: web.Request) -> web.Response:
        bundle: CardBundle = request.app[KEY_HASS].data[DATA_BUNDLE]
        if bundle.build is None:
            return web.Response(status=404, text="House View: card bundle not found")
        # asked under another fingerprint (an older page, a link typed by hand): served, but not to be kept
        kept = request.query.get("v") == bundle.build
        response = web.Response(
            body=bundle.body, content_type="text/javascript", headers={"Cache-Control": KEPT if kept else NOT_KEPT}
        )
        response.enable_compression()
        return response


@websocket_command({vol.Required("type"): f"{DOMAIN}/card/subscribe"})
@callback
def ws_card_subscribe(hass: HomeAssistant, connection: ActiveConnection, msg: dict[str, Any]) -> None:
    """An event `{build}` when subscribing, then each time the bundle on disk changes."""
    bundle: CardBundle = hass.data[DATA_BUNDLE]

    @callback
    def _changed() -> None:
        connection.send_message(event_message(msg["id"], {"build": bundle.build}))

    connection.subscriptions[msg["id"]] = bundle.async_add_listener(_changed)
    connection.send_result(msg["id"])
    _changed()


async def async_setup_card_bundle(hass: HomeAssistant, path: Path, version: str) -> CardBundle:
    """Read the bundle, serve it with its loader and answer the cards. Once per run."""
    bundle = CardBundle(hass, path, version)
    hass.data[DATA_BUNDLE] = bundle
    await bundle.async_refresh()
    hass.http.register_view(CardLoaderView())
    hass.http.register_view(CardBundleView())
    async_register_command(hass, ws_card_subscribe)
    return bundle
