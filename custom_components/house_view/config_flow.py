"""Config flow: nothing to ask, the home location comes from the Home Assistant configuration.

Options: the private GitHub repository used by the manual backup / restore of the setup panel.
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import CONF_BRANCH, CONF_PATH, CONF_REPO, CONF_TOKEN, DOMAIN
from .github import GitHubBackup, GitHubError


class HouseViewConfigFlow(ConfigFlow, domain=DOMAIN):
    """Single-step flow."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(title="House View", data={})
        return self.async_show_form(step_id="user")

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> HouseViewOptionsFlow:
        return HouseViewOptionsFlow()


class HouseViewOptionsFlow(OptionsFlow):
    """GitHub backup settings. An empty repository disables the backup."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        current = {**self.config_entry.options, **(user_input or {})}
        if user_input is not None:
            repo = user_input.get(CONF_REPO, "").strip()
            if not repo:
                return self.async_create_entry(data={})
            if repo.count("/") != 1:
                errors[CONF_REPO] = "bad_repo"
            elif not user_input.get(CONF_TOKEN):
                errors[CONF_TOKEN] = "token_required"
            else:
                gh = GitHubBackup(
                    async_get_clientsession(self.hass),
                    repo,
                    user_input[CONF_TOKEN],
                    user_input.get(CONF_BRANCH, "main"),
                    user_input.get(CONF_PATH, "house_view"),
                )
                try:
                    await gh.check()
                except GitHubError as err:
                    errors["base"] = "repo_public" if "public" in str(err) else "cannot_connect"
                else:
                    return self.async_create_entry(data={**user_input, CONF_REPO: repo})
        schema = vol.Schema(
            {
                vol.Optional(CONF_REPO, default=current.get(CONF_REPO, "")): str,
                vol.Optional(CONF_TOKEN, default=current.get(CONF_TOKEN, "")): str,
                vol.Optional(CONF_BRANCH, default=current.get(CONF_BRANCH, "main")): str,
                vol.Optional(CONF_PATH, default=current.get(CONF_PATH, "house_view")): str,
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema, errors=errors)
