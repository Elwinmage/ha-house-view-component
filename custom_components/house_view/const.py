"""Constants of the House View integration."""

DOMAIN = "house_view"

# Stored documents (one JSON document each, kept in .storage/house_view.<key>)
KEY_SCENE = "scene"  # generic scene: levels, rooms, walls, openings, lights, furniture, vegetation, site, views
KEY_TERRAIN = "terrain"  # height grid (DTM, optional DSM and vector layers)
KEY_EDITS = "edits"  # manual corrections: registration, outdoor objects, trees, ground edits, views
KEY_ORTHO = "ortho"  # ground texture: aerial photo or IGN map (base64 image + Web Mercator window)
KEYS = (KEY_SCENE, KEY_TERRAIN, KEY_EDITS, KEY_ORTHO)

STORAGE_VERSION = 1

EVENT_UPDATED = f"{DOMAIN}_updated"

# Upper bound of an uploaded document, in bytes (the HA web server itself caps requests at 16 MiB)
MAX_BODY_BYTES = 15 * 1024 * 1024

# The Lovelace card is bundled with the integration (built from /card): served at CARD_URL and loaded on every dashboard
CARD_URL = f"/{DOMAIN}/house-view-card.js"

# Options (GitHub backup)
CONF_REPO = "repo"
CONF_TOKEN = "token"
CONF_BRANCH = "branch"
CONF_PATH = "path"
