<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../custom_components/house_view/brand/dark_logo.png">
    <img src="../../custom_components/house_view/brand/logo.png" alt="House View" width="420">
  </picture>
</p>

# House View

[![GH-release](https://img.shields.io/github/v/release/Elwinmage/ha-house-view-component.svg?style=flat-square)](https://github.com/Elwinmage/ha-house-view-component/releases)
[![GH-last-commit](https://img.shields.io/github/last-commit/Elwinmage/ha-house-view-component.svg?style=flat-square)](https://github.com/Elwinmage/ha-house-view-component/commits/main)
[![HACS](https://img.shields.io/badge/HACS-Custom-41BDF5.svg?style=flat-square)](https://hacs.xyz)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![codecov](https://codecov.io/gh/Elwinmage/ha-house-view-component/branch/main/graph/badge.svg?flag=integration)](https://codecov.io/gh/Elwinmage/ha-house-view-component)
[![Active Installs](https://img.shields.io/badge/dynamic/json?label=Active%20Installs&query=estimated&cacheSeconds=3600&url=https%3A%2F%2Fraw.githubusercontent.com%2FElwinmage%2Fha-house-view-component%2Fmain%2Fbadges%2Fstats.json&color=CE1126&logo=home-assistant)](https://analytics.home-assistant.io/custom_integrations)

**Beschikbare talen:**
[<img src="https://flagicons.lipis.dev/flags/4x3/fr.svg" style="width: 5%;"/>](../fr/README.fr.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/gb.svg" style="width: 5%;"/>](../../README.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/es.svg" style="width: 5%;"/>](../es/README.es.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/de.svg" style="width: 5%;"/>](../de/README.de.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/pl.svg" style="width: 5%;"/>](../pl/README.pl.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/pt.svg" style="width: 5%;"/>](../pt/README.pt.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/it.svg" style="width: 5%;"/>](../it/README.it.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/nl.svg" style="width: 5%;"/>](README.nl.md)

📘 **Volledige handleiding** (installatie, configuratie, gebruik, met afbeeldingen; in het Engels): [GUIDE.en.md](../en/GUIDE.en.md)

Een pseudo-3D-weergave van je huis in realtime voor Home Assistant: je plattegrond (**Sweet Home 3D**, IFC of SVG) op een digitaal terreinmodel, met verlichting, weer, zon en seizoenen in realtime, plus een robotstofzuiger, tuinbesproeiing en hekken. Eén repository bevat:

- `custom_components/house_view/`: de **integratie** (bewaart de plattegrond, het terrein en je bewerkingen; haalt het terrein op; HTTP-API);
- `card/`: de **Lovelace-kaart** `house-view-card` (three.js), gebouwd in `custom_components/house_view/frontend/`. De integratie serveert hem zelf (`/house_view/house-view-card.js`) en laadt hem op elk dashboard: **geen Lovelace-resource om te declareren**.

De interface van de kaart en de opties van de integratie bestaan in het Engels, Frans, Italiaans, Duits, Spaans, Pools, Portugees en Nederlands (de kaart volgt de taal van je Home Assistant-profiel). De namen van knoppen en secties worden hier in het Engels vermeld. Vertalingen zijn welkom: de teksten staan in `custom_components/house_view/translations/` en `card/src/i18n.js`.

## Overzicht

<p align="center"><img src="../images/four-seasons.webp" alt="Het demohuis op zijn terrein door de vier seizoenen heen: sensoren, besproeiing, zwembad, bomen" width="440"> <img src="../images/sea.webp" alt="Hetzelfde huis aan zee: bewegende golven, getij, strand, geluid van de branding" width="440"></p>
<p align="center"><a href="https://youtu.be/MyXz5AVbtJI">▶ Bekijk de video</a></p>

House View maakt van de plattegrond van je huis een levend beeld ervan. De meeste 3D-kaarten voor Home Assistant laden een zwaar model van het gebouw (een GLB-/OBJ-export) en koppelen entiteiten aan de objecten ervan, of stapelen transparante lagen op een afbeelding. House View kiest een andere weg: een **lichte procedurele scène**, live getekend uit je plattegrond, die ook de tuin en de lucht toont, niet alleen de muren. Voor zover wij weten combineert niets vergelijkbaars het volgende:

- **Licht door opzet** : geen zware 3D-export om te laden of samen te voegen: muren, meubels, bomen, water en lichtvolumes worden gegenereerd uit de plattegrond en een kleine catalogus, en het renderen stopt zodra de kaart niet zichtbaar is, met een `fps_cap` voor wandtablets.
- **Je eigen huis op zijn echte terrein** : de plattegrond van Sweet Home 3D (of IFC, SVG) wordt op een digitaal terreinmodel van het perceel gelegd (IGN LiDAR HD en kadaster in Frankrijk — hekken kunnen uit de percelen worden getekend —, elders open LiDAR en OpenStreetMap), met het reliëf, de wegen, de bomen van de buren en je hekken.
- **Echte zon, seizoenen en weer** : het licht volgt de zon op jouw breedtegraad, bomen en gras veranderen met de seizoenen, en regen, sneeuw, mist, onweer en wind (regen valt schuin in de richting van de wind) volgen je weerentiteit of je eigen sensoren. Een simulatiemodus speelt elke dag of een heel jaar in seconden af.
- **Elke kamer leeft** : de echte status, kleur en helderheid van je lichten, kamertemperaturen, een tik om op een kamer in te zoomen en dan zijn lichten te schakelen; overal geplaatste lichten worden echte lichtbronnen.
- **Je entiteiten, waar ze staan** : op de plattegrond geplaatste sensoren, schakelaars en keuzelijsten, een algemeen paneel, een centrale alarmbadge (rook, waterlek, inbraak…), klikbare zones (een mediaspeler op een meubelstuk, een reeftank-aquarium live getoond op zijn bak, een link naar een dashboard of een kaart).
- **Deuren, ramen, rolluiken en poorten die bewegen** : gekoppeld aan je contacten en afdekkingen openen en sluiten ze in de weergave; een poort (draaiend of schuivend, 1 of 2 vleugels, spijlen of dicht, recht of gebogen) volgt zijn afdekking of contact.
- **Robotstofzuiger** : schoonmaken per kamer met een tik, een 3D-robot die over de plattegrond rijdt, kamers die met hun voortgang worden ingekleurd, meerdere robots, ondersteuning voor de positie van Roborock.
- **Een tuin die werkt** : druppelleidingen en sproeiers geanimeerd door hun kleppen (natte plekken, stralen), hekken van allerlei soort (gaas, hout, muur, smeedijzer, riet, gabions en negen hagen: laurier, thuja, Leylandcipres…), bloembedden met het aantal en de kleuren die je kiest, zwembaden en vijvers met hun vissen.
- **Een levende zee** : voor een huis aan de kust een bewegende zee met golven die door de wind worden aangedreven, een getij dat de kalender volgt (afgesteld op een echt hoogwater van je haven), stranden van zand, kiezels, koraal of rots en het geluid van de branding (sectie *Sea* van de editor).
- **Een catalogus die groeit** : bomen met tot vier weergaven per jaar en kleurvariëteiten (appelbomen met rode, gele of groene vruchten, kers, wilg, eucalyptus…) en objecten komen uit de open [huiscatalogus](https://github.com/Elwinmage/house-catalog), op de achtergrond bijgewerkt, offline bruikbaar, uit te breiden met de [catalogus-editor](https://github.com/Elwinmage/catalog-editor).
- **Tonen zonder je huis te tonen** : een knop *Load the demo* voegt een fictief huis op een willekeurige plek toe, om de kaart te filmen, te presenteren of uit te proberen (standaard verborgen: in te schakelen in de opties van de integratie).
- **Niets te installeren behalve de integratie** : de kaart wordt door de integratie geserveerd (geen Lovelace-resource), alles wordt in de kaart zelf bewerkt (✎), meerdere woningen kunnen naast elkaar bestaan, je correcties worden los van de plattegrond bewaard (opnieuw importeren verliest niets) en de interface spreekt acht talen (Engels, Frans, Spaans, Duits, Italiaans, Pools, Portugees, Nederlands).

## Installatie

1. Installeer met HACS (aangepaste repository, type *Integration*), of kopieer `custom_components/house_view/` naar `config/custom_components/`, en herstart dan Home Assistant.
2. Voeg de integratie *House View* toe: geef de woning een naam en een locatie (standaard de locatie van Home Assistant). Elke woning is een eigen item: voeg de integratie opnieuw toe voor een tweede woning (een vakantiehuis…), met eigen plattegrond, terrein en bewerkingen; de kaart toont één woning, gekozen met de optie `home`.
3. Voeg de kaart toe aan een dashboard (`type: custom:house-view-card`).
4. Open ⚙ in de kaart (alleen beheerders) om je plattegrond te importeren (Sweet Home 3D, IFC of SVG) of een eenvoudige te tekenen, haal dan het terrein op (cartes.gouv.fr in Frankrijk, elders wereldwijd open data: zie [Terreinbronnen per land](#terreinbronnen-per-land)) of laad een terrein-`.json`.

De versie van de kaart wordt in de browserconsole afgedrukt bij het laden (`🏠 HOUSE VIEW v0.x.y`). Schoonmaken per kamer en het pictogram van de integratie vereisen Home Assistant 2026.3 of nieuwer.

De gebouwde kaart wordt niet gecommit: `release.yml` bouwt hem bij elke release en publiceert `house_view.zip`, dat HACS installeert. Voor ontwikkeling: `cd card && npm install && npm run build`.

## Configuratie van de kaart

De opties worden ingesteld in de visuele editor van de kaart (bewerk het dashboard en kies dan *Bewerken* op de kaart), in vier secties: tijd en weer, weergave, verlichting, robotstofzuiger. De plattegrond, het terrein en alles wat in de weergave is geplaatst, worden in de kaart zelf ingesteld (✎ en ⚙). In YAML:

```yaml
type: custom:house-view-card
home: 01JXYZ…                         # optioneel, meerdere woningen: het getoonde item (gekozen in de visuele editor); standaard het eerste
weather_entity: weather.home          # live weer (optioneel)
rain_entity: binary_sensor.rain       # optioneel: regendetector of sensor voor de regenintensiteit (mm/u) van je weerstation
wind_speed_entity: sensor.wind_speed   # optioneel: windsnelheidssensor (weerstation of internetweerdienst)
wind_bearing_entity: sensor.wind_dir  # optioneel: windrichtingssensor (graden of windstreken)
mode: live                            # live (realtime) | simulation (schuifregelaars voor tijd / datum / weer)
view: Vue générale                    # beginstandpunt (optioneel): de naam op zijn knop
show_views: true                      # knoppen voor camerastandpunten
show_levels: true                     # knoppen voor dak / verdiepingen (+ 🌡 als kamertemperaturen bekend zijn)
tap_action: zoom                      # tik op een kamer: zoom (tweede tik = lichten) | toggle_lights | none
show_entities: true                   # in de editor geplaatste entiteiten
show_alarms: true                     # centrale alarmbadge (rechtsboven)
vacuum_entity: vacuum.robot           # optioneel: standaard de eerste gevonden vacuum.*
vacuum_poll: 15                       # seconden tussen twee positiemetingen (Roborock: cloudactie, min. 5)
vacuum_show_floor: false              # true = tijdens het schoonmaken de vloer van de robot van bovenaf tonen
vacuum_rate: 1                        # m²/min, voor het geschatte pad van een robot zonder positie
vacuum_progress_entity: sensor.xxx    # optioneel: voortgang (%); voor Roborock automatisch gevonden
movable_camera: true                  # beweegbare camera (draaien, zoomen, verschuiven); false = vast op de standpunten
height: fill                          # fill (schermhoogte onder de bovenkant van de kaart) | aspect (16/10) | 600 | "70vh"
min_height: 320                       # minimumhoogte in de modus fill (px)
fps_cap: 30                           # limiet voor beelden per seconde (wandschermen, tablets)
year_seconds: 10                      # 📅-knop: speelt de seizoenen van een heel jaar af in zoveel seconden (5 tot 60)
toolbar_buttons: [preview]            # in de werkbalk gehouden hulpmiddelen (preview, year, camera, sim, edit, setup); de andere staan in het ⋮-menu
hide_menu: false                      # true: geen ⋮-menu voor gebruikers die geen beheerder zijn (wandscherm)
light_entities: [light.living, ...]   # optioneel: beperkt de meegenomen lichten
```

## Live weergave

- **Werkbalk** (rechtsboven): de alarmbadge, de robotstofzuigers en het ⋮-menu, dat de gelegenheidshulpmiddelen bevat (voorbeeld van seizoen / weer / tijdstip, een jaar simuleren, cameravergrendeling, simulatie, demo) en, voor beheerders, de editor ✎ en de instellingen ⚙. De optie `toolbar_buttons` houdt er enkele in de werkbalk; `hide_menu` verbergt het menu voor gebruikers die geen beheerder zijn.
- **Breedtegraad, lengtegraad, tijdzone**: die van de woning (ingesteld bij het toevoegen; standaard de configuratie van Home Assistant). De seizoenen van de vegetatie en het gras volgen het klimaat van de breedtegraad: vier seizoenen in gematigde streken; vanaf 50° richting de polen een winter die langer wordt en een korte zomer (aan het eind van april op 68° nog steeds winter); tussen de keerkringen geen winter maar een regen- en een droge tijd (de bomen houden hun bladeren, het gras vergeelt wat in de droge tijd, minder nabij de evenaar), die het seizoensvoorbeeld in plaats van de vier seizoenen aanbiedt. Op het zuidelijk halfrond is alles omgekeerd.
- **Kamers ↔ gebieden**: een kamer van de plattegrond is gekoppeld aan het Home Assistant-gebied met dezelfde naam (accenten en hoofdletters genegeerd). ⚙ toont de kamers zonder bijbehorend gebied; via ✎ → *Rooms ↔ Home Assistant areas* kies je per kamer een ander gebied, of geen.
- **Lichten**: status, kleur en helderheid van de `light.*`-entiteiten van het gebied van elke kamer.
- **Weer**: de weerentiteit `weather_entity` bepaalt het getoonde weer: regen (`rainy`, `pouring`, `hail`), sneeuw (`snowy`, `snowy-rainy`), onweer (`lightning`, `lightning-rainy`), mist, bewolking; de temperatuur, wind en bewolkingsgraad ervan worden gebruikt als ze beschikbaar zijn. Met `rain_entity` (een regendetector-`binary_sensor`, of een sensor voor de regenintensiteit in mm/u) volgt de regen wat er echt bij jou valt: regen op de sensor → regen, zwaarder of lichter naargelang de gemeten intensiteit; zegt de weerdienst regen maar is de sensor droog → bewolkte lucht zonder regen (onweer: bliksem zonder regen). Sneeuw en onweer blijven bij de weerdienst, omdat een regenmeter ze niet kan onderscheiden; een gecumuleerde hoeveelheid ("regen vandaag" in mm) wordt genegeerd, omdat ze niet zegt of het nu regent.
- **Wind en regenintensiteit**: regen en sneeuw vallen schuin als het waait, in de richting van de wind: hoe harder de wind, hoe schuiner ze vallen (windstil → verticaal, 60 km/u en meer → ongeveer 50°). De richting volgt het noorden van de plattegrond, dus een westenwind duwt de regen naar de oostkant van je huis. Windsnelheid en -richting komen van de weerentiteit (`wind_speed`, `wind_bearing`), of van eigen sensoren via `wind_speed_entity` (km/u, m/s, mph, kn, ft/s, Beaufort) en `wind_bearing_entity` (graden, of windstreken zoals `NW`): een weerstation, of de sensoren van een internetweerdienst. De hoeveelheid regen bepaalt hoe de regen eruitziet: motregen is ijl, traag en kort, een stortbui dicht, snel en lang. Ze komt uit de intensiteit van `rain_entity` (mm/u; 8 mm/u en meer is een stortbui), anders uit de weerentiteit (`pouring` is zwaarder dan `rainy`). Een niet-beschikbare sensor laat de weerentiteit bepalen.
- **Inzoomen op een kamer**: een tik zoomt in op de kamer (dak en hogere verdiepingen verborgen); een tweede tik op dezelfde kamer schakelt zijn lichten; *← room* gaat terug naar de vorige weergave.
- **Voorbeeld** (weerknop): forceert een seizoen (lente, zomer, herfst, winter), een weertype (helder, bewolkt, regen, onweer, sneeuw, mist) of een moment (ochtend, middag, schemering, nacht), die gecombineerd kunnen worden; terug naar live met de knop *Preview … ✕*, of automatisch na 3 minuten. In de simulatiemodus zijn dit snelkoppelingen naar de schuifregelaars.
- **Camera**: de knop rechtsboven ontgrendelt of vergrendelt de camera zonder de configuratie aan te raken.
- **Temperaturen**: de temperatuursensor van het gebied (ingesteld op het gebied in Home Assistant), anders de eerste `sensor.*` met `device_class: temperature` van het gebied; getoond bij het aanwijzen en als laag (🌡).
- **Simulatiemodus**: ☀ opent tijd (met afspelen), datum, weerpreset, wolken, neerslag, wind (kracht en richting), temperatuur en sneeuw.
- **Wegen**: als asfalt op het reliëf getekend (uit te schakelen in ⚙).
- **Prestaties**: het renderen stopt als de kaart niet zichtbaar is; de lichtvolumes worden alleen herbouwd als een relevante status verandert.

## Robotstofzuiger

- **Schoonmaken per kamer**: als er een `vacuum.*`-entiteit bestaat, verschijnt zijn pictogram rechtsboven. Een tik opent de kamerselectie (de vloer van de robot wordt van bovenaf getoond): elke aangetikte kamer wordt, als ze aan een gebied is gekoppeld, gemarkeerd; *Clean* roept dan `vacuum.clean_area` aan met de gekozen gebieden (generieke actie van Home Assistant 2026.3+; de koppeling tussen de kamers van de robot en de gebieden wordt eenmalig gemaakt in de instellingen van de vacuum-entiteit). *Start*, *Pause* en *Dock* ook.
- **Het schoonmaken volgen** (✎ → *Robot vacuum*): een 3D-robot (kleur naar keuze, standaard wit) rijdt over de plattegrond, de kamer die wordt schoongemaakt wordt ingekleurd (kleur naar keuze) met zijn percentage, de kamers die nog komen worden lichter ingekleurd, een klaar kamer glinstert een minuut lang, en een cirkelvormige meter rond het robotpictogram geeft de totale voortgang. Bij een fout (`error`) knipperen de kamer en de robot rood met een ⚠-teken.
- **Dock**: *Place the dock* en tik dan op de vloer; dit is het referentiepunt tussen de kaart van de robot en de plattegrond. De **richting** ervan wordt in graden ingesteld (0° = naar de bovenkant van de plattegrond gericht, 90° naar rechts, de standaard), met kwartslagen (⟲ / ⟳) of met *Aim with a tap*: tik voor het dock, waar de robot uit rijdt. De werkloze robot parkeert voor het dock, in dezelfde richting.
- **Positie van de robot**: *Roborock* (officiële actie `roborock.get_vacuum_current_position`, dock op 25500 / 25500; dit gaat via de cloud, dus één meting elke `vacuum_poll` seconden, vertraagd na een fout), *attributen van een entiteit* (`vacuum_position {x, y}` en `charger`, zoals kaartextractors ze leveren) of *geen*: de robot volgt dan een geschat pad (heen en weer, kamer na kamer), gemarkeerd met "estimated position".
- **Kalibratie**: rotatie, spiegeling en schaal; *Calibrate with a tap* berekent de rotatie als je de echte positie van de robot aantikt zodra hij van zijn dock af is; *remember* bewaart de coördinaten van het dock voor andere merken.
- **Uitlijnen met de kaart van de robot**: *Show the map of the robot over the plan* legt de afbeelding die de robot van de vloer tekent (een `image.*`- of `camera.*`-entiteit van zijn apparaat) half doorzichtig over de vloer van het dock, waarbij de hogere verdiepingen verborgen zijn. Het dock is het vaste punt: draai de afbeelding met de rotatieschuif tot haar muren die van de plattegrond volgen; de gevonden rotatie is die van de robot. Als de entiteit `calibration_points` geeft (kaartextractors, *Roborock Custom Map*), plaatst de afbeelding zichzelf. Anders (afbeeldingsentiteiten van de officiële Roborock-integratie) tik je waar de afbeelding het dock tekent (*The dock is here on the map*), verschuif je haar in stappen van 5 cm en stel je de grootte van een pixel in als de kamers te groot of te klein zijn (standaard 12,5 mm voor Roborock, anders 50 mm).
- **Percentage van een kamer**: aandeel van de vloer dat de robot heeft bestreken (schatting: 80 % van de vloer wordt als bereikbaar beschouwd); de totale voortgang komt van de sensor van de robot als die er is (Roborock: `cleaning_progress`).
- *Test the animation* speelt een versneld schoonmaakproces af (met of zonder fout) zonder de robot te starten.
- **Meerdere robots**: elke `vacuum.*` heeft zijn eigen knop in de werkbalk, zijn eigen kamerselectie en zijn eigen 3D-robot, pad en kamerkleuren. In ✎ → *Robot vacuum* kiest de lijst *Robot* welke wordt ingesteld (dock, positie, kalibratie, kaart worden per robot bewaard); *Show this robot* verbergt er een uit de weergave en de werkbalk (bijvoorbeeld een robot van een andere woning).

## Catalogus: bomen en objecten

De bomen en de meubelstukken zijn niet in de kaart ingebouwd: ze komen uit de [huiscatalogus](https://github.com/Elwinmage/house-catalog), waar het toevoegen van een soort of een object een pull request is, geen nieuwe versie van deze integratie.

- **Bomen**: elke soort heeft tot vier weergaven, één per seizoen: kleur en dichtheid van het loof, bloesem, vruchten, bladeren op de grond. De weergave vloeit dag na dag van het ene seizoen in het volgende over (om te beginnen eik, den, taxus, kersenboom en abrikozenboom, dan Japanse sierkers, vlier, appel, peer, eucalyptus en treurwilg, dan echte dadelpalm, Canarische dadelpalm en kokospalm, zilverspar en fijnspar). Een soort kan **variëteiten** in kleur hebben (rode, gele of groene appels), die als `Appelboom - Gala (red)` in de plantlijst worden aangeboden. Het zijn de soorten die worden aangeboden als je in de editor een boom plant, binnen de hoogten die de catalogus geeft.
- **Objecten**: een meubelstuk van de plattegrond waarvan de naam een trefwoord van een catalogusobject bevat (`Chaise`, `Chair`, `Stuhl`…) wordt ermee getekend, op de plek en in het formaat van het meubelstuk, in plaats van een gewone doos; als de plattegrond het meubelstuk een kleur geeft, neemt het object die over op zijn kleurbare delen. Zo wordt ook een plant van de plattegrond die naar een boom van de catalogus is genoemd (`Cerisier`, `Yew`) als die boom getekend.
- **Vissen**: de vissen van de vijvers (om te beginnen koikarper), elk met zijn kleurvariëteiten; de kaart tekent ze zelf, van bovenaf gezien.
- **Updates**: de integratie downloadt de catalogus op de achtergrond van GitHub (de kaart maakt nooit verbinding met het netwerk) en werkt offline met het exemplaar dat ze meelevert. Het apparaat *House view catalog* heeft een update-entiteit per sectie (bomen, objecten), een schakelaar *Automatic update* (standaard aan) en een knop *Update now*.
- **Je eigen items**: met de [catalogus-editor](https://github.com/Elwinmage/catalog-editor) wordt een boom of object dat je opslaat meteen door de weergave gebruikt, voordat je het aan de catalogus voorstelt (of zonder het voor te stellen).

## Editor (✎)

Voor beheerders. De editor is een menu van secties: een sectie opent in een eigen venster over het menu, en een item van een lijst (een besproeiingsleiding, een zone, een entiteit van het algemene paneel, een deur…) opent zijn bewerkingsvenster over de sectie; de pijl ← van een venster gaat terug naar het venster eronder. Alles wordt opgeslagen in het bewerkingsbestand, los van de plattegrond en het terrein; Escape annuleert de lopende tekening.

- **Geplaatste entiteiten** (sensoren, lichten, schakelaars, keuzelijsten…): met een tik geplaatst en daarna verplaatst door hun label te slepen (editor open). Vast aan de vloer (standaard: het label blijft in zijn kamer, onder welke hoek ook), aan een muur (kant van de kamer, verborgen als de muur van achteren wordt gezien) of vrij in hoogte; een label dat door een hogere verdieping of het dak wordt verborgen, wordt niet getoond, behalve een label dat *boven het dak getoond* wordt; zolang *Placed entities* in de editor open is, wordt elk label getoond (gedimd als het huis het verbergt), zodat een entiteit overal kan worden geplaatst en versleept, kamers inbegrepen. Badge (pictogram + waarde) of alleen pictogram; kleur, label, pictogram (pictogramkiezer van Home Assistant met voorbeeld); getoond in de algemene weergave (altijd, of in de weergave van zijn verdieping; met *Shown over the roof* kan de temperatuur van een kamer van veraf worden afgelezen); tik = more-info, schakelen of niets. In de editor is de lijst ingeklapt: alleen de gekozen entiteit is uitgeklapt. Entiteiten worden gekozen uit die van de huidige kamer, gegroepeerd per apparaat (het hele huis is één vinkje verder, met een zoekfunctie); pictogrammen worden getoond terwijl je hun naam typt.
- **Algemeen paneel** (links, onder de verdiepingsknoppen): sensoren en actuatoren van het hele huis (buitentemperatuur, alarmpaneel…), in de gekozen volgorde, met hun label en pictogram; een tik schakelt wat te schakelen is en opent het dialoogvenster van de andere (of zoals gekozen: schakelen, dialoogvenster, niets).
- **Alarmen**: een badge rechtsboven, groen met een vinkje als alles goed is, rood met een bel en het aantal tussen haakjes als er alarmen actief zijn; een tik opent hun lijst (tik op een alarm = zijn dialoogvenster). Automatisch gevonden: sensoren voor probleem, rook, gas, koolmonoxide, waterlek, hitte, kou en sabotage en afgegane alarmpanelen (reeftank-alarmen inbegrepen); entiteiten kunnen met de hand worden toegevoegd, en een alarm kan uit de lijst zelf (doorgestreepte bel) of uit de editor worden weggelaten. Elke kamer met actieve alarmen (kamer gekoppeld aan een Home Assistant-gebied) toont ook een rode bel met hun aantal; een tik opent de lijst van die kamer (*All* gaat terug naar het hele huis); deze kamerbadges kunnen in de editor worden uitgeschakeld. Optie `show_alarms`.
- **Klikbare zones**: een mediaspeler op een meubelstuk van de plattegrond (tik erop in de editor) of op een rechthoek op een muur of vloer; een reeftank-aquarium op een rechthoek ter grootte van de bak (voorkant op een muur, bovenkant op een vloer). Een tik opent de speler, of de weergave van het aquarium van ha-reef-card in een venster; de rechthoek van een aquarium toont die weergave live, met bewegende vissen (optie per zone), in de weergave van het aquarium die voor de zone is gekozen (anders zijn standaardweergave). Bij het plaatsen licht de muur of vloer onder de aanwijzer op en wordt de rechthoek erop getekend; een zone wordt verplaatst door haar over haar oppervlak te slepen. Breedte, hoogte, hoogte van het midden (muur) of rotatie (vloer) zijn aan te passen. Een **link** (*Add a link*) opent, in hetzelfde soort venster, een dashboard van Home Assistant (een pad zoals `/lovelace/cameras`, of een volledig adres, in een frame getoond) of een willekeurige Lovelace-kaart (zijn configuratie als JSON, bijv. `{"type": "picture-entity", "entity": "camera.garden"}`); op een rechthoek verschijnt hij als een tegel met zijn pictogram en naam (pictogram en tegel optioneel).
- **Geplaatste lichten**: een geplaatste `light.*` wordt een lichtbron op die plek van de kamer (spot, hanglamp, lamp, strip of onzichtbaar; hoogte en bereik instelbaar; op een muur: een wandlamp op de aangetikte hoogte), aangestuurd door zijn eigen status en kleur. De andere lichten van het gebied blijven de hele kamer verlichten.
- **Entiteiten van een kamer**: als je op een kamer bent ingezoomd, zijn alleen de entiteiten van die kamer zichtbaar; die van de algemene weergave verdwijnen (de robotstofzuiger beweegt nog als hij er is). In de editor zoomt een tik op een kamer erop in en wordt het bewerken dat van de kamer (rode banner bovenaan): de dan toegevoegde entiteiten worden op zijn vloer, op een muur of in de lucht geplaatst en horen alleen bij die kamer. Ze verdwijnen als een andere kamer wordt gekozen of bij terugkeer naar de algemene weergave. Een entiteit van de algemene weergave die in een kamer staat, verhuist naar die kamer met haar instelling *Its room only*.
- **Deuren en ramen** (*Doors and windows*): de openingen van de plattegrond (Sweet Home 3D, IFC), per verdieping en kamer weergegeven, of gekozen met een tik in de weergave (de opening onder de aanwijzer licht op). Elk kan worden gekoppeld aan een open/dicht-sensor (`binary_sensor`), een gemotoriseerde opener (`cover` van het raam) en, voor ramen en terrasdeuren, een rolluik (`cover`). Een kamer met één raam wordt vanzelf gekoppeld aan de raamsensor, de opener en het rolluik van zijn gebied als er van elk één is; een kamer met één deur aan zijn deursensor; een met de hand ingestelde koppeling wint, en een automatische koppeling kan worden verwijderd. In de weergave openen de raamvleugels (één, twee boven 1,10 m) naar binnen, een terrasdeur schuift, een deurvleugel draait (een binnendeur krijgt zijn vleugel zodra hij is gekoppeld) en het rolluik komt op de buitenkant omlaag tot de positie van de `cover` (`current_position`, vloeiend).
- **Zwembaden en vijvers** (*Pools and ponds*): van bovenaf getekend, als rechthoek (twee tegenoverliggende hoeken) of vrije vorm (punt voor punt, *Finish*), met een naam, een waterkleur en een diepte (0,2 tot 6 m). De grond wordt uitgegraven: een zwembad heeft verticale wanden, een vlakke bodem en een boordrand, een vijver een hellende bodem en een kiezelbank; de grond eromheen wordt geëgaliseerd en het water beweegt. Een schoonmaakrobot kan aan een entiteit worden gekoppeld (`binary_sensor`, `switch`, `input_boolean`, `vacuum`, `light`, `fan`, `sensor`, of elke andere entiteit op haar id getypt): hij doorkruist de bodem zolang ze aan staat en blijft anders geparkeerd. **Lampen** kunnen in de wand van een zijde worden gezet (plaats langs de zijde, diepte, elk één entiteit): een gekleurd licht geeft zijn eigen kleur, een stekker de in de editor gekozen kleur, en lampen die aan zijn kleuren het water en het bad, 's nachts des te meer. Een **rolluik** rolt zijn lamellen vanaf een zijde over het water, met de oproller op de rand of in het water, volgens een `cover`-entiteit (haar stand) of alles wat open of dicht zegt; een klik op het zeil in het beeld opent of sluit het. Is het rolluik opgerold, dan reageert de oproller op de klik. Een zwembad of vijver telt als een **kamer**: een tik zoomt de camera erop in (weergave op te slaan zoals die van een kamer), er kunnen entiteiten en links in worden geplaatst (laag van de kamer) en hij kan aan een Home Assistant-gebied worden gekoppeld (op naam of in de gebiedskoppeling). Het zwembad van de geïmporteerde plattegrond blijft zoals het is. Een vijver kan **eilanden** bevatten (getekend zoals de omtrek: de grond blijft een beetje boven het water, met een kiezelbank; bomen en entiteiten komen erop) en **vissen** uit de huiscatalogus: groepen van een vis (om te beginnen koikarper), een variëteit (kohaku rood en wit, benigoi rood, yamabuki ogon geel, showa…) of eigen kleuren (lichaam, vlekken, patroon, glanzende schubben), een aantal en een grootte: 3 rode, 1 rood en wit, 2 gele zijn drie groepen. Elke vis heeft zijn eigen tekening, dwaalt door het water rond de eilanden, neemt de kleur van het water aan naarmate hij dieper zit en zakt naar de bodem als het water koud is.
- **Kamerweergave**: als je op een kamer bent ingezoomd en de editor open is, slaat *📷 Room view* de camera en de zichtbare verdiepingen op; een tik op die kamer opent dan deze weergave in plaats van de automatische zoom. *Automatic view* gaat ernaar terug.
- **Hekken** (*Fences*): elke zijde heeft zijn type (gaas, hout, muur, smeedijzer, stijve panelen, rieten scherm, composiet latten, gabions, negen hagen per soort — laurier, thuja, Leylandcipres, haagbeuk, photinia, liguster, bamboe, buxus, gemengde landschapshaag — of open waar geen hek staat) en zijn hoogte. Twee manieren om er een te maken: *Fence from the cadastre* (de percelen van het huis zijn vooraf geselecteerd, tik om aangrenzende percelen van hetzelfde eigendom toe te voegen of te verwijderen; de omtrek van het geheel wordt omheind) of *Draw a fence* (opeenvolgende tikken, het bovenaanzicht "Dessus" wordt aanbevolen; elke zijde krijgt het in het palet gekozen type, één kleur per type). *Edit the sides*: het type van een zijde met een tik wijzigen, een zijde in tweeën knippen (een deel als muur, het andere als gaas), een punt verwijderen.
- **Poorten** (*Gates*): *Add a gate* en tik dan op een hek waar de poort komt: het hek opent zich er vanzelf onder. Een willekeurig aantal poorten, op elk hek; *Move* en dan een tik op een andere plek schuift er een, *Delete* verwijdert hem (het hek sluit weer). Instellingen: opening (draaiend met 1 of 2 vleugels, schuivend met 1 of 2 vleugels), vulling (spijlen, dicht, gemengd), bovenkant (recht of gebogen), breedte, hoogte, kleur, pilaren, **de kant van het hek waarnaar hij opent** en, bij één vleugel, het uiteinde waar hij scharniert of schuift. Een `cover` (positie) of een `binary_sensor` (aan = open) beweegt hem, in 6 s; *Try the animation* toont hem open zonder enige entiteit.
- **Bloembedden** (*Flower beds*): teken een gebied punt voor punt en kies dan het **aantal bloemen** en een **lijst van kleuren met gewichten** (3 rode op 1 witte geeft drie rode bloemen voor elke witte). De bloemen worden willekeurig geplant maar altijd op dezelfde manier (*Plant again* trekt een andere indeling); de bloei volgt het seizoen: geen in de winter, driekwart in de lente, alle in de zomer, een derde in de herfst.
- **Besproeiing** (*Watering*):
  - **Druppelleidingen**: één leiding per klep (`switch`, `valve`, `input_boolean`), punt voor punt getekend en bij het renderen afgerond; zwarte, bruine, groene of verborgen buis. Als de klep open is, wordt de leiding blauw, lopen er glinsteringen langs, zwelt en krimpt in een lus een druppel onder elke druppelaar (standaard 30 cm uit elkaar, licht uit de pas van de ene druppelaar naar de volgende: de leiding fonkelt) en groeit een natte plek tot een strook. De breedte van de plek volgt het model van Schwartzman & Zur (1986), uit het debiet van de druppelaar, de openingstijd en het bodemtype; ze vervaagt binnen 30 minuten na het sluiten.
  - **Sproeiers**: één kring per klep, met een of meer sproeiers (cataloguusmodel: Hunter Pro-Spray PSU-04 8A tot 17A, SRM-04, PGJ-04, PGP Ultra, MP Rotator, of generiek; minimale / maximale afstand, richting en hoek vooraf ingevuld en aanpasbaar; *Aim* met een tik). Als de klep open is, wordt de geschatte besproeide sector getoond en de straal geanimeerd (zwaaiend voor een rotor, waaiervormig voor een sproeikop).
  - *Test the animation* speelt 30 seconden versnelde besproeiing af (30 s = 1 u 30) op elke leiding en kring, zonder een klep te openen: de natte plek groeit, de stralen draaien, en dan keert alles terug naar de echte status. De knop *Test* van een leiding of kring doet hetzelfde voor die alleen; het sluiten van de editor stopt de test.
- **Overige hulpmiddelen**: buitenobjecten (verbergen, hoogte, verschuiving, rotatie), zwembadpeil, bomen (verwijderen, toevoegen met soort en hoogte, ongedaan maken, alles herstellen), grondcorrecties (lage muur, terras, penselen, doorsnede, bewerkbare lijst van correcties), standpunten.

## Instellingen (⚙)

- **Demo** (om de weergave te filmen of te presenteren zonder je huis of de ligging ervan te tonen; standaard verborgen, zie *De demo tonen* verderop): *Load the demo* voegt een woning "Démo" toe met een fictief huis met twee verdiepingen (het Sweet Home 3D-bestand `custom_components/house_view/demo/demo-maison.sh3d` kan worden geopend en bewerkt), een terrein met drie plateaus met een boomgaard, een zwembad, een vijver, een hek, besproeiing, een robotstofzuiger en rolluiken, op een fictieve plek (45° N). Je woningen blijven ongemoeid. De entiteiten ervan worden door de kaart gesimuleerd (er wordt niets aangemaakt in Home Assistant en niets van je huis wordt getoond): een scenario van de dag, met 1 u per 2 s, opent en sluit de rolluiken, schakelt de lichten, besproeit bij zonsopgang, laat de stofzuiger 's ochtends draaien en de zwembadrobot 's middags, laat vóór het avondeten een waterlek optreden… De 🎬-knop in de werkbalk pauzeert het, stelt het uur in en activeert met de hand een gebeurtenis (rolluiken, lichten, stofzuiger, besproeiing, robots, lek, rook); een tik op een gesimuleerde entiteit schakelt haar. *Reset the demo* zet haar terug zoals geleverd, *Leave the demo* keert terug naar je woning; de demowoning kan zoals elk ander item worden verwijderd. Je echte aquaria (reeftank) kunnen er nog steeds in worden geplaatst. De bestanden worden gegenereerd door `npm run demo` in `card/`. De demowoning begint leeg en vlak, om vanaf het begin te worden gefilmd: importeer `demo-maison.sh3d` (*Download demo-maison.sh3d* in ⚙) met *Import a .sh3d* en haal dan het terrein op met *Fetch the terrain*: het ophalen doorloopt zijn stappen en brengt het terrein van de demo, zonder enige netwerktoegang.
- **Plattegrond**: *Import a plan* leest in de browser een Sweet Home 3D-bestand (`.sh3d`), een IFC-bestand (`.ifc`, BIM: ArchiCAD, Revit, FreeCAD, BlenderBIM: verdiepingen, ruimtes, muren, deuren en ramen) of een SVG-plattegrond (`.svg`, zoals getekend voor ha-floorplan of met Inkscape: elke benoemde vorm is een kamer, een Inkscape-laag een verdieping; *Scale: SVG units per meter* corrigeert het formaat) en toont wat is gevonden. Zonder plattegrondbestand: *Create a simple plan* opent een bouwer van rechthoekige kamers, verdieping per verdieping (sleep een kamer om hem te verplaatsen, zijn hendels om het formaat te wijzigen, de randen sluiten aan op de naburige kamers; naam en Home Assistant-gebied, deuren, ramen en terrasdeuren op een muur aangeklikt met hun breedte, hoogte en dorpel; plafondhoogte per verdieping, een nieuwe verdieping kopieert de omtrek van de onderliggende; dak automatisch, zadeldak of plat), terwijl de 3D-weergave op de achtergrond wordt bijgewerkt. *Plan from the robot's map* start er een uit de kamers van de kaart van een robotstofzuiger (kaartextractors die `rooms` vermelden). Een SVG van rechthoeken en de kamers van de robot openen in de eenvoudige plattegrond, om deuren en ramen toe te voegen. Elke kamer krijgt een plafondlamp die door de lichten van zijn gebied wordt aangestuurd. De meubels van een Sweet Home 3D-plattegrond worden met hun eigen 3D-modellen getekend (OBJ-modellen van het bestand, licht gehouden: hooguit enkele duizenden driehoeken, één kleur per materiaal, de gemiddelde kleur van een textuur), op hun formaat, gedraaid en gespiegeld zoals in de plattegrond; *Furniture drawn with the 3D models of the plan* gaat terug naar eenvoudige vormen.
- **Het terrein ophalen** (*Terrain (DTM)*): de integratie haalt het reliëf en de omgeving zelf op, rond de coördinaten van Home Assistant (aanpasbaar). De bron volgt het land van de Home Assistant-configuratie (*Automatic*), of wordt in het formulier afgedwongen:
  - **Frankrijk: cartes.gouv.fr (IGN)**: LiDAR HD-grond op 0,5 m (anders RGE ALTI op 1 m), oppervlaktemodel (automatische uitlijning, bomen), gebouwen, wegen en kadaster (BD TOPO, percelen), luchtfoto of IGN-kaart over de grond gelegd. Heeft het IGN geen gegevens voor de plek, dan nemen de wereldwijde bronnen het over;
  - **Wereld: Mapterhorn + OpenStreetMap**: reliëf uit de tegels van [Mapterhorn](https://mapterhorn.com) (open LiDAR van veel landen, elders 30 m; bij gebrek daaraan de grovere Terrain Tiles van Mapzen op AWS), gebouwen en wegen uit OpenStreetMap. Geen oppervlaktemodel, kadaster of luchtfoto: bomen worden met de editor geplaatst, het hek wordt met de hand getekend.

  In beide gevallen: optioneel springen naar het dichtstbijzijnde gebouw (de locatie van Home Assistant is vaak bij benadering), automatische uitlijning van de plattegrond aan het eind, en de bron onder het formulier getoond.
- **GitHub-back-up**: opties van de integratie, menu *GitHub backup* (privérepository `eigenaar/naam`, fine-grained token met *Contents: read and write*, branch, map); knoppen *Back up to GitHub* / *Restore from GitHub* in ⚙. Alleen de gewijzigde bestanden worden gecommit; een openbare repository wordt geweigerd (ze bevat de plattegrond van je huis).
- **Bewerkingsbeveiliging**: alleen Home Assistant-beheerders kunnen de weergave wijzigen. Om ook onbedoelde wijzigingen te voorkomen (een gedeeld scherm dat met een beheerdersaccount ingelogd bleef), kan een wachtwoord worden gevraagd voordat de editor ✎ en de instellingen ⚙ openen:
  - het wordt ingesteld in de opties van de integratie (Instellingen → Apparaten en diensten → House View → Configureren → *Edit protection*): 4 tekens of meer, leeg veld om het huidige te behouden, een selectievakje om de beveiliging te verwijderen. Het wordt als gezouten hash bewaard, nooit in leesbare tekst;
  - de kaart vraagt er om als ✎ of ⚙ opent (het potlood draagt dan een hangslot), en opnieuw na 10 minuten zonder wijziging, na het herladen van de pagina of na een herstart van Home Assistant. De 🔒-knop bovenaan het paneel vergrendelt direct opnieuw;
  - de controle gebeurt door de integratie: zonder geldig wachtwoord wordt elke schrijfactie geweigerd (HTTP-code 423), ook buiten de kaart. Na 5 verkeerde wachtwoorden moet je 1 minuut wachten;
  - wachtwoord vergeten: wijzig of verwijder het in de opties van de integratie;
  - de weergave bekijken, zoomen, de lichten of de stofzuiger bedienen en het voorbeeld van seizoen / weer blijven vrij.
- **De demo tonen**: ze is standaard verborgen. Opties van de integratie → *Demo* → *Hide the demo* uitvinken om de sectie *Load the demo* in de instellingen van de kaart te krijgen (een reeds geladen demowoning behoudt in beide gevallen haar eigen knoppen).

## Terreinbronnen per land

Frankrijk gebruikt de diensten van het IGN. Overal elders komt het reliëf van [Mapterhorn](https://mapterhorn.com), dat de open nationale LiDAR-opnames over een wereldwijd model van 30 m legt, en komen de gebouwen en wegen van [OpenStreetMap](https://www.openstreetmap.org). De vermelde resolutie is die welke Mapterhorn in november 2026 aankondigde; ze verbetert met elke versie van het project (actuele dekkingskaart op mapterhorn.com).

| | Land | Reliëf | Gebouwen, wegen | Kadaster, luchtfoto | Getest |
|---|---|---|---|---|---|
| 🇫🇷 | Frankrijk | IGN LiDAR HD 0,5 m (anders RGE ALTI 1 m) | IGN BD TOPO | IGN (percelen, luchtfoto of kaart) | ✅ |
| 🇦🇹 | Oostenrijk | Mapterhorn: 1 m | OpenStreetMap | — | ❌ |
| 🇧🇪 | België | Mapterhorn: 0,5 m (Wallonië) | OpenStreetMap | — | ❌ |
| 🇩🇰 | Denemarken | Mapterhorn: 0,4 m | OpenStreetMap | — | ❌ |
| 🇪🇪 | Estland | Mapterhorn: 1 m | OpenStreetMap | — | ❌ |
| 🇩🇪 | Duitsland | Mapterhorn: 0,25 m (Baden-Württemberg), 1 m (de meeste deelstaten) | OpenStreetMap | — | ❌ |
| 🇮🇹 | Italië | Mapterhorn: LiDAR op Sicilië en een deel van Sardinië | OpenStreetMap | — | ❌ |
| 🇱🇺 | Luxemburg | Mapterhorn: 0,5 m | OpenStreetMap | — | ❌ |
| 🇳🇱 | Nederland | Mapterhorn: nationale LiDAR | OpenStreetMap | — | ❌ |
| 🇳🇴 | Noorwegen | Mapterhorn: 1 m | OpenStreetMap | — | ❌ |
| 🇵🇱 | Polen | Mapterhorn: nationale LiDAR | OpenStreetMap | — | ❌ |
| 🇵🇹 | Portugal | Mapterhorn: 0,5 m (gedeeltelijke dekking) | OpenStreetMap | — | ❌ |
| 🇷🇴 | Roemenië | Mapterhorn: 0,5 m (gedeeltelijke dekking) | OpenStreetMap | — | ❌ |
| 🇸🇰 | Slowakije | Mapterhorn: 1 m | OpenStreetMap | — | ❌ |
| 🇸🇮 | Slovenië | Mapterhorn: 0,5 m | OpenStreetMap | — | ❌ |
| 🇪🇸 | Spanje | Mapterhorn: 0,5 m (gedeeltelijke dekking) | OpenStreetMap | — | ❌ |
| 🇸🇪 | Zweden | Mapterhorn: 1 m | OpenStreetMap | — | ❌ |
| 🇨🇭 | Zwitserland | Mapterhorn: 0,25 m (kanton Zürich), 0,5 m (gedeeltelijke dekking) | OpenStreetMap | — | ❌ |
| 🇬🇧 | Verenigd Koninkrijk | Mapterhorn: 1 m (Engeland, Schotland, Wales) | OpenStreetMap | — | ❌ |
| 🌍 | Rest van de wereld | Mapterhorn: 30 m (Copernicus GLO-30); bij gebrek daaraan Terrain Tiles (Mapzen / AWS) | OpenStreetMap | — | ❌ |

> **Buiten Frankrijk niet getest.** De wereldwijde bronnen zijn geschreven op basis van hun documentatie en gecontroleerd met gesimuleerde gegevens, zonder de kans ze echt uit te proberen. Mislukt het ophalen of geeft het een inconsistent reliëf op jouw plek, [open dan een issue](https://github.com/elwinmage/ha-house-view-component/issues) met het land, de gekozen bron en de melding onder het formulier. Goed nieuws is ook welkom: dan kan het land als getest worden gemarkeerd.

Met een model van 30 m is het terrein slechts een hellend vlak: met de grondcorrecties van de editor (✎) kun je terrassen en taluds opnieuw tekenen. Kadaster en luchtfoto's bestaan alleen per land; ze kunnen op verzoek worden toegevoegd, één issue per land.

## HTTP-API (door de kaart gebruikt)

| Route | GET | POST | DELETE |
|---|---|---|---|
| `/api/house_view/homes` | ingestelde woningen: `[{id, title}]` | | |
| `/api/house_view/demo` | plattegrond van het demohuis (beheerder) | maakt de demowoning aan of zet haar terug zoals geleverd → `{home}` (beheerder) | |
| `/api/house_view/info` | status, naam en locatie van de woning | | |
| `/api/house_view/scene` | plattegrond | vervangt (beheerder) | |
| `/api/house_view/terrain` | hoogteraster | vervangt (beheerder) | verwijdert (beheerder) |
| `/api/house_view/edits` | bewerkingen | vervangt (beheerder) | verwijdert (beheerder) |
| `/api/house_view/ortho` | grondfoto / kaart | vervangt (beheerder) | verwijdert (beheerder) |
| `/api/house_view/fetch` | status van het ophalen | start het ophalen van het terrein, `provider`: `auto` \| `ign` \| `world` (beheerder) | |
| `/api/house_view/github` | | `{"action": "backup" \| "restore"}` (beheerder) | |
| `/api/house_view/unlock` | `{locked, unlocked}` | `{"password"}` → token (beheerder) | vergrendelt opnieuw |

Met meerdere woningen neemt elke route `?home=<id van het item>` (zonder dit de eerste woning).

Als een bewerkingswachtwoord is ingesteld, hebben de schrijfacties (POST / DELETE hierboven) ook de header `X-House-View-Unlock` nodig met het token dat `/unlock` teruggeeft; anders antwoorden ze 423.

Elk document wordt gevalideerd (`validate.py`) en bewaard in `.storage/house_view.<key>` (woning ingesteld vóór versie 0.2) of `.storage/house_view.<home id>.<key>`; elke schrijfactie activeert de gebeurtenis `house_view_updated` (`key`, `updated`, `home`). Het verwijderen van een woning verwijdert haar documenten. De documenten zijn groot (een terrein is enkele MB): ze reizen via HTTP (Home Assistant-limiet van 16 MB per verzoek), niet via de websocket.

## Ontwikkeling en tests

```bash
pip install pre-commit
# (optioneel) cd card && npm install om de build en de tests met de hand uit te voeren
pre-commit install            # ruff, prettier, vitest, vertalingen, pytest (100 % dekking); pre-commit beheert de afhankelijkheden van de hooks
pre-commit run --all-files
```

- **Integratie**: `pytest` (echte HTTP-server van Home Assistant via `pytest-homeassistant-custom-component`, 100 % dekking vereist).
- **Kaart**: `cd card && npm test` (vitest); `npm run build` schrijft `custom_components/house_view/frontend/house-view-card.js`; `npm run format` (prettier).
- **Vertalingen**: `scripts/check_translations.py` controleert dat elke taal van de integratie (en, fr, it, de, es, pl, pt, nl) en van de kaart (`card/src/i18n.js`) precies de sleutels van het Engels heeft. Deze README bestaat in dezelfde acht talen (`doc/<taal>/README.<taal>.md`).
- **Testpagina zonder Home Assistant**: `python3 card/test/harness/server.py` (nep-API-server), daarna http://localhost:8765/card/test/harness/index.html
- **Merkafbeeldingen**: `custom_components/house_view/brand/` (pictogram en logo, licht en donker), geserveerd door Home Assistant 2026.3+ zonder omweg via de repository `home-assistant/brands`. Vectorbronnen in `assets/brand/`; `scripts/build_brand.sh` bouwt de PNG-bestanden opnieuw (`rsvg-convert`, ImageMagick, lettertype Inter).
- **CI** (`.github/workflows/`): `validate.yml` (hassfest + HACS), `tests.yml` (pre-commit, pytest, vitest + build), `release.yml` (met de hand gestart met de versie: werkt `manifest.json` en `card/package.json` bij, bouwt de kaart, tagt, publiceert de release met `house_view.zip`).
- **Catalogusclient**: `catalog_pack.py` en `catalog_runtime.py` zijn kopieën van `reeftech-catalog/client/` (de client kent alleen zijn eigen secties: `catalog.py` declareert die van het huis); `house_catalog_sections.py` en `catalog_builtin*/` zijn kopieën van de beschrijving en van de items van `house-catalog`. Ze worden allemaal geschreven door de `scripts/sync_client.py` van die repositories: wijzig ze daar, nooit hier.

`card/src/engine.js` is de 3D-engine (één instantie per kaart, geen afhankelijkheid van Home Assistant); `card/src/ha-bridge.js` zet de status van Home Assistant om in gegevens voor de engine; `card/src/engine/` bevat de modules van het prototype (geometrie, vegetatie, terrein, lichten…).

## Roadmap

1. ✅ Fase 1: integratie + kaart, import van de plattegrond, terrein, uitlijning, live lichten en weer.
2. ✅ Editors in de kaart: buitenobjecten, bomen, grondcorrecties, eigen standpunten.
3. ✅ Terrein opgehaald door de integratie voor Frankrijk (IGN), wegen, grondfoto, hekken, geplaatste entiteiten, robotstofzuiger, inzoomen op een kamer, voorbeeld van seizoen / weer, GitHub-back-up.
4. ✅ Andere landen: reliëf van Mapterhorn, gebouwen en wegen van OpenStreetMap (land voor land te bevestigen). Volgende stap: kadaster en luchtfoto van de landen die ze als open data publiceren.
5. ✅ Catalogus (bomen met vier seizoenen, objecten) gelezen uit `house-catalog` en bewerkt met `catalog_editor`. Volgende stap: meer soorten en objecten, sproeiermodellen.
6. ✅ Meerdere woningen, meerdere robotstofzuigers, entiteiten van een kamer bij inzoomen, deuren / ramen / rolluiken gekoppeld aan Home Assistant, in de grond uitgegraven zwembaden en vijvers, editor in vensters.

## Licentie

Code onder de [MIT](../../LICENSE)-licentie © Elwinmage. Het pictogram en het logo (`assets/brand/`) zijn originele creaties van het project, onder dezelfde licentie.

- **In de gebouwde kaart gebundelde bibliotheken**: [three.js](https://threejs.org) (MIT), [Lit](https://lit.dev) (BSD-3-Clause) en [fflate](https://github.com/101arrowz/fflate) (MIT); hun licentievermeldingen staan aan het eind van het gebouwde bestand.
- **Gegevens**: de repository bevat geen kaartgegevens; elke gebruiker downloadt de gegevens van zijn eigen perceel, en de bron wordt vermeld in ⚙ → *Terrain (DTM)*. Vermeld bij het publiceren van een schermafbeelding die bron:
  - Frankrijk: diensten van het IGN (cartes.gouv.fr), onder de [Licence Ouverte Etalab 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/);
  - reliëf buiten Frankrijk: [Mapterhorn](https://mapterhorn.com/attribution) en de open datasets die het samenbrengt, of de [Terrain Tiles](https://registry.opendata.aws/terrain-tiles) van Mapzen;
  - gebouwen en wegen buiten Frankrijk: © [OpenStreetMap](https://www.openstreetmap.org/copyright)-bijdragers, onder de ODbL-licentie.
- Merknamen (Hunter, Roborock, Sweet Home 3D…) behoren toe aan hun eigenaars en worden alleen vermeld om compatibiliteit te beschrijven.
