"""Config flow: nothing to ask, the home location comes from the Home Assistant configuration."""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult

from .const import DOMAIN


class HouseViewConfigFlow(ConfigFlow, domain=DOMAIN):
    """Single-step flow."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(title="House View", data={})
        return self.async_show_form(step_id="user")
