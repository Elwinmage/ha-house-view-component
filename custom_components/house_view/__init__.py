"""House View: dynamic pseudo-3D view of the house (data side).

The integration stores the plan (scene), the terrain and the manual edits, and serves them to the
`house-view-card` Lovelace card. Rendering, live lights and weather are done by the card.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .card_bundle import async_setup_card_bundle
from .catalog import CATALOGS, PLATFORMS
from .catalog_runtime import async_setup_catalog, async_unload_catalog
from .const import CONF_DEMO, CONF_LOCATION, CONF_LOCK, CONF_STORAGE, DOMAIN, LOADER_URL, PREVIEW_URL
from .http import all_views
from .store import HouseViewStore

_LOGGER = logging.getLogger(__name__)

_VIEWS_REGISTERED = f"{DOMAIN}_views_registered"
FRONTEND_FILE = Path(__file__).parent / "frontend" / "house-view-card.js"
PREVIEW_FILE = Path(__file__).parent / "frontend" / "preview.jpg"


async def _async_register_card(hass: HomeAssistant) -> None:
    """Serve the bundled card and load it on every dashboard (no manual Lovelace resource needed)."""
    if not await hass.async_add_executor_job(FRONTEND_FILE.is_file):
        # not fatal: the loader says so to the browser, and loads the bundle as soon as it is built
        _LOGGER.warning("House View card bundle not found (%s): build it with `npm run build` in card/", FRONTEND_FILE)
    if await hass.async_add_executor_job(PREVIEW_FILE.is_file):
        await hass.http.async_register_static_paths(
            [StaticPathConfig(PREVIEW_URL, str(PREVIEW_FILE), cache_headers=True)]
        )
    manifest = json.loads(await hass.async_add_executor_job((Path(__file__).parent / "manifest.json").read_text))
    # the bundle (CARD_URL) and its loader (LOADER_URL): see card_bundle.py
    await async_setup_card_bundle(hass, FRONTEND_FILE, manifest["version"])
    if "frontend" in hass.config.components:  # not loaded in headless setups
        # the dashboards load the loader, whose address never changes: a bundle built again, or a new release of
        # the card alone, is served at the next refresh of the browser, without restarting Home Assistant
        add_extra_js_url(hass, LOADER_URL)


def _store_of(hass: HomeAssistant, entry: ConfigEntry) -> HouseViewStore:
    store = HouseViewStore(hass, entry.data.get(CONF_STORAGE, DOMAIN))
    store.title = entry.title
    store.location = entry.data.get(CONF_LOCATION)
    store.demo = bool(entry.data.get(CONF_DEMO))
    return store


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Load the stored documents of the home and expose them over HTTP."""
    store = _store_of(hass, entry)
    await store.async_load()
    store.options = dict(entry.options)
    # one store per home, in the order the homes were set up (the first one answers requests naming no home)
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = store
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))
    if not hass.data.get(_VIEWS_REGISTERED):  # routes cannot be removed: register once per run
        for view in all_views():
            hass.http.register_view(view)
        await _async_register_card(hass)
        hass.data[_VIEWS_REGISTERED] = True
    # trees and objects: downloaded in the background, the built-in snapshot serves meanwhile
    for spec in CATALOGS:
        await async_setup_catalog(hass, entry, spec)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def _async_options_updated(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """New GitHub settings or edit password: used by the next request, nothing to reload."""
    store = hass.data.get(DOMAIN, {}).get(entry.entry_id)
    if store is not None:
        store.title = entry.title
        if store.options.get(CONF_LOCK) != entry.options.get(CONF_LOCK):
            store.unlocks.clear()  # password changed or removed: the cards have to unlock again
        store.options = dict(entry.options)
        store.remote = None  # another repository, branch or folder perhaps: read again when asked


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """The views stay registered but answer 404 while the entry is unloaded."""
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    for spec in CATALOGS:
        await async_unload_catalog(hass, entry, spec)
    homes = hass.data.get(DOMAIN, {})
    homes.pop(entry.entry_id, None)
    if not homes:
        hass.data.pop(DOMAIN, None)
    return unloaded


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """A home deleted: its documents go with it."""
    await _store_of(hass, entry).async_remove_all()
