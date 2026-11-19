"""Config flow: one entry per home, with its name and its location (the Home Assistant one by default).

Options, behind a menu: the private GitHub repository used by the manual backup / restore of the setup panel, and
the password asked by the card before its editors open.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.const import CONF_NAME
from homeassistant.core import callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import LocationSelector, TextSelector, TextSelectorConfig, TextSelectorType

from .const import (
    CONF_BRANCH,
    CONF_DEMO,
    CONF_LOCATION,
    CONF_LOCK,
    CONF_PASSWORD,
    CONF_PATH,
    CONF_REMOVE,
    CONF_REPO,
    CONF_STORAGE,
    CONF_TOKEN,
    DEMO_LOCATION,
    DEMO_TITLE,
    DOMAIN,
)
from .github import GitHubBackup, GitHubError
from .lock import MIN_LENGTH, hash_password


class HouseViewConfigFlow(ConfigFlow, domain=DOMAIN):
    """One step: the name of the home and where it is."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        home = {"latitude": self.hass.config.latitude, "longitude": self.hass.config.longitude}
        if user_input is not None:
            user_input = {CONF_LOCATION: home, **user_input}
            name = (user_input.get(CONF_NAME) or "").strip()
            if not name:
                errors[CONF_NAME] = "name_required"
            elif any(e.title == name for e in self._async_current_entries()):
                errors[CONF_NAME] = "name_taken"
            else:
                # the form always carries a location (the Home Assistant one by default)
                loc = user_input[CONF_LOCATION]
                data = {
                    CONF_STORAGE: f"{DOMAIN}.{uuid4().hex}",
                    CONF_LOCATION: {"latitude": loc["latitude"], "longitude": loc["longitude"]},
                }
                return self.async_create_entry(title=name, data=data)
        first = not self._async_current_entries()
        schema = vol.Schema(
            {
                vol.Required(CONF_NAME, default=(user_input or {}).get(CONF_NAME, "House View" if first else "")): str,
                vol.Optional(CONF_LOCATION, default=(user_input or {}).get(CONF_LOCATION, home)): LocationSelector(),
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema, errors=errors)

    async def async_step_demo(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """The demo home, started from the card: fictitious location, documents filled by the integration."""
        if any(e.data.get(CONF_DEMO) for e in self._async_current_entries()):
            return self.async_abort(reason="demo_exists")
        data = {CONF_STORAGE: f"{DOMAIN}.{uuid4().hex}", CONF_LOCATION: dict(DEMO_LOCATION), CONF_DEMO: True}
        return self.async_create_entry(title=DEMO_TITLE, data=data)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> HouseViewOptionsFlow:
        return HouseViewOptionsFlow()


class HouseViewOptionsFlow(OptionsFlow):
    """Menu: GitHub backup settings, edit password. Each step keeps the settings of the other one."""

    @property
    def _folder(self) -> str:
        """Default folder of the backup: one per home (the first home in the original one)."""
        return self.config_entry.data.get(CONF_STORAGE, DOMAIN).replace(".", "/")

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        return self.async_show_menu(step_id="init", menu_options=["github", "lock"])

    async def async_step_lock(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Set, change or remove the edit password (an empty field keeps the current one)."""
        errors: dict[str, str] = {}
        options = dict(self.config_entry.options)
        if user_input is not None:
            password = user_input.get(CONF_PASSWORD) or ""
            if user_input.get(CONF_REMOVE):
                options.pop(CONF_LOCK, None)
            elif password and len(password) < MIN_LENGTH:
                errors[CONF_PASSWORD] = "too_short"
            elif password:
                options[CONF_LOCK] = await self.hass.async_add_executor_job(hash_password, password)
            if not errors:
                return self.async_create_entry(data=options)
        schema = vol.Schema(
            {
                vol.Optional(CONF_PASSWORD): TextSelector(TextSelectorConfig(type=TextSelectorType.PASSWORD)),
                vol.Optional(CONF_REMOVE, default=False): bool,
            }
        )
        return self.async_show_form(
            step_id="lock",
            data_schema=schema,
            errors=errors,
            description_placeholders={"status": "🔒" if options.get(CONF_LOCK) else "🔓"},
        )

    async def async_step_github(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """GitHub backup settings. An empty repository disables the backup."""
        errors: dict[str, str] = {}
        current = {**self.config_entry.options, **(user_input or {})}
        keep = {k: v for k, v in self.config_entry.options.items() if k == CONF_LOCK}
        if user_input is not None:
            repo = user_input.get(CONF_REPO, "").strip()
            if not repo:
                return self.async_create_entry(data=keep)
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
                    user_input.get(CONF_PATH, self._folder),
                )
                try:
                    await gh.check()
                except GitHubError as err:
                    errors["base"] = "repo_public" if "public" in str(err) else "cannot_connect"
                else:
                    return self.async_create_entry(data={**keep, **user_input, CONF_REPO: repo})
        schema = vol.Schema(
            {
                vol.Optional(CONF_REPO, default=current.get(CONF_REPO, "")): str,
                vol.Optional(CONF_TOKEN, default=current.get(CONF_TOKEN, "")): str,
                vol.Optional(CONF_BRANCH, default=current.get(CONF_BRANCH, "main")): str,
                vol.Optional(CONF_PATH, default=current.get(CONF_PATH, self._folder)): str,
            }
        )
        return self.async_show_form(step_id="github", data_schema=schema, errors=errors)
