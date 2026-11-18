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

from .const import CARD_URL, DOMAIN
from .http import all_views
from .store import HouseViewStore

_LOGGER = logging.getLogger(__name__)

_VIEWS_REGISTERED = f"{DOMAIN}_views_registered"
FRONTEND_FILE = Path(__file__).parent / "frontend" / "house-view-card.js"


async def _async_register_card(hass: HomeAssistant) -> None:
    """Serve the bundled card and load it on every dashboard (no manual Lovelace resource needed)."""
    if not await hass.async_add_executor_job(FRONTEND_FILE.is_file):
        _LOGGER.warning("House View card bundle not found (%s): build it with `npm run build` in card/", FRONTEND_FILE)
        return
    await hass.http.async_register_static_paths([StaticPathConfig(CARD_URL, str(FRONTEND_FILE), cache_headers=False)])
    manifest = json.loads(await hass.async_add_executor_job((Path(__file__).parent / "manifest.json").read_text))
    if "frontend" in hass.config.components:  # not loaded in headless setups
        add_extra_js_url(
            hass, f"{CARD_URL}?v={manifest['version']}"
        )  # version in the URL busts the browser cache on update


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Load the stored documents and expose them over HTTP."""
    store = HouseViewStore(hass)
    await store.async_load()
    store.options = dict(entry.options)
    hass.data[DOMAIN] = store
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))
    if not hass.data.get(_VIEWS_REGISTERED):  # routes cannot be removed: register once per run
        for view in all_views():
            hass.http.register_view(view)
        await _async_register_card(hass)
        hass.data[_VIEWS_REGISTERED] = True
    return True


async def _async_options_updated(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """New GitHub settings: used by the next backup / restore, nothing to reload."""
    store = hass.data.get(DOMAIN)
    if store is not None:
        store.options = dict(entry.options)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """The views stay registered but answer 404 while the entry is unloaded."""
    hass.data.pop(DOMAIN, None)
    return True
