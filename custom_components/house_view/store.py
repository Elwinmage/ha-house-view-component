"""Persistent storage of the House View documents."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.json import json_bytes
from homeassistant.helpers.storage import Store

from .const import CONF_LOCK, DOMAIN, KEYS, STORAGE_VERSION
from .lock import Unlocks


class HouseViewStore:
    """One JSON document per key in `.storage`, with a cached serialized form for the HTTP API."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        self._stores = {k: Store[Any](hass, STORAGE_VERSION, f"{DOMAIN}.{k}") for k in KEYS}
        self._data: dict[str, Any] = dict.fromkeys(KEYS)
        self._bytes: dict[str, bytes | None] = dict.fromkeys(KEYS)
        self.updated: dict[str, str | None] = dict.fromkeys(KEYS)
        self.options: dict[str, Any] = {}  # config entry options (GitHub backup, edit lock)
        self.unlocks = Unlocks()  # tokens of the cards that gave the edit password
        self.job: dict[str, Any] = {"state": "idle"}  # terrain fetch job, polled by the card

    @property
    def lock(self) -> dict[str, Any] | None:
        """Stored hash of the edit password, None when editing is not protected."""
        return self.options.get(CONF_LOCK) or None

    async def async_load(self) -> None:
        for key, store in self._stores.items():
            stored = await store.async_load()
            if isinstance(stored, dict) and "doc" in stored:
                self._data[key] = stored["doc"]
                self.updated[key] = stored.get("updated")

    def has(self, key: str) -> bool:
        return self._data[key] is not None

    def get_bytes(self, key: str) -> bytes | None:
        """Serialized document (cached until the next write), None when absent."""
        doc = self._data[key]
        if doc is None:
            return None
        if self._bytes[key] is None:
            self._bytes[key] = json_bytes(doc)
        return self._bytes[key]

    async def async_set(self, key: str, doc: Any) -> str:
        """Replace a document; returns the update timestamp."""
        stamp = datetime.now(UTC).isoformat()
        self._data[key] = doc
        self._bytes[key] = None
        self.updated[key] = stamp
        await self._stores[key].async_save({"doc": doc, "updated": stamp})
        return stamp

    async def async_remove(self, key: str) -> None:
        self._data[key] = None
        self._bytes[key] = None
        self.updated[key] = None
        await self._stores[key].async_remove()
