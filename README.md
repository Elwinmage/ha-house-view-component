<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="custom_components/house_view/brand/dark_logo.png">
    <img src="custom_components/house_view/brand/logo.png" alt="House View" width="420">
  </picture>
</p>

# House View

[![GH-release](https://img.shields.io/github/v/release/Elwinmage/ha-house-view-component.svg?style=flat-square)](https://github.com/Elwinmage/ha-house-view-component/releases)
[![GH-last-commit](https://img.shields.io/github/last-commit/Elwinmage/ha-house-view-component.svg?style=flat-square)](https://github.com/Elwinmage/ha-house-view-component/commits/main)
[![HACS](https://img.shields.io/badge/HACS-Custom-41BDF5.svg?style=flat-square)](https://hacs.xyz)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![codecov](https://codecov.io/gh/Elwinmage/ha-house-view-component/branch/main/graph/badge.svg?flag=integration)](https://codecov.io/gh/Elwinmage/ha-house-view-component)
[![Active Installs](https://img.shields.io/badge/dynamic/json?label=Active%20Installs&query=estimated&cacheSeconds=3600&url=https%3A%2F%2Fraw.githubusercontent.com%2FElwinmage%2Fha-house-view-component%2Fmain%2Fbadges%2Fstats.json&color=CE1126&logo=home-assistant)](https://analytics.home-assistant.io/custom_integrations)

**Supported languages:**
[<img src="https://flagicons.lipis.dev/flags/4x3/fr.svg" style="width: 5%;"/>](doc/fr/README.fr.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/gb.svg" style="width: 5%;"/>](README.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/es.svg" style="width: 5%;"/>](doc/es/README.es.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/de.svg" style="width: 5%;"/>](doc/de/README.de.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/pl.svg" style="width: 5%;"/>](doc/pl/README.pl.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/pt.svg" style="width: 5%;"/>](doc/pt/README.pt.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/it.svg" style="width: 5%;"/>](doc/it/README.it.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/nl.svg" style="width: 5%;"/>](doc/nl/README.nl.md)

📘 **Full user guide** (installation, configuration, usage, with pictures): [GUIDE.en.md](doc/en/GUIDE.en.md)

A live pseudo-3D view of your house for Home Assistant: your plan (**Sweet Home 3D**, IFC or SVG) on a digital terrain model, with lights, weather, sun and seasons in real time, plus a robot vacuum, garden watering and fences. One repository holds:

- `custom_components/house_view/`: the **integration** (stores the plan, the terrain and your edits; fetches the terrain; HTTP API);
- `card/`: the **Lovelace card** `house-view-card` (three.js), built into `custom_components/house_view/frontend/`. The integration serves it itself (`/house_view/house-view-card.js`) and loads it on every dashboard: **no Lovelace resource to declare**.

The card interface and the options of the integration exist in English, French, Italian, German, Spanish, Polish, Portuguese and Dutch (the card follows the language of your Home Assistant profile). Translations are welcome: the texts are in `custom_components/house_view/translations/` and `card/src/i18n.js`.

## Overview

<p align="center"><img src="doc/images/four-seasons.webp" alt="The demo house on its terrain through the four seasons: sensors, watering, pool, trees" width="440"> <img src="doc/images/sea.webp" alt="The same house by the sea: moving waves, tide, beach, surf sound" width="440"></p>
<p align="center"><a href="https://youtu.be/MyXz5AVbtJI">▶ Watch the video</a></p>

House View turns the plan of your home into a living picture of it. Most 3D cards for Home Assistant load a heavy model of the building (a GLB / OBJ export) and attach entities to its objects, or stack transparent layers on a picture. House View takes another road: a **light procedural scene** drawn live from your plan, which also shows the garden and the sky, not only the walls. Nothing like it, as far as we know, combines the following:

- **Light by construction**: no heavy 3D export to load or merge: walls, furniture, trees, water and light volumes are generated from the plan and a small catalog, and rendering stops when the card is not visible, with an `fps_cap` for wall tablets.
- **Your own house, on its real terrain**: the Sweet Home 3D (or IFC, SVG) plan is laid on a digital terrain model of the plot (IGN LiDAR HD and cadastre in France — fences can be drawn from the parcels —, open LiDAR and OpenStreetMap elsewhere), with the relief, roads, neighbouring trees and your fences.
- **Real sun, seasons and weather**: the light follows the sun of your latitude, the trees and the grass change with the seasons, and rain, snow, fog, thunderstorms and wind (rain leans the way the wind blows) follow your weather entity or your own sensors. A simulation mode plays any day or a whole year in seconds.
- **Every room alive**: the real state, colour and brightness of your lights, room temperatures, a tap to zoom on a room then toggle its lights; lights placed anywhere become real light sources.
- **Your entities, where they are**: sensors, switches and selects placed on the plan, a general panel, a central alarm badge (smoke, water leak, intrusion…), clickable zones (a media player on a piece of furniture, a reeftank aquarium shown live on its tank, a link to a dashboard or a card).
- **Doors, windows, shutters and gates that move**: linked to your contacts and covers, they open and close on the view; a gate (swinging or sliding, 1 or 2 leaves, bars or solid, straight or arched) follows its cover or contact.
- **Robot vacuum**: cleaning by rooms in a tap, a 3D robot moving on the plan, rooms tinted with their progress, several robots, Roborock position support.
- **A garden that works**: drip lines and sprinklers animated by their valves (wet spots, jets), fences of every kind (mesh, wood, wall, wrought iron, reed, gabions and nine hedges: cherry laurel, thuja, Leyland…), flower beds with the number and the colours you choose, pools and ponds with their fish.
- **A living sea**: for a house by the coast, a moving sea with waves driven by the wind, a tide that follows the calendar (set on a real high water of your harbour), sand, pebble, coral or rock beaches and the sound of the surf (*Sea* section of the editor).
- **A catalog that grows**: trees with up to four renderings a year and colour varieties (apple trees with red, yellow or green fruit, cherry, willow, eucalyptus…) and objects come from the open [house catalog](https://github.com/Elwinmage/house-catalog), updated in the background, usable offline, extensible with the [catalog editor](https://github.com/Elwinmage/catalog-editor).
- **Show it without showing your home**: a *Load the demo* button adds a fictitious house at an arbitrary place, to film, present or try the card (hidden by default: switch it on in the integration options).
- **Nothing to install but the integration**: the card is served by the integration (no Lovelace resource), everything is edited from the card itself (✎), several homes can coexist, your corrections are kept apart from the plan so that re-importing it loses nothing, and the interface speaks eight languages (English, French, Spanish, German, Italian, Polish, Portuguese, Dutch).

## Installation

1. Install with HACS (custom repository, type *Integration*), or copy `custom_components/house_view/` into `config/custom_components/`, then restart Home Assistant.
2. Add the *House View* integration: give the home a name and its location (the location of Home Assistant by default). Each home is an entry of its own: add the integration again for a second home (a holiday house…), with its own plan, terrain and edits; the card shows one home, chosen with its `home` option.
3. Add the card to a dashboard (`type: custom:house-view-card`).
4. Open ⚙ in the card (administrators only) to import your plan (Sweet Home 3D, IFC or SVG) or draw a simple one, then fetch the terrain (cartes.gouv.fr in France, worldwide open data elsewhere: see [Terrain sources by country](#terrain-sources-by-country)) or load a terrain `.json`.

The version of the card is printed in the browser console when it loads (`🏠 HOUSE VIEW v0.x.y`). Cleaning by rooms and the icon of the integration need Home Assistant 2026.3 or later.

The built card is not committed: `release.yml` builds it at each release and publishes `house_view.zip`, which HACS installs. For development: `cd card && npm install && npm run build`.

## Card configuration

The options are set in the visual editor of the card (edit the dashboard, then *Edit* on the card), in four sections: time and weather, display, lights, robot vacuum. The plan, the terrain and everything placed in the view are set in the card itself (✎ and ⚙). In YAML:

```yaml
type: custom:house-view-card
home: 01JXYZ…                         # optional, several homes: the entry shown (chosen in the visual editor); the first one by default
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
show_alarms: true                     # central alarm badge (top right)
vacuum_entity: vacuum.robot           # optional: the first vacuum.* found by default
vacuum_poll: 15                       # seconds between two position readings (Roborock: cloud action, min 5)
vacuum_show_floor: false              # true = while cleaning, show the floor of the robot from above
vacuum_rate: 1                        # m²/min, for the estimated path of a robot without position
vacuum_progress_entity: sensor.xxx    # optional: progress (%); found automatically for Roborock
movable_camera: true                  # movable camera (orbit, zoom, pan); false = fixed on the views
height: fill                          # fill (screen height below the top of the card) | aspect (16/10) | 600 | "70vh"
min_height: 320                       # minimum height in fill mode (px)
fps_cap: 30                           # frames per second limit (wall screens, tablets)
year_seconds: 10                      # 📅 button: plays the seasons of a whole year in this many seconds (5 to 60)
toolbar_buttons: [preview]            # tools kept in the toolbar (preview, year, camera, sim, edit, setup); the others are in the ⋮ menu
hide_menu: false                      # true: no ⋮ menu for the users who are not administrators (wall screen)
light_entities: [light.living, ...]   # optional: restricts the lights taken into account
```

## Live view

- **Toolbar** (top right): the alarm badge, the robot vacuums and the ⋮ menu, which holds the occasional tools (season / weather / time preview, simulate a year, camera lock, simulation, demo) and, for administrators, the editor ✎ and the setup ⚙. The option `toolbar_buttons` keeps some of them in the toolbar; `hide_menu` hides the menu from the users who are not administrators.
- **Latitude, longitude, time zone**: those of the home (set when it is added; the Home Assistant configuration by default). The seasons of the vegetation and of the grass follow the climate of the latitude: four seasons in temperate lands; from 50° toward the poles, a winter that grows longer and a short summer (still winter at the end of April at 68°); between the tropics, no winter but a wet and a dry season (the trees keep their leaves, the grass yellows a little in the dry season, less near the equator), which the season preview offers instead of the four seasons. Everything is reversed in the southern hemisphere.
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
- **Lining up with the map of the robot**: *Show the map of the robot over the plan* lays the picture the robot draws of the floor (an `image.*` or `camera.*` entity of its device) over the floor of the dock, half transparent, the floors above being hidden. The dock is the fixed point: turn the picture with the rotation slider until its walls follow those of the plan; the rotation found is the one applied to the robot. When the entity gives `calibration_points` (map extractors, *Roborock Custom Map*), the picture places itself. Otherwise (image entities of the official Roborock integration), tap where the picture draws the dock (*The dock is here on the map*), move it by steps of 5 cm, and set the size of a pixel if the rooms are too large or too small (12.5 mm by default for Roborock, 50 mm otherwise).
- **Percentage of a room**: share of the floor covered by the robot (estimate: 80 % of the floor is assumed reachable); the overall progress comes from the sensor of the robot when there is one (Roborock: `cleaning_progress`).
- *Test the animation* plays an accelerated cleaning (with or without an error) without starting the robot.
- **Several robots**: each `vacuum.*` has its own button in the toolbar, its own room selection and its own 3D robot, path and room colours. In ✎ → *Robot vacuum*, the *Robot* list chooses the one being set up (dock, position, calibration, map are kept per robot); *Show this robot* hides one from the view and the toolbar (a robot of another home, for example).

## Catalog: trees and objects

The trees and the pieces of furniture are not built into the card: they come from the [house catalog](https://github.com/Elwinmage/house-catalog), where adding a species or an object is a pull request, not a new version of this integration.

- **Trees**: each species has up to four renderings, one per season: colour and density of the foliage, blossom, fruits, leaves on the ground. The view blends from one season to the next, day after day (oak, pine, yew, cherry tree and apricot tree to start with, then Japanese cherry, elder, apple, pear, eucalyptus and weeping willow, then date, Canary Island date and coconut palms, silver fir and Norway spruce). A species can have colour **varieties** (red, yellow or green apples), offered as `Apple tree - Gala (red)` in the planting list. They are the species offered when you plant a tree in the editor, within the heights the catalog gives.
- **Objects**: a piece of furniture of the plan whose name holds a keyword of a catalog object (`Chaise`, `Chair`, `Stuhl`…) is drawn with it, at the place and size of the piece, instead of a plain box; when the plan gives the piece a colour, the object takes it on its tinted parts. Likewise a plant of the plan named after a tree of the catalog (`Cerisier`, `Yew`) is drawn as that tree.
- **Fish**: the fish of the ponds (koi carp to start with), each with its colour varieties; the card draws them itself, seen from above.
- **Updates**: the integration downloads the catalog from GitHub in the background (the card never calls the network) and works offline with the copy it ships. The device *House view catalog* has an update entity per section (trees, objects), an *Automatic update* switch (on by default) and an *Update now* button.
- **Your own entries**: with the [catalog editor](https://github.com/Elwinmage/catalog-editor), a tree or an object you save is used by the view at once, before (or without) proposing it to the catalog.

## Editor (✎)

For administrators. The editor is a menu of sections: a section opens in its own window over the menu, and an item of a list (a watering line, a zone, an entity of the general panel, a door…) opens its editing window over the section; the arrow ← of a window goes back to the one underneath. Everything is saved in the edits file, apart from the plan and the terrain; Escape cancels the drawing in progress.

- **Placed entities** (sensors, lights, switches, selects…): placed with a tap, then moved by dragging their label (editor open). Fixed to the floor (default: the label stays in its room whatever the angle), to a wall (room side, hidden when the wall is seen from behind) or free in height; a label hidden by an upper floor or the roof is not shown, except a label *shown over the roof*; while *Placed entities* is open in the editor, every label shows (dimmed when the house hides it), so an entity can be placed and dragged anywhere, rooms included. Badge (icon + value) or icon only; colour, label, icon (Home Assistant icon picker with preview); shown in the general view (always, or on the view of its floor; *Shown over the roof* lets the temperature of a room be read from afar); tap = more-info, toggle or nothing. In the editor the list is folded: only the chosen entity is unfolded. Entities are chosen from those of the current room, grouped by device (the whole house one tick away, with a search); icons are shown while one types their name.
- **General panel** (left, under the level buttons): sensors and actuators of the whole house (outdoor temperature, alarm panel…), in the order chosen, with their label and icon; a tap toggles what can be toggled and opens the dialog of the others (or as chosen: toggle, dialog, nothing).
- **Alarms**: a badge at the top right, green with a tick when all is well, red with a bell and the count in brackets when alarms are raised; a tap opens their list (tap one = its dialog). Found automatically: problem, smoke, gas, carbon monoxide, water leak, heat, cold and tamper sensors and triggered alarm panels (reeftank alarms included); entities can be added by hand, and an alarm can be left out from the list itself (bell crossed out) or from the editor. Each room with raised alarms (room linked to a Home Assistant area) also shows a red bell with their count; a tap opens the list of that room (*All* goes back to the whole house); these room badges can be switched off in the editor. Option `show_alarms`.
- **Clickable zones**: a media player on a piece of furniture of the plan (tap it in the editor) or on a rectangle laid on a wall or a floor; an aquarium of reeftank on a rectangle at the size of the tank (its front on a wall, its top on a floor). A tap opens the player, or the view of the aquarium of ha-reef-card in a window; the rectangle of an aquarium shows that view live, fish moving (option per zone), in the view of the aquarium chosen for the zone (its default view otherwise). While placing, the wall or floor under the pointer is lit and the rectangle drawn on it; a zone is moved by dragging it on its surface. Width, height, height of the centre (wall) or rotation (floor) can be adjusted. A **link** (*Add a link*) opens, in the same kind of window, a dashboard of Home Assistant (a path such as `/lovelace/cameras`, or a full address, shown in a frame) or any Lovelace card (its configuration as JSON, e.g. `{"type": "picture-entity", "entity": "camera.garden"}`); on a rectangle it shows as a tile with its icon and name (icon and tile optional).
- **Placed lights**: a placed `light.*` becomes a light source at that spot of the room (spot, pendant, lamp, strip or invisible; height and reach adjustable; on a wall: a wall lamp at the height tapped), driven by its own state and colour. The other lights of the area keep lighting the whole room.
- **Entities of a room**: zoomed on a room, only the entities of that room show; those of the general view disappear (the robot vacuum still moves if it is there). In the editor, a tap on a room zooms on it and the editing becomes that of the room (red banner at the top): the entities added then are placed on its floor, on a wall or in the air, and belong to that room only. They disappear when another room is chosen or back to the general view. An entity of the general view standing in a room moves into that room with its *Its room only* setting.
- **Doors and windows** (*Doors and windows*): the openings of the plan (Sweet Home 3D, IFC), listed by level and room, or picked with a tap on the view (the opening under the pointer is lit). Each can be linked to an open / closed sensor (`binary_sensor`), a motorised opener (`cover` of the window) and, for windows and patio doors, a roller shutter (`cover`). A room with a single window is linked on its own to the window sensor, the opener and the shutter of its area when there is one of each; a room with a single door to its door sensor; a link set by hand wins, and an automatic link can be removed. In the view the casements (one, two past 1.10 m) open inward, a patio door slides, a door leaf turns (an inner door gets its leaf once linked), and the roller shutter comes down on the outer face to the position of the `cover` (`current_position`, smoothly).
- **Pools and ponds** (*Pools and ponds*): drawn from above, as a rectangle (two opposite corners) or a free shape (point by point, *Finish*), with a name, a water colour and a depth (0.2 to 6 m). The ground is dug: a pool has vertical walls, a flat bottom and a coping, a pond a sloping bottom and a pebble bank; the ground around is levelled and the water moves. A cleaning robot can be linked to an entity (`binary_sensor`, `switch`, `input_boolean` or `vacuum`): it travels the bottom while it is on, and stays parked otherwise. A pool or a pond counts as a **room**: a tap zooms the camera on it (view savable like a room's), entities and links can be placed in it (layer of the room), and it can be linked to a Home Assistant area (by name or in the area mapping). The pool of the imported plan stays as it is. A pond can hold **islands** (drawn like the outline: the ground stays a little above the water, with a pebble bank; trees and entities go on them) and **fish** of the house catalog: groups of a fish (koi carp to start with), a variety (kohaku red and white, benigoi red, yamabuki ogon yellow, showa…) or colours of one's own (body, patches, pattern, shiny scales), a count and a size: 3 red, 1 red and white, 2 yellow is three groups. Each fish has a robe of its own, wanders in the water around the islands, takes the colour of the water the deeper it is, and goes down to the bottom when the water is cold.
- **Room view**: zoomed on a room, with the editor open, *📷 Room view* saves the camera and the visible levels; a tap on that room then opens this view instead of the automatic zoom. *Automatic view* goes back to it.
- **Fences** (*Fences*): each side has its type (mesh, wood, wall, wrought iron, rigid panels, reed screen, composite slats, gabions, nine hedges by species — cherry laurel, thuja, Leyland cypress, hornbeam, photinia, privet, bamboo, box, mixed country hedge — or open where there is no fence) and its height. Two ways to create one: *Fence from the cadastre* (the parcels of the house are preselected, tap to add or remove the neighbouring parcels of the same property; the outline of the whole is fenced) or *Draw a fence* (successive taps, the "Dessus" top view is recommended; each side takes the type chosen in the palette, one colour per type). *Edit the sides*: change the type of a side with a tap, cut a side in two (one part as a wall, the other as mesh), remove a point.
- **Gates** (*Gates*): *Add a gate*, then tap a fence where it goes: the fence opens up under it by itself. Any number of gates, on any fence; *Move* then a tap on another spot slides one, *Delete* removes it (the fence closes again). Settings: opening (swing with 1 or 2 leaves, sliding with 1 or 2 leaves), fill (bars, solid, mixed), top (straight or arched), width, height, colour, pillars, **the side of the fence it opens toward** and, for one leaf, the end where it is hinged or slides. A `cover` (position) or a `binary_sensor` (on = open) moves it, in 6 s; *Try the animation* shows it open without any entity.
- **Flower beds** (*Flower beds*): draw an area point by point, then choose the **number of flowers** and a **list of colours with weights** (3 red for 1 white gives three red flowers for each white one). The flowers are planted at random but always the same way (*Plant again* draws another); the bloom follows the season: none in winter, three quarters in spring, all in summer, a third in autumn.
- **Watering** (*Watering*):
  - **Drip lines**: one line per valve (`switch`, `valve`, `input_boolean`), drawn point by point and rounded when rendered; black, brown, green or hidden pipe. When the valve is open the line turns blue, glints run along it, a drop swells and shrinks in a loop under each emitter (30 cm apart by default, slightly out of step from one emitter to the next: the line twinkles) and a wet spot grows until it forms a strip. The width of the spot follows the Schwartzman & Zur (1986) model, from the emitter flow, the opening time and the soil type; it fades within 30 minutes after closing.
  - **Sprinklers**: one circuit per valve, with one or several sprinklers (catalogue model: Hunter Pro-Spray PSU-04 8A to 17A, SRM-04, PGJ-04, PGP Ultra, MP Rotator, or generic; minimum / maximum distance, direction and angle prefilled and editable; *Aim* with a tap). When the valve is open the estimated watered sector is shown and the jet is animated (sweeping for a rotor, fan for a spray nozzle).
  - *Test the animation* plays 30 seconds of accelerated watering (30 s = 1 h 30) on every line and circuit, without opening any valve: the wet spot grows, the jets turn, then everything goes back to the real state. The *Test* button of a line or a circuit does the same for it alone; closing the editor stops the test.
- **Other tools**: outdoor objects (hide, height, offset, rotation), pool level, trees (remove, add with species and height, undo, restore all), ground corrections (low wall, terrace, brushes, cut, editable list of corrections), views.

## Setup (⚙)

- **Demo** (to film or present the view without showing your house or where it is; hidden by default, see *Show the demo* below): *Load the demo* adds a home "Démo" with a fictitious two-storey house (the Sweet Home 3D file `custom_components/house_view/demo/demo-maison.sh3d` can be opened and reworked), a terrain of three plateaus with an orchard, a pool, a pond, a fence, watering, a robot vacuum and shutters, at a fictitious place (45° N). Your homes are left alone. Its entities are simulated by the card (nothing is created in Home Assistant, and nothing of your home is shown): a scenario of the day, at 1 h every 2 s, opens and closes the shutters, switches the lights, waters at dawn, runs the vacuum in the morning and the pool robot in the afternoon, raises a water leak before dinner… The 🎬 button of the toolbar pauses it, sets the hour and triggers an event by hand (shutters, lights, vacuum, watering, robots, leak, smoke); a tap on a simulated entity switches it. *Reset the demo* puts it back as shipped, *Leave the demo* comes back to your home; the demo home can be removed like any other entry. Your real aquariums (reeftank) can still be placed in it. The files are generated by `npm run demo` in `card/`. The demo home starts empty and flat, to be filmed from the start: import `demo-maison.sh3d` (*Download demo-maison.sh3d* in ⚙) with *Import a .sh3d*, then *Fetch the terrain*: the fetch goes through its steps and brings the terrain of the demo, without any network access.
- **Plan**: *Import a plan* reads, in the browser, a Sweet Home 3D file (`.sh3d`), an IFC file (`.ifc`, BIM: ArchiCAD, Revit, FreeCAD, BlenderBIM: storeys, spaces, walls, doors and windows) or an SVG plan (`.svg`, as drawn for ha-floorplan or with Inkscape: each named shape is a room, an Inkscape layer a level; *Scale: SVG units per meter* corrects the size), and lists what was found. Without a plan file: *Create a simple plan* opens a builder of rectangular rooms, level by level (drag a room to move it, its handles to resize it, the edges stick to the neighbouring rooms; name and Home Assistant area, doors, windows and patio doors clicked on a wall with their width, height and sill; ceiling height per level, a new level copies the outline of the one below; roof automatic, gable or flat), the 3D view updating behind. *Plan from the robot's map* starts one from the rooms of a robot vacuum's map (map extractors listing `rooms`). An SVG of rectangles and the robot's rooms open in the simple plan, to add doors and windows. Each room gets a ceiling light lit by the lights of its area. The furniture of a Sweet Home 3D plan is drawn with its own 3D models (OBJ models of the file, kept light: a few thousand triangles at most, one colour per material, the mean colour of a texture), at its size, turned and mirrored like in the plan; *Furniture drawn with the 3D models of the plan* goes back to plain shapes.
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
- **Show the demo**: it is hidden by default. Integration options → *Demo* → uncheck *Hide the demo* to get the *Load the demo* section in the setup of the card (a demo home already loaded keeps its own buttons either way).

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
| `/api/house_view/homes` | homes set up: `[{id, title}]` | | |
| `/api/house_view/demo` | plan of the demo house (admin) | creates the demo home or puts it back as shipped → `{home}` (admin) | |
| `/api/house_view/info` | state, name and location of the home | | |
| `/api/house_view/scene` | plan | replaces (admin) | |
| `/api/house_view/terrain` | height grid | replaces (admin) | removes (admin) |
| `/api/house_view/edits` | edits | replaces (admin) | removes (admin) |
| `/api/house_view/ortho` | ground photo / map | replaces (admin) | removes (admin) |
| `/api/house_view/fetch` | state of the fetch | starts fetching the terrain, `provider`: `auto` \| `ign` \| `world` (admin) | |
| `/api/house_view/github` | | `{"action": "backup" \| "restore"}` (admin) | |
| `/api/house_view/unlock` | `{locked, unlocked}` | `{"password"}` → token (admin) | locks again |

With several homes, every route takes `?home=<entry id>` (the first home without it).

When an edit password is set, the writes (POST / DELETE above) also need the `X-House-View-Unlock` header with the token returned by `/unlock`; otherwise they answer 423.

Each document is validated (`validate.py`) and kept in `.storage/house_view.<key>` (home set up before version 0.2) or `.storage/house_view.<home id>.<key>`; each write fires the `house_view_updated` event (`key`, `updated`, `home`). Removing a home removes its documents. The documents are large (a terrain is several MB): they travel over HTTP (Home Assistant limit of 16 MB per request), not over the websocket.

## Development and tests

```bash
pip install pre-commit
# (optional) cd card && npm install to run the build and the tests by hand
pre-commit install            # ruff, prettier, vitest, translations, pytest (100 % coverage); pre-commit manages the dependencies of the hooks
pre-commit run --all-files
```

- **Integration**: `pytest` (real Home Assistant HTTP server through `pytest-homeassistant-custom-component`, 100 % coverage required).
- **Card**: `cd card && npm test` (vitest); `npm run build` writes `custom_components/house_view/frontend/house-view-card.js`; `npm run format` (prettier).
- **Translations**: `scripts/check_translations.py` checks that every language of the integration (en, fr, it, de, es, pl, pt, nl) and of the card (`card/src/i18n.js`) has exactly the keys of English. This README exists in the same eight languages (`doc/<language>/README.<language>.md`).
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
6. ✅ Several homes, several robot vacuums, entities of a room when zoomed, doors / windows / roller shutters linked to Home Assistant, pools and ponds dug in the ground, editor in windows.

## License

Code under the [MIT](LICENSE) license © Elwinmage. The icon and the logo (`assets/brand/`) are original creations of the project, under the same license.

- **Libraries bundled in the built card**: [three.js](https://threejs.org) (MIT), [Lit](https://lit.dev) (BSD-3-Clause) and [fflate](https://github.com/101arrowz/fflate) (MIT); their license notices are kept at the end of the built file.
- **Data**: the repository holds no map data; each user downloads the data of their own property, and the source is recalled in ⚙ → *Terrain (DTM)*. When publishing a screenshot, credit that source:
  - France: services of the IGN (cartes.gouv.fr), under the [Licence Ouverte Etalab 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/);
  - relief outside France: [Mapterhorn](https://mapterhorn.com/attribution) and the open datasets it assembles, or the [Terrain Tiles](https://registry.opendata.aws/terrain-tiles) of Mapzen;
  - buildings and roads outside France: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, under the ODbL license.
- Brand names (Hunter, Roborock, Sweet Home 3D…) belong to their owners and are only mentioned to describe compatibility.
