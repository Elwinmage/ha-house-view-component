"""The catalogs the house view reads: trees, objects, pond fish and paths (house-catalog).

The download, the update entities and the websocket commands the card uses
(`house_view/catalog`, `house_view/catalog/subscribe`) come from the catalog client
(`catalog_pack.py`, `catalog_runtime.py`: copies of reeftech-catalog/client). That client only
knows the sections of its own repository: the ones of house-catalog are declared to it here, from
the description that catalog gives of itself (`house_catalog_sections.py`, a copy of
house-catalog/client). The snapshots in `catalog_builtin/`, `catalog_builtin_objects/`,
`catalog_builtin_pond_fish/` and `catalog_builtin_paths/` (copies of the entries of house-catalog)
serve before the first download.
"""

from __future__ import annotations

from . import house_catalog_sections as house
from .catalog_pack import register_section
from .catalog_runtime import CatalogSpec
from .const import DOMAIN

for _section, _kinds in house.SECTIONS.items():
    register_section(_section, _kinds, house.REPO)

#: The first section names the device and keeps the plain folders; the others carry their name
TREES = CatalogSpec(DOMAIN, "trees", "Trees", device_title="House view catalog")
OBJECTS = CatalogSpec(DOMAIN, "objects", "Objects", by_section=True)
FISH = CatalogSpec(DOMAIN, "pond_fish", "Pond fish", by_section=True)
PATHS = CatalogSpec(DOMAIN, "paths", "Paths", by_section=True)
CATALOGS = (TREES, OBJECTS, FISH, PATHS)

#: Platforms of the catalog entities: an update per section, the automatic update, "update now"
PLATFORMS = ["button", "switch", "update"]
