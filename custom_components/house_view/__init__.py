"""House View: dynamic pseudo-3D view of the house (data side).

The integration stores the plan (scene), the terrain and the manual edits, and serves them to the
`house-view-card` Lovelace card. Rendering, live lights and weather are done by the card.
"""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .http import all_views
from .store import HouseViewStore

_VIEWS_REGISTERED = f"{DOMAIN}_views_registered"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Load the stored documents and expose them over HTTP."""
    store = HouseViewStore(hass)
    await store.async_load()
    hass.data[DOMAIN] = store
    if not hass.data.get(_VIEWS_REGISTERED):  # routes cannot be removed: register once per run
        for view in all_views():
            hass.http.register_view(view)
        hass.data[_VIEWS_REGISTERED] = True
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """The views stay registered but answer 404 while the entry is unloaded."""
    hass.data.pop(DOMAIN, None)
    return True
