"""Which geodata services fetch the terrain: the French ones (ign.py) or the worldwide ones (world.py).

"auto" picks the French services in France, the worldwide ones elsewhere; when the French services have nothing for
the place, the worldwide ones take over.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace
from typing import Any

import aiohttp

from . import ign, world
from .ign import FetchError, FetchParams, Progress

# ISO codes of France and of its overseas territories, as set in the Home Assistant configuration
FRENCH = frozenset({"FR", "GP", "MQ", "GF", "RE", "YT", "PM", "BL", "MF"})
MODULES = {"ign": ign, "world": world}


def order(provider: str, country: str | None, lat: float, lon: float) -> list[str]:
    """Providers to try in turn."""
    if provider != "auto":
        return [provider]
    if country:
        return ["ign", "world"] if country.upper() in FRENCH else ["world"]
    # no country in the configuration: go by a box around metropolitan France (it also takes in some neighbours,
    # for which the French services answer "no data" and the worldwide ones take over)
    return ["ign", "world"] if 41.0 < lat < 51.5 and -5.5 < lon < 10.0 else ["world"]


async def fetch_all(
    session: aiohttp.ClientSession,
    p: FetchParams,
    country: str | None,
    run_sync: Callable[..., Any],
    progress: Progress,
) -> tuple[dict[str, Any], dict[str, Any] | None, list[str]]:
    """(terrain document, texture document or None, notes for the user) from the first provider that has data."""
    *first, last = order(p.provider, country, p.lat, p.lon)
    failed = ""
    for name in first:
        try:
            # each provider works on its own copy: it moves the point onto the house and adapts the grid step
            return await MODULES[name].fetch_all(session, replace(p), run_sync, progress)
        except FetchError as err:
            failed = str(err)
    terrain, photo, notes = await MODULES[last].fetch_all(session, replace(p), run_sync, progress)
    if failed:
        notes.insert(0, f"French services: {failed}; worldwide sources used instead")
    return terrain, photo, notes
