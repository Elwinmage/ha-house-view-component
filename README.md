<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="custom_components/house_view/brand/dark_logo.png">
    <img src="custom_components/house_view/brand/logo.png" alt="House View" width="420">
  </picture>
</p>

# House View

**Supported languages:**
[<img src="https://flagicons.lipis.dev/flags/4x3/fr.svg" style="width: 5%;"/>](doc/fr/README.fr.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/gb.svg" style="width: 5%;"/>](README.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/es.svg" style="width: 5%;"/>](doc/es/README.es.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/de.svg" style="width: 5%;"/>](doc/de/README.de.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/pl.svg" style="width: 5%;"/>](doc/pl/README.pl.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/pt.svg" style="width: 5%;"/>](doc/pt/README.pt.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/it.svg" style="width: 5%;"/>](doc/it/README.it.md)

A live pseudo-3D view of your house for Home Assistant: your **Sweet Home 3D** plan on a digital terrain model, with lights, weather, sun and seasons in real time, plus a robot vacuum, garden watering and fences. One repository holds:

- `custom_components/house_view/`: the **integration** (stores the plan, the terrain and your edits; fetches the terrain; HTTP API);
- `card/`: the **Lovelace card** `house-view-card` (three.js), built into `custom_components/house_view/frontend/`. The integration serves it itself (`/house_view/house-view-card.js`) and loads it on every dashboard: **no Lovelace resource to declare**.

The card interface exists in English and French; the options of the integration in English, French, Italian, German, Spanish, Polish and Portuguese. Translations are welcome: the texts are in `custom_components/house_view/translations/` and `card/src/i18n.js`.

## Installation

1. Install with HACS (custom repository, type *Integration*), or copy `custom_components/house_view/` into `config/custom_components/`, then restart Home Assistant.
2. Add the *House View* integration. There is nothing to set: the location comes from the Home Assistant configuration.
3. Add the card to a dashboard (`type: custom:house-view-card`).
4. Open ⚙ in the card (administrators only) to import your `.sh3d` plan, then fetch the terrain (cartes.gouv.fr in France, worldwide open data elsewhere: see [Terrain sources by country](#terrain-sources-by-country)) or load a terrain `.json`.

The version of the card is printed in the browser console when it loads (`🏠 HOUSE VIEW v0.x.y`). Cleaning by rooms and the icon of the integration need Home Assistant 2026.3 or later.

The built card is not committed: `release.yml` builds it at each release and publishes `house_view.zip`, which HACS installs. For development: `cd card && npm install && npm run build`.

## Card configuration

The options are set in the visual editor of the card (edit the dashboard, then *Edit* on the card), in four sections: time and weather, display, lights, robot vacuum. The plan, the terrain and everything placed in the view are set in the card itself (✎ and ⚙). In YAML:

```yaml
type: custom:house-view-card
weather_entity: weather.home          # live weather (optional)
rain_entity: binary_sensor.rain       # optional: rain detector or rain rate sensor (mm/h) of your weather station
wind_speed_entity: sensor.wind_speed   # optional: wind speed sensor (weather station or internet weather service)
wind_bearing_entity: sensor.wind_dir  # optional: wind direction sensor (degrees or compass points)
mode: live                            # live (real time) | simulation (time / date / weather sliders)
view: Vue générale                    # starting view (optional): the name shown on its button
show_views: true                      # camera view buttons
show_levels: true                     # roof / level buttons (+ 🌡 when room temperatures are known)
tap_action: zoom                      # tap on a room: zoom (second tap = lights) | toggle_lights | none
show_entities: true                   # entities placed in the editor
vacuum_entity: vacuum.robot           # optional: the first vacuum.* found by default
vacuum_poll: 15                       # seconds between two position readings (Roborock: cloud action, min 5)
vacuum_show_floor: false              # true = while cleaning, show the floor of the robot from above
vacuum_rate: 1                        # m²/min, for the estimated path of a robot without position
vacuum_progress_entity: sensor.xxx    # optional: progress (%); found automatically for Roborock
movable_camera: true                  # movable camera (orbit, zoom, pan); false = fixed on the views
height: fill                          # fill (screen height below the top of the card) | aspect (16/10) | 600 | "70vh"
min_height: 320                       # minimum height in fill mode (px)
fps_cap: 30                           # frames per second limit (wall screens, tablets)
light_entities: [light.living, ...]   # optional: restricts the lights taken into account
```

## Live view

- **Latitude, longitude, time zone**: read from the Home Assistant configuration. The seasons of the vegetation are reversed in the southern hemisphere.
- **Rooms ↔ areas**: a room of the plan is linked to the Home Assistant area of the same name (accents and case ignored). ⚙ lists the rooms without a matching area; ✎ → *Rooms ↔ Home Assistant areas* lets you pick another area, or none, room by room.
- **Lights**: state, colour and brightness of the `light.*` entities of the area of each room.
- **Weather**: the weather entity `weather_entity` decides the weather shown: rain (`rainy`, `pouring`, `hail`), snow (`snowy`, `snowy-rainy`), thunderstorm (`lightning`, `lightning-rainy`), fog, clouds; its temperature, wind and cloud cover are used when provided. With `rain_entity` (a rain detector `binary_sensor`, or a rain rate sensor in mm/h), the rain follows what really falls at your place: rain on the sensor → rain, heavier or lighter with the measured rate; the weather service says rain but the sensor is dry → overcast sky without rain (thunderstorm: lightning without rain). Snow and thunderstorms stay with the weather service, since a rain gauge cannot tell them apart; a cumulated amount ("rain today" in mm) is ignored, as it does not say whether it is raining now.
- **Wind and rain intensity**: rain and snow fall at a slant when the wind blows, leaning the way it blows: the stronger the wind, the more they lean (calm → vertical, 60 km/h and more → about 50°). The direction follows the north of the plan, so a west wind pushes the rain toward the east side of your house. Wind speed and direction come from the weather entity (`wind_speed`, `wind_bearing`), or from sensors of your own with `wind_speed_entity` (km/h, m/s, mph, kn, ft/s, Beaufort) and `wind_bearing_entity` (degrees, or compass points such as `NW`): a weather station, or the sensors of an internet weather service. The amount of rain sets how the rain looks: a drizzle is sparse, slow and short, a downpour dense, fast and long. It comes from the rate of `rain_entity` (mm/h; 8 mm/h and more is a downpour), else from the weather entity (`pouring` is heavier than `rainy`). A sensor that is unavailable leaves the weather entity in charge.
- **Zoom on a room**: a tap zooms on the room (roof and upper floors hidden); a second tap on the same room toggles its lights; *← room* goes back to the previous view.
- **Preview** (weather button): forces a season (spring, summer, autumn, winter), a weather (clear, cloudy, rain, thunderstorm, snow, fog) or a moment (morning, noon, dusk, night), which can be combined; back to live with the *Preview … ✕* button, or automatically after 3 minutes. In simulation mode these are shortcuts to the sliders.
- **Camera**: the button at the top right unlocks or locks the camera without touching the configuration.
- **Temperatures**: the temperature sensor of the area (set on the area in Home Assistant), else the first `sensor.*` with `device_class: temperature` of the area; shown on hover and as a layer (🌡).
- **Simulation mode**: ☀ opens time (with playback), date, weather preset, clouds, precipitation, wind (strength and direction), temperature and snow.
- **Roads**: drawn as asphalt on the relief (can be switched off in ⚙).
- **Performance**: rendering stops when the card is not visible; the light volumes are only rebuilt when a useful state changes.

## Robot vacuum

- **Cleaning by rooms**: when a `vacuum.*` entity exists, its icon appears at the top right. A tap opens the room selection (the floor of the robot is shown from above): each room tapped, when linked to an area, is highlighted, then *Clean* calls `vacuum.clean_area` with the chosen areas (generic action of Home Assistant 2026.3+; the mapping between the rooms of the robot and the areas is done once in the settings of the vacuum entity). *Start*, *Pause* and *Dock* too.
- **Following the cleaning** (✎ → *Robot vacuum*): a 3D robot (colour of your choice, white by default) moves on the plan, the room being cleaned is tinted (colour of your choice) with its percentage, the rooms still to come are tinted lighter, a finished room sparkles for one minute, and a circular gauge around the robot icon gives the overall progress. On an error (`error`), the room and the robot blink red with a ⚠ sign.
- **Dock**: *Place the dock*, then tap the floor; it is the reference point between the map of the robot and the plan. Its **direction** is set in degrees (0° = facing the top of the plan, 90° to the right, the default), by quarter turns (⟲ / ⟳) or with *Aim with a tap*: tap in front of the dock, where the robot comes out. The idle robot parks in front of the dock, facing the same way.
- **Robot position**: *Roborock* (official action `roborock.get_vacuum_current_position`, dock at 25500 / 25500; it goes through the cloud, hence one reading every `vacuum_poll` seconds, slowed down after an error), *attributes of an entity* (`vacuum_position {x, y}` and `charger`, as map extractors provide), or *none*: the robot then follows an estimated path (back and forth, room by room), marked "estimated position".
- **Calibration**: rotation, mirror and scale; *Calibrate with a tap* computes the rotation when you tap the real position of the robot once out of its dock; *remember* stores the coordinates of the dock for other brands.
- **Percentage of a room**: share of the floor covered by the robot (estimate: 80 % of the floor is assumed reachable); the overall progress comes from the sensor of the robot when there is one (Roborock: `cleaning_progress`).
- *Test the animation* plays an accelerated cleaning (with or without an error) without starting the robot.

## Catalog: trees and objects

The trees and the pieces of furniture are not built into the card: they come from the [house catalog](https://github.com/Elwinmage/house-catalog), where adding a species or an object is a pull request, not a new version of this integration.

- **Trees**: each species has up to four renderings, one per season: colour and density of the foliage, blossom, fruits, leaves on the ground. The view blends from one season to the next, day after day (oak, pine, yew, cherry tree and apricot tree to start with). They are the species offered when you plant a tree in the editor, within the heights the catalog gives.
- **Objects**: a piece of furniture of the plan whose name holds a keyword of a catalog object (`Chaise`, `Chair`, `Stuhl`…) is drawn with it, at the place and size of the piece, instead of a plain box; when the plan gives the piece a colour, the object takes it on its tinted parts. Likewise a plant of the plan named after a tree of the catalog (`Cerisier`, `Yew`) is drawn as that tree.
- **Updates**: the integration downloads the catalog from GitHub in the background (the card never calls the network) and works offline with the copy it ships. The device *House view catalog* has an update entity per section (trees, objects), an *Automatic update* switch (on by default) and an *Update now* button.
- **Your own entries**: with the [catalog editor](https://github.com/Elwinmage/catalog-editor), a tree or an object you save is used by the view at once, before (or without) proposing it to the catalog.

## Editor (✎)

For administrators. One section is unfolded at a time; everything is saved in the edits file, apart from the plan and the terrain; Escape cancels the drawing in progress.

- **Placed entities** (sensors, lights, switches, selects…): placed with a tap, then moved by dragging their label (editor open). Fixed to the floor (default: the label stays in its room whatever the angle), to a wall (room side, hidden when the wall is seen from behind) or free in height; a label hidden by an upper floor or the roof is not shown. Badge (icon + value) or icon only; colour, label, icon (Home Assistant icon picker with preview); visible always, on the view of its floor or when zoomed on its room; tap = more-info, toggle or nothing. In the editor the list is folded: only the chosen entity is unfolded.
- **Placed lights**: a placed `light.*` becomes a light source at that spot of the room (spot, pendant, lamp, strip or invisible; height and reach adjustable; on a wall: a wall lamp at the height tapped), driven by its own state and colour. The other lights of the area keep lighting the whole room.
- **Room view**: zoomed on a room, with the editor open, *📷 Room view* saves the camera and the visible levels; a tap on that room then opens this view instead of the automatic zoom. *Automatic view* goes back to it.
- **Fences** (*Fences*): each side has its type (mesh, wood, wall, hedge, or open for a gate) and its height. Two ways to create one: *Fence from the cadastre* (the parcels of the house are preselected, tap to add or remove the neighbouring parcels of the same property; the outline of the whole is fenced) or *Draw a fence* (successive taps, the "Dessus" top view is recommended; each side takes the type chosen in the palette, one colour per type). *Edit the sides*: change the type of a side with a tap, cut a side in two (one part as a wall, the other as mesh), remove a point.
- **Watering** (*Watering*):
  - **Drip lines**: one line per valve (`switch`, `valve`, `input_boolean`), drawn point by point and rounded when rendered; black, brown, green or hidden pipe. When the valve is open the line turns blue, glints run along it, a drop swells and shrinks in a loop under each emitter (30 cm apart by default, slightly out of step from one emitter to the next: the line twinkles) and a wet spot grows until it forms a strip. The width of the spot follows the Schwartzman & Zur (1986) model, from the emitter flow, the opening time and the soil type; it fades within 30 minutes after closing.
  - **Sprinklers**: one circuit per valve, with one or several sprinklers (catalogue model: Hunter Pro-Spray PSU-04 8A to 17A, SRM-04, PGJ-04, PGP Ultra, MP Rotator, or generic; minimum / maximum distance, direction and angle prefilled and editable; *Aim* with a tap). When the valve is open the estimated watered sector is shown and the jet is animated (sweeping for a rotor, fan for a spray nozzle).
  - *Test the animation* plays 30 seconds of accelerated watering (30 s = 1 h 30) on every line and circuit, without opening any valve: the wet spot grows, the jets turn, then everything goes back to the real state. The *Test* button of a line or a circuit does the same for it alone; closing the editor stops the test.
- **Other tools**: outdoor objects (hide, height, offset, rotation), pool level, trees (remove, add with species and height, undo, restore all), ground corrections (low wall, terrace, brushes, cut, editable list of corrections), views.

## Setup (⚙)

- **Plan**: *Import a .sh3d* reads your Sweet Home 3D file in the browser and lists what was found (levels, rooms, walls, lights…).
- **Fetching the terrain** (*Terrain (DTM)*): the integration fetches the relief and its surroundings itself, around the coordinates of Home Assistant (editable). The source follows the country of the Home Assistant configuration (*Automatic*), or is forced in the form:
  - **France: cartes.gouv.fr (IGN)**: LiDAR HD ground at 0.5 m (RGE ALTI at 1 m otherwise), surface model (automatic registration, trees), buildings, roads and cadastre (BD TOPO, parcels), aerial photo or IGN map draped on the ground. When the IGN has no data for the place, the worldwide sources take over;
  - **World: Mapterhorn + OpenStreetMap**: relief from the [Mapterhorn](https://mapterhorn.com) tiles (open LiDAR of many countries, 30 m elsewhere; failing that, the coarser Terrain Tiles of Mapzen hosted by AWS), buildings and roads from OpenStreetMap. No surface model, cadastre or aerial photo: trees are placed with the editor, the fence is drawn by hand.

  In both cases: optional snapping to the nearest building (the location of Home Assistant is often approximate), automatic registration of the plan at the end, and the source shown under the form.
- **GitHub backup**: options of the integration, *GitHub backup* menu (private repository `owner/name`, fine-grained token with *Contents: read and write*, branch, folder); *Back up to GitHub* / *Restore from GitHub* buttons in ⚙. Only the changed files are committed; a public repository is refused (it holds the plan of your house).
- **Edit protection**: only Home Assistant administrators can change the view. To also avoid changes made by mistake (a shared screen left logged in with an administrator account), a password can be asked before the editor ✎ and the setup ⚙ open:
  - it is set in the options of the integration (Settings → Devices & services → House View → Configure → *Edit protection*): 4 characters or more, empty field to keep the current one, a checkbox to remove the protection. It is kept as a salted hash, never in clear text;
  - the card asks for it when ✎ or ⚙ opens (the pencil then carries a padlock), then again after 10 minutes without any change, after a page reload or a restart of Home Assistant. The 🔒 button at the top of the panel locks again at once;
  - the check is done by the integration: without a valid password every write is refused (HTTP code 423), even outside the card. After 5 wrong passwords you have to wait 1 minute;
  - forgotten password: change or remove it in the options of the integration;
  - looking at the view, zooming, driving the lights or the vacuum and the season / weather preview stay free.

## Terrain sources by country

France uses the services of the IGN. Everywhere else the relief comes from [Mapterhorn](https://mapterhorn.com), which lays the open national LiDAR surveys over a global 30 m model, and the buildings and roads come from [OpenStreetMap](https://www.openstreetmap.org). The resolution given is the one announced by Mapterhorn in November 2026; it improves with each version of the project (up-to-date coverage map on mapterhorn.com).

| | Country | Relief | Buildings, roads | Cadastre, aerial photo | Tested |
|---|---|---|---|---|---|
| 🇫🇷 | France | IGN LiDAR HD 0.5 m (RGE ALTI 1 m otherwise) | IGN BD TOPO | IGN (parcels, aerial photo or map) | ✅ |
| 🇦🇹 | Austria | Mapterhorn: 1 m | OpenStreetMap | — | ❌ |
| 🇧🇪 | Belgium | Mapterhorn: 0.5 m (Wallonia) | OpenStreetMap | — | ❌ |
| 🇩🇰 | Denmark | Mapterhorn: 0.4 m | OpenStreetMap | — | ❌ |
| 🇪🇪 | Estonia | Mapterhorn: 1 m | OpenStreetMap | — | ❌ |
| 🇩🇪 | Germany | Mapterhorn: 0.25 m (Baden-Württemberg), 1 m (most states) | OpenStreetMap | — | ❌ |
| 🇮🇹 | Italy | Mapterhorn: LiDAR in Sicily and part of Sardinia | OpenStreetMap | — | ❌ |
| 🇱🇺 | Luxembourg | Mapterhorn: 0.5 m | OpenStreetMap | — | ❌ |
| 🇳🇱 | Netherlands | Mapterhorn: national LiDAR | OpenStreetMap | — | ❌ |
| 🇳🇴 | Norway | Mapterhorn: 1 m | OpenStreetMap | — | ❌ |
| 🇵🇱 | Poland | Mapterhorn: national LiDAR | OpenStreetMap | — | ❌ |
| 🇵🇹 | Portugal | Mapterhorn: 0.5 m (partial coverage) | OpenStreetMap | — | ❌ |
| 🇷🇴 | Romania | Mapterhorn: 0.5 m (partial coverage) | OpenStreetMap | — | ❌ |
| 🇸🇰 | Slovakia | Mapterhorn: 1 m | OpenStreetMap | — | ❌ |
| 🇸🇮 | Slovenia | Mapterhorn: 0.5 m | OpenStreetMap | — | ❌ |
| 🇪🇸 | Spain | Mapterhorn: 0.5 m (partial coverage) | OpenStreetMap | — | ❌ |
| 🇸🇪 | Sweden | Mapterhorn: 1 m | OpenStreetMap | — | ❌ |
| 🇨🇭 | Switzerland | Mapterhorn: 0.25 m (canton of Zurich), 0.5 m (partial coverage) | OpenStreetMap | — | ❌ |
| 🇬🇧 | United Kingdom | Mapterhorn: 1 m (England, Scotland, Wales) | OpenStreetMap | — | ❌ |
| 🌍 | Rest of the world | Mapterhorn: 30 m (Copernicus GLO-30); failing that, Terrain Tiles (Mapzen / AWS) | OpenStreetMap | — | ❌ |

> **Not tested outside France.** The worldwide sources were written from their documentation and checked on simulated data, without a chance to try them for real. If the fetch fails or gives an inconsistent relief at your place, please [open an issue](https://github.com/elwinmage/ha-house-view-component/issues) with the country, the source chosen and the message shown under the form. Good news is welcome too: it lets the country be marked as tested.

With a 30 m model the terrain is only a tilted plane: the ground corrections of the editor (✎) let you redraw terraces and banks. Cadastre and aerial photos only exist country by country; they can be added on request, one issue per country.

## HTTP API (used by the card)

| Route | GET | POST | DELETE |
|---|---|---|---|
| `/api/house_view/info` | state + Home Assistant location | | |
| `/api/house_view/scene` | plan | replaces (admin) | |
| `/api/house_view/terrain` | height grid | replaces (admin) | removes (admin) |
| `/api/house_view/edits` | edits | replaces (admin) | removes (admin) |
| `/api/house_view/ortho` | ground photo / map | replaces (admin) | removes (admin) |
| `/api/house_view/fetch` | state of the fetch | starts fetching the terrain, `provider`: `auto` \| `ign` \| `world` (admin) | |
| `/api/house_view/github` | | `{"action": "backup" \| "restore"}` (admin) | |
| `/api/house_view/unlock` | `{locked, unlocked}` | `{"password"}` → token (admin) | locks again |

When an edit password is set, the writes (POST / DELETE above) also need the `X-House-View-Unlock` header with the token returned by `/unlock`; otherwise they answer 423.

Each document is validated (`validate.py`) and kept in `.storage/house_view.<key>`; each write fires the `house_view_updated` event (`key`, `updated`). The documents are large (a terrain is several MB): they travel over HTTP (Home Assistant limit of 16 MB per request), not over the websocket.

## Development and tests

```bash
pip install pre-commit
# (optional) cd card && npm install to run the build and the tests by hand
pre-commit install            # ruff, prettier, vitest, translations, pytest (100 % coverage); pre-commit manages the dependencies of the hooks
pre-commit run --all-files
```

- **Integration**: `pytest` (real Home Assistant HTTP server through `pytest-homeassistant-custom-component`, 100 % coverage required).
- **Card**: `cd card && npm test` (vitest); `npm run build` writes `custom_components/house_view/frontend/house-view-card.js`; `npm run format` (prettier).
- **Translations**: `scripts/check_translations.py` checks that every language of the integration (en, fr, it, de, es, pl, pt) and of the card (`card/src/i18n.js`) has exactly the keys of English. This README exists in the same seven languages (`doc/<language>/README.<language>.md`).
- **Test page without Home Assistant**: `python3 card/test/harness/server.py` (fake API server), then http://localhost:8765/card/test/harness/index.html
- **Brand images**: `custom_components/house_view/brand/` (icon and logo, light and dark), served by Home Assistant 2026.3+ without going through the `home-assistant/brands` repository. Vector sources in `assets/brand/`; `scripts/build_brand.sh` rebuilds the PNG files (`rsvg-convert`, ImageMagick, Inter font).
- **CI** (`.github/workflows/`): `validate.yml` (hassfest + HACS), `tests.yml` (pre-commit, pytest, vitest + build), `release.yml` (started by hand with the version: updates `manifest.json` and `card/package.json`, builds the card, tags, publishes the release with `house_view.zip`).
- **Catalog client**: `catalog_pack.py` and `catalog_runtime.py` are copies of `reeftech-catalog/client/` (the client only knows its own sections: `catalog.py` declares the ones of the house to it); `house_catalog_sections.py` and `catalog_builtin*/` are copies of the description and of the entries of `house-catalog`. All are written by the `scripts/sync_client.py` of those repositories: change them there, never here.

`card/src/engine.js` is the 3D engine (one instance per card, no dependency on Home Assistant); `card/src/ha-bridge.js` turns the state of Home Assistant into data for the engine; `card/src/engine/` holds the modules of the prototype (geometry, vegetation, terrain, lights…).

## Roadmap

1. ✅ Phase 1: integration + card, plan import, terrain, registration, live lights and weather.
2. ✅ Editors in the card: outdoor objects, trees, ground corrections, custom views.
3. ✅ Terrain fetched by the integration for France (IGN), roads, ground photo, fences, placed entities, robot vacuum, room zoom, season / weather preview, GitHub backup.
4. ✅ Other countries: Mapterhorn relief, OpenStreetMap buildings and roads (to be confirmed country by country). Next: cadastre and aerial photo of the countries that publish them as open data.
5. ✅ Catalog (four-season trees, objects) read from `house-catalog` and edited with `catalog_editor`. Next: more species and objects, sprinkler models.

## License

Code under the [MIT](LICENSE) license © Elwinmage. The icon and the logo (`assets/brand/`) are original creations of the project, under the same license.

- **Libraries bundled in the built card**: [three.js](https://threejs.org) (MIT), [Lit](https://lit.dev) (BSD-3-Clause) and [fflate](https://github.com/101arrowz/fflate) (MIT); their license notices are kept at the end of the built file.
- **Data**: the repository holds no map data; each user downloads the data of their own property, and the source is recalled in ⚙ → *Terrain (DTM)*. When publishing a screenshot, credit that source:
  - France: services of the IGN (cartes.gouv.fr), under the [Licence Ouverte Etalab 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/);
  - relief outside France: [Mapterhorn](https://mapterhorn.com/attribution) and the open datasets it assembles, or the [Terrain Tiles](https://registry.opendata.aws/terrain-tiles) of Mapzen;
  - buildings and roads outside France: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, under the ODbL license.
- Brand names (Hunter, Roborock, Sweet Home 3D…) belong to their owners and are only mentioned to describe compatibility.
