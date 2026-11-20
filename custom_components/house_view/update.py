"""Entities of the catalog (trees, objects, fish): see catalog.py."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .catalog_runtime import catalog_entities
from .const import DOMAIN


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    """Add the catalog entities of this platform."""
    async_add_entities(catalog_entities(hass, entry, DOMAIN, "update"))
