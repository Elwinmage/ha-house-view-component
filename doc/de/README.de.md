<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../custom_components/house_view/brand/dark_logo.png">
    <img src="../../custom_components/house_view/brand/logo.png" alt="House View" width="420">
  </picture>
</p>

# House View

**Verfügbare Sprachen:**
[<img src="https://flagicons.lipis.dev/flags/4x3/fr.svg" style="width: 5%;"/>](../fr/README.fr.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/gb.svg" style="width: 5%;"/>](../../README.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/es.svg" style="width: 5%;"/>](../es/README.es.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/de.svg" style="width: 5%;"/>](README.de.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/pl.svg" style="width: 5%;"/>](../pl/README.pl.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/pt.svg" style="width: 5%;"/>](../pt/README.pt.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/it.svg" style="width: 5%;"/>](../it/README.it.md)

Eine Pseudo-3D-Liveansicht Ihres Hauses für Home Assistant: Ihr **Sweet Home 3D**-Plan auf einem digitalen Geländemodell, mit Lichtern, Wetter, Sonne und Jahreszeiten in Echtzeit, dazu Saugroboter, Gartenbewässerung und Zäune. Ein einziges Repository enthält:

- `custom_components/house_view/`: die **Integration** (speichert den Plan, das Gelände und Ihre Korrekturen; lädt das Gelände; HTTP-API);
- `card/`: die **Lovelace-Karte** `house-view-card` (three.js), gebaut nach `custom_components/house_view/frontend/`. Die Integration liefert sie selbst aus (`/house_view/house-view-card.js`) und lädt sie auf allen Dashboards: **keine Lovelace-Ressource einzutragen**.

Die Oberfläche der Karte gibt es auf Englisch und Französisch: auf Deutsch wird sie englisch angezeigt, deshalb stehen die Namen der Schaltflächen und Abschnitte hier auf Englisch. Die Optionen der Integration gibt es auf Englisch, Französisch, Italienisch, Deutsch, Spanisch, Polnisch und Portugiesisch. Übersetzungen sind willkommen: Die Texte liegen in `custom_components/house_view/translations/` und `card/src/i18n.js`.

## Installation

1. Mit HACS installieren (benutzerdefiniertes Repository, Typ *Integration*) oder `custom_components/house_view/` nach `config/custom_components/` kopieren, dann Home Assistant neu starten.
2. Die Integration *House View* hinzufügen. Einzustellen ist nichts: Der Standort kommt aus der Konfiguration von Home Assistant.
3. Die Karte einem Dashboard hinzufügen (`type: custom:house-view-card`).
4. In der Karte ⚙ öffnen (nur Administratoren), um Ihren `.sh3d`-Plan zu importieren; danach das Gelände abrufen (cartes.gouv.fr in Frankreich, weltweite offene Daten sonst: siehe [Geländequellen nach Land](#geländequellen-nach-land)) oder ein Gelände als `.json` laden.

Die Version der Karte erscheint beim Laden in der Browserkonsole (`🏠 HOUSE VIEW v0.x.y`). Die Reinigung nach Räumen und das Symbol der Integration benötigen Home Assistant 2026.3 oder neuer.

Die gebaute Karte liegt nicht im Repository: `release.yml` baut sie bei jedem Release und veröffentlicht `house_view.zip`, das HACS installiert. Für die Entwicklung: `cd card && npm install && npm run build`.

## Konfiguration der Karte

Die Optionen werden im visuellen Editor der Karte eingestellt (Dashboard bearbeiten, dann *Bearbeiten* an der Karte), in vier Abschnitten: Zeit und Wetter, Anzeige, Lichter, Saugroboter. Der Plan, das Gelände und alles, was in der Ansicht platziert ist, werden in der Karte selbst eingestellt (✎ und ⚙). Als YAML:

```yaml
type: custom:house-view-card
weather_entity: weather.zuhause       # Live-Wetter (optional)
rain_entity: binary_sensor.regen      # optional: Regenmelder oder Sensor der Regenrate (mm/h) Ihrer Wetterstation
wind_speed_entity: sensor.wind_tempo    # optional: Sensor der Windgeschwindigkeit (Wetterstation oder Internet-Wetterdienst)
wind_bearing_entity: sensor.wind_richt  # optional: Sensor der Windrichtung (Grad oder Himmelsrichtungen)
mode: live                            # live (Echtzeit) | simulation (Regler für Uhrzeit / Datum / Wetter)
view: Vue générale                    # Startansicht (optional): der Name auf ihrer Schaltfläche
show_views: true                      # Schaltflächen der Kameraansichten
show_levels: true                     # Schaltflächen Dach / Geschosse (+ 🌡, wenn Raumtemperaturen bekannt sind)
tap_action: zoom                      # Tippen auf einen Raum: zoom (zweites Tippen = Lichter) | toggle_lights | none
show_entities: true                   # im Editor platzierte Entitäten
show_alarms: true                     # zentrales Alarm-Abzeichen (oben rechts)
vacuum_entity: vacuum.robot           # optional: standardmäßig der erste gefundene vacuum.*
vacuum_poll: 15                       # Sekunden zwischen zwei Positionsabfragen (Roborock: Cloud-Aktion, min. 5)
vacuum_show_floor: false              # true = während der Reinigung das Geschoss des Roboters von oben zeigen
vacuum_rate: 1                        # m²/min, für den geschätzten Weg eines Roboters ohne Position
vacuum_progress_entity: sensor.xxx    # optional: Fortschritt (%); bei Roborock automatisch gefunden
movable_camera: true                  # bewegliche Kamera (Drehen, Zoom, Verschieben); false = auf die Ansichten fixiert
height: fill                          # fill (Bildschirmhöhe unterhalb der Kartenoberkante) | aspect (16/10) | 600 | "70vh"
min_height: 320                       # Mindesthöhe im Modus fill (px)
fps_cap: 30                           # Obergrenze der Bilder pro Sekunde (Wandbildschirme, Tablets)
light_entities: [light.wohnzimmer, ...]  # optional: beschränkt die berücksichtigten Lichter
```

## Liveansicht

- **Breite, Länge, Zeitzone**: werden aus der Konfiguration von Home Assistant gelesen. Auf der Südhalbkugel sind die Jahreszeiten der Vegetation vertauscht.
- **Räume ↔ Bereiche**: Ein Raum des Plans ist mit dem gleichnamigen Bereich von Home Assistant verknüpft (Akzente und Groß-/Kleinschreibung werden ignoriert). ⚙ listet die Räume ohne passenden Bereich; unter ✎ → *Rooms ↔ Home Assistant areas* lässt sich Raum für Raum ein anderer Bereich oder keiner wählen.
- **Lichter**: Zustand, Farbe und Helligkeit der `light.*`-Entitäten des Bereichs jedes Raums.
- **Wetter**: Die Wetter-Entität `weather_entity` bestimmt das angezeigte Wetter: Regen (`rainy`, `pouring`, `hail`), Schnee (`snowy`, `snowy-rainy`), Gewitter (`lightning`, `lightning-rainy`), Nebel, Wolken; Temperatur, Wind und Bewölkung werden übernommen, wenn vorhanden. Mit `rain_entity` (ein Regenmelder `binary_sensor` oder ein Sensor der Regenrate in mm/h) folgt der Regen dem, was bei Ihnen wirklich fällt: Regen am Sensor → Regen, je nach gemessener Rate stärker oder schwächer; der Wetterdienst meldet Regen, aber der Sensor ist trocken → bedeckter Himmel ohne Regen (Gewitter: Blitze ohne Regen). Schnee und Gewitter bestimmt weiterhin der Wetterdienst, da ein Regenmesser sie nicht unterscheiden kann; eine Summe („Regen heute“ in mm) wird ignoriert, weil sie nicht sagt, ob es gerade regnet.
- **Wind und Regenstärke**: Regen und Schnee fallen bei Wind schräg, in die Richtung, in die der Wind weht: je stärker der Wind, desto schräger (Windstille → senkrecht, 60 km/h und mehr → etwa 50°). Die Richtung folgt dem Norden des Plans: Ein Westwind treibt den Regen also zur Ostseite Ihres Hauses. Geschwindigkeit und Richtung kommen von der Wetter-Entität (`wind_speed`, `wind_bearing`) oder von eigenen Sensoren mit `wind_speed_entity` (km/h, m/s, mph, kn, ft/s, Beaufort) und `wind_bearing_entity` (Grad oder Himmelsrichtungen wie `NW`): eine Wetterstation oder die Sensoren eines Internet-Wetterdienstes. Die Regenmenge bestimmt das Aussehen des Regens: Nieselregen ist spärlich, langsam und kurz, ein Wolkenbruch dicht, schnell und lang. Sie kommt von der Rate von `rain_entity` (mm/h; ab 8 mm/h Wolkenbruch), sonst von der Wetter-Entität (`pouring` ist stärker als `rainy`). Ist ein Sensor nicht verfügbar, gilt wieder die Wetter-Entität.
- **Zoom auf einen Raum**: Ein Tippen zoomt auf den Raum (Dach und obere Geschosse ausgeblendet); ein zweites Tippen auf denselben Raum schaltet seine Lichter um; *← Raum* führt zur vorherigen Ansicht zurück.
- **Vorschau** (Wetter-Schaltfläche): erzwingt eine Jahreszeit (Frühling, Sommer, Herbst, Winter), ein Wetter (klar, bewölkt, Regen, Gewitter, Schnee, Nebel) oder eine Tageszeit (Morgen, Mittag, Dämmerung, Nacht), auch kombiniert; zurück zur Liveansicht mit der Schaltfläche *Preview … ✕* oder automatisch nach 3 Minuten. Im Simulationsmodus sind es Abkürzungen zu den Reglern.
- **Kamera**: Die Schaltfläche oben rechts entsperrt oder sperrt die Kamera, ohne die Konfiguration zu ändern.
- **Temperaturen**: der Temperatursensor des Bereichs (Einstellung des Bereichs in Home Assistant), sonst der erste `sensor.*` mit `device_class: temperature` des Bereichs; Anzeige beim Überfahren und als Ebene (🌡).
- **Simulationsmodus**: ☀ öffnet Uhrzeit (mit Ablauf), Datum, Wettervorgabe, Wolken, Niederschlag, Wind (Stärke und Richtung), Temperatur und Schnee.
- **Straßen**: als Asphalt auf dem Relief gezeichnet (in ⚙ abschaltbar).
- **Leistung**: Das Rendern stoppt, wenn die Karte nicht sichtbar ist; die Lichtvolumen werden nur neu berechnet, wenn sich ein relevanter Zustand ändert.

## Saugroboter

- **Reinigung nach Räumen**: Gibt es eine `vacuum.*`-Entität, erscheint ihr Symbol oben rechts. Ein Tippen öffnet die Raumauswahl (das Geschoss des Roboters wird von oben gezeigt): Jeder angetippte Raum, der mit einem Bereich verknüpft ist, wird hervorgehoben, dann ruft *Clean* `vacuum.clean_area` mit den gewählten Bereichen auf (generische Aktion von Home Assistant 2026.3+; die Zuordnung zwischen den Räumen des Roboters und den Bereichen erfolgt einmalig in den Einstellungen der Saugroboter-Entität). Ebenso *Start*, *Pause* und *Dock*.
- **Verfolgung der Reinigung** (✎ → *Robot vacuum*): Ein 3D-Roboter (Farbe wählbar, standardmäßig weiß) bewegt sich über den Plan, der gerade gereinigte Raum wird eingefärbt (Farbe wählbar) und zeigt seinen Prozentwert, die noch folgenden Räume werden heller eingefärbt, ein fertiger Raum funkelt eine Minute lang, und eine Ringanzeige um das Robotersymbol zeigt den Gesamtfortschritt. Bei einem Fehler (`error`) blinken Raum und Roboter rot mit einem ⚠-Zeichen.
- **Ladestation**: *Place the dock*, dann auf den Boden tippen; sie ist der Bezugspunkt zwischen der Karte des Roboters und dem Plan. Ihre **Ausrichtung** wird in Grad eingestellt (0° = zeigt zum oberen Rand des Plans, 90° nach rechts, der Standardwert), in Vierteldrehungen (⟲ / ⟳) oder mit *Aim with a tap*: vor die Station tippen, dorthin, wo der Roboter herausfährt. Der ruhende Roboter parkt vor der Station, in derselben Richtung.
- **Position des Roboters**: *Roborock* (offizielle Aktion `roborock.get_vacuum_current_position`, Station bei 25500 / 25500; sie läuft über die Cloud, daher eine Abfrage alle `vacuum_poll` Sekunden, nach einem Fehler verlangsamt), *Attribute einer Entität* (`vacuum_position {x, y}` und `charger`, wie Kartenextraktoren sie liefern) oder *keine*: Der Roboter folgt dann einem geschätzten Weg (hin und her, Raum für Raum), gekennzeichnet mit „estimated position“.
- **Kalibrierung**: Drehung, Spiegelung und Maßstab; *Calibrate with a tap* berechnet die Drehung, wenn man die tatsächliche Position des Roboters antippt, sobald er die Station verlassen hat; *remember* speichert die Koordinaten der Station für andere Marken.
- **Ausrichten an der Karte des Roboters**: *Show the map of the robot over the plan* legt das Bild, das der Roboter vom Boden zeichnet (eine `image.*`- oder `camera.*`-Entität seines Geräts), halb durchsichtig auf den Boden der Ladestation; die Etagen darüber werden ausgeblendet. Die Ladestation ist der Fixpunkt: Das Bild mit dem Drehregler drehen, bis seine Wände denen des Plans folgen; die gefundene Drehung wird auf den Roboter angewendet. Liefert die Entität `calibration_points` (Kartenextraktoren, *Roborock Custom Map*), platziert sich das Bild von selbst. Andernfalls (Bild-Entitäten der offiziellen Roborock-Integration) dorthin tippen, wo das Bild die Ladestation zeichnet (*The dock is here on the map*), es in Schritten von 5 cm verschieben und die Größe eines Pixels anpassen, wenn die Räume zu groß oder zu klein sind (standardmäßig 12,5 mm für Roborock, sonst 50 mm).
- **Prozentwert eines Raums**: Anteil des vom Roboter befahrenen Bodens (Schätzung: 80 % des Bodens gelten als erreichbar); der Gesamtfortschritt kommt vom Sensor des Roboters, wenn es einen gibt (Roborock: `cleaning_progress`).
- *Test the animation* spielt eine beschleunigte Reinigung ab (mit oder ohne Fehler), ohne den Roboter zu starten.

## Katalog: Bäume und Objekte

Bäume und Möbel sind nicht in der Karte fest eingebaut: Sie kommen aus dem [Hauskatalog](https://github.com/Elwinmage/house-catalog), in dem eine neue Art oder ein neues Objekt ein Pull Request ist und keine neue Version dieser Integration.

- **Bäume**: Jede Art hat bis zu vier Darstellungen, eine pro Jahreszeit: Farbe und Dichte des Laubs, Blüte, Früchte, Laub am Boden. Die Ansicht geht Tag für Tag von einer Jahreszeit in die nächste über (zum Start Eiche, Kiefer, Eibe, Kirschbaum und Aprikosenbaum). Es sind die Arten, die beim Pflanzen eines Baums im Editor angeboten werden, innerhalb der Höhen, die der Katalog angibt.
- **Objekte**: Ein Möbelstück des Plans, dessen Name ein Stichwort eines Katalogobjekts enthält (`Chaise`, `Chair`, `Stuhl`…), wird damit gezeichnet, an Ort und in Größe des Möbelstücks, statt als einfacher Quader; gibt der Plan dem Möbelstück eine Farbe, übernimmt das Objekt sie an seinen einfärbbaren Teilen. Ebenso wird eine Pflanze des Plans, die wie ein Baum des Katalogs heißt (`Kirschbaum`, `Yew`), als dieser Baum gezeichnet.
- **Aktualisierungen**: Die Integration lädt den Katalog im Hintergrund von GitHub (die Karte greift nie auf das Netz zu) und funktioniert offline mit der mitgelieferten Kopie. Das Gerät *House view catalog* hat eine Update-Entität pro Bereich (Bäume, Objekte), einen Schalter *Automatische Aktualisierung* (standardmäßig an) und eine Taste *Jetzt aktualisieren*.
- **Eigene Einträge**: Mit dem [Katalog-Editor](https://github.com/Elwinmage/catalog-editor) wird ein Baum oder ein Objekt, das Sie speichern, sofort von der Ansicht verwendet, bevor (oder ohne dass) Sie es dem Katalog vorschlagen.

## Editor (✎)

Nur für Administratoren. Es ist immer nur ein Abschnitt aufgeklappt; alles wird in der Bearbeitungsdatei gespeichert, getrennt von Plan und Gelände; Escape bricht das laufende Zeichnen ab.

- **Platzierte Entitäten** (Sensoren, Lichter, Schalter, Auswahlen…): mit einem Tippen gesetzt, dann durch Ziehen ihres Etiketts verschoben (Editor geöffnet). Befestigung am Boden (Standard: das Etikett bleibt unabhängig vom Blickwinkel in seinem Raum), an der Wand (auf der Raumseite, ausgeblendet, wenn die Wand von hinten gesehen wird) oder frei in der Höhe; ein von einem oberen Geschoss oder dem Dach verdecktes Etikett wird nicht angezeigt. Plakette (Symbol + Wert) oder nur Symbol; Farbe, Beschriftung, Symbol (Symbolauswahl von Home Assistant mit Vorschau); sichtbar immer, in der Ansicht seines Geschosses oder beim Zoom auf seinen Raum; Tippen = Detaildialog, Umschalten oder nichts. Im Editor ist die Liste zugeklappt: Nur die gewählte Entität ist aufgeklappt. Entitäten werden aus denen des aktuellen Raums gewählt, nach Gerät gruppiert (das ganze Haus ein Häkchen entfernt, mit Suche); Symbole werden beim Tippen ihres Namens angezeigt.
- **Allgemeine Leiste** (links, unter den Etagen-Schaltflächen): Sensoren und Aktoren des ganzen Hauses (Außentemperatur, Alarmzentrale…), in der gewählten Reihenfolge, mit Beschriftung und Symbol; ein Tippen schaltet um, was umschaltbar ist, und öffnet sonst den Dialog (oder nach Wahl: umschalten, Dialog, nichts).
- **Alarme**: ein Abzeichen oben rechts, grün mit Häkchen, wenn alles in Ordnung ist, rot mit Glocke und der Anzahl in Klammern, wenn Alarme ausgelöst sind; ein Tippen öffnet ihre Liste (Tippen auf einen = sein Dialog). Automatisch erkannt: Problem-, Rauch-, Gas-, Kohlenmonoxid-, Wasserleck-, Hitze-, Kälte- und Sabotagesensoren sowie ausgelöste Alarmzentralen (einschließlich der reeftank-Alarme); Entitäten können von Hand hinzugefügt und ein Alarm direkt in der Liste (durchgestrichene Glocke) oder im Editor ignoriert werden. Jeder Raum mit ausgelösten Alarmen (mit einem Home-Assistant-Bereich verknüpft) zeigt außerdem eine rote Glocke mit ihrer Anzahl; ein Tippen öffnet die Liste dieses Raums (*All* zurück zum ganzen Haus); diese Raum-Abzeichen lassen sich im Editor abschalten. Option `show_alarms`.
- **Antippbare Zonen**: ein Mediaplayer auf einem Möbelstück des Plans (im Editor angetippt) oder auf einem Rechteck an einer Wand oder auf einem Boden; ein reeftank-Aquarium auf einem Rechteck in der Größe des Beckens (Vorderseite an der Wand, Oberseite auf dem Boden). Ein Tippen öffnet den Player oder die Aquarium-Ansicht von ha-reef-card in einem Fenster; das Rechteck eines Aquariums zeigt diese Ansicht live, mit schwimmenden Fischen (Option je Zone), in der für die Zone gewählten Ansicht des Aquariums (sonst seiner Standardansicht). Beim Platzieren leuchtet die Wand oder der Boden unter dem Zeiger auf und das Rechteck wird darauf gezeichnet; eine Zone wird verschoben, indem man sie auf ihrer Fläche zieht. Breite, Höhe, Höhe der Mitte (Wand) oder Drehung (Boden) sind einstellbar.
- **Platzierte Lichter**: Ein platziertes `light.*` wird zu einer Lichtquelle an dieser Stelle des Raums (Spot, Pendelleuchte, Lampe, Lichtleiste oder unsichtbar; Höhe und Reichweite einstellbar; an der Wand: eine Wandleuchte in der angetippten Höhe), gesteuert durch seinen eigenen Zustand und seine Farbe. Die übrigen Lichter des Bereichs beleuchten weiterhin den ganzen Raum.
- **Ansicht pro Raum**: Beim Zoom auf einen Raum und geöffnetem Editor speichert *📷 Room view* die Kamera und die sichtbaren Geschosse; ein Tippen auf diesen Raum öffnet danach diese Ansicht statt des automatischen Zooms. *Automatic view* kehrt dazu zurück.
- **Zäune** (*Fences*): Jede Seite hat ihren Typ (Maschendraht, Holz, Mauer, Hecke oder offen für ein Tor) und ihre Höhe. Zwei Wege, einen anzulegen: *Fence from the cadastre* (die Flurstücke des Hauses sind vorausgewählt, Tippen fügt benachbarte Flurstücke desselben Grundstücks hinzu oder entfernt sie; umzäunt wird der Umriss des Ganzen) oder *Draw a fence* (aufeinanderfolgende Tipps, die Draufsicht „Dessus“ wird empfohlen; jede Seite erhält den in der Palette gewählten Typ, eine Farbe pro Typ). *Edit the sides*: den Typ einer Seite per Tippen ändern, eine Seite in zwei teilen (ein Teil Mauer, der andere Maschendraht), einen Punkt entfernen.
- **Bewässerung** (*Watering*):
  - **Tropfbewässerung** (*Drip lines*): eine Leitung pro Ventil (`switch`, `valve`, `input_boolean`), Punkt für Punkt gezeichnet und in der Darstellung gerundet; Schlauch schwarz, braun, grün oder ausgeblendet. Bei offenem Ventil wird die Leitung blau, Lichtreflexe laufen an ihr entlang, unter jedem Tropfer wächst und schrumpft ein Tropfen in einer Schleife (standardmäßig 30 cm Abstand, von Tropfer zu Tropfer leicht versetzt: die Leitung glitzert), und ein feuchter Fleck wächst, bis ein Streifen entsteht. Die Breite des Flecks folgt dem Modell von Schwartzman & Zur (1986), abhängig vom Durchfluss des Tropfers, der Öffnungsdauer und der Bodenart; er verblasst innerhalb von 30 Minuten nach dem Schließen.
  - **Regner** (*Sprinklers*): ein Kreis pro Ventil, mit einem oder mehreren Regnern (Katalogmodell: Hunter Pro-Spray PSU-04 8A bis 17A, SRM-04, PGJ-04, PGP Ultra, MP Rotator oder generisch; minimale / maximale Wurfweite, Ausrichtung und Winkel vorausgefüllt und änderbar; *Aim* per Tippen). Bei offenem Ventil wird der geschätzte beregnete Sektor angezeigt und der Strahl animiert (Schwenken bei einem Getrieberegner, Fächer bei einer Sprühdüse).
  - *Test the animation* spielt 30 Sekunden beschleunigte Bewässerung ab (30 s = 1 h 30) auf allen Leitungen und Kreisen, ohne ein Ventil zu öffnen: Der feuchte Fleck wächst, die Strahlen drehen sich, dann kehrt alles zum tatsächlichen Zustand zurück. Die Schaltfläche *Test* einer Leitung oder eines Kreises macht dasselbe nur für diese(n); das Schließen des Editors beendet den Test.
- **Weitere Werkzeuge**: Außenobjekte (ausblenden, Höhe, Versatz, Drehung), Wasserstand des Pools, Bäume (entfernen, mit Art und Höhe hinzufügen, rückgängig, alle wiederherstellen), Bodenkorrekturen (Mäuerchen, Terrasse, Pinsel, Schnitt, änderbare Liste der Korrekturen), Ansichten.

## Einrichtung (⚙)

- **Plan**: *Import a .sh3d* liest Ihre Sweet Home 3D-Datei im Browser und listet das Gefundene auf (Geschosse, Räume, Wände, Lichter…).
- **Abruf des Geländes** (*Terrain (DTM)*): Die Integration ruft das Relief und seine Umgebung selbst ab, rund um die Koordinaten von Home Assistant (änderbar). Die Quelle richtet sich nach dem Land der Home-Assistant-Konfiguration (*Automatic*) oder wird im Formular vorgegeben:
  - **France: cartes.gouv.fr (IGN)**: LiDAR-HD-Boden mit 0,5 m (sonst RGE ALTI mit 1 m), Oberflächenmodell (automatische Ausrichtung, Bäume), Gebäude, Straßen und Kataster (BD TOPO, Flurstücke), Luftbild oder IGN-Karte auf den Boden gelegt. Hat das IGN an diesem Ort keine Daten, übernehmen die weltweiten Quellen;
  - **World: Mapterhorn + OpenStreetMap**: Relief aus den Kacheln von [Mapterhorn](https://mapterhorn.com) (offene LiDAR-Daten vieler Länder, sonst 30 m; ersatzweise die gröberen Terrain Tiles von Mapzen, gehostet bei AWS), Gebäude und Straßen aus OpenStreetMap. Kein Oberflächenmodell, kein Kataster, kein Luftbild: Bäume werden mit dem Editor gesetzt, der Zaun wird von Hand gezeichnet.

  In beiden Fällen: optionales Einrasten auf das nächstgelegene Gebäude (der Standort von Home Assistant ist oft ungenau), automatische Ausrichtung des Plans am Ende, und die Quelle wird unter dem Formular angezeigt.
- **GitHub-Sicherung**: Optionen der Integration, Menü *GitHub-Sicherung* (privates Repository `besitzer/name`, Fine-grained-Token mit *Contents: read and write*, Branch, Ordner); Schaltflächen *Back up to GitHub* / *Restore from GitHub* in ⚙. Nur geänderte Dateien werden committet; ein öffentliches Repository wird abgelehnt (es enthält den Plan Ihres Hauses).
- **Bearbeitungsschutz**: Nur Administratoren von Home Assistant können die Ansicht ändern. Um zusätzlich versehentliche Änderungen zu vermeiden (ein gemeinsam genutzter Bildschirm, der mit einem Administratorkonto angemeldet blieb), kann vor dem Öffnen des Editors ✎ und der Einrichtung ⚙ ein Passwort verlangt werden:
  - es wird in den Optionen der Integration festgelegt (Einstellungen → Geräte & Dienste → House View → Konfigurieren → *Bearbeitungsschutz*): mindestens 4 Zeichen, leeres Feld, um das aktuelle zu behalten, ein Kontrollkästchen, um den Schutz zu entfernen. Gespeichert wird es als gesalzener Hash, nie im Klartext;
  - die Karte fragt beim Öffnen von ✎ oder ⚙ danach (der Stift trägt dann ein Schloss), dann erneut nach 10 Minuten ohne Änderung, nach dem Neuladen der Seite oder einem Neustart von Home Assistant. Die Schaltfläche 🔒 oben im Panel sperrt sofort wieder;
  - die Prüfung erfolgt durch die Integration: Ohne gültiges Passwort wird jeder Schreibzugriff abgelehnt (HTTP-Code 423), auch außerhalb der Karte. Nach 5 falschen Passwörtern muss man 1 Minute warten;
  - Passwort vergessen: in den Optionen der Integration ändern oder entfernen;
  - die Ansicht betrachten, zoomen, Lichter oder Saugroboter steuern und die Jahreszeit- / Wettervorschau bleiben frei.

## Geländequellen nach Land

Frankreich nutzt die Dienste des IGN. Überall sonst stammt das Relief von [Mapterhorn](https://mapterhorn.com), das die offenen nationalen LiDAR-Daten über ein weltweites 30-m-Modell legt, und die Gebäude und Straßen stammen aus [OpenStreetMap](https://www.openstreetmap.org). Die angegebene Auflösung ist die von Mapterhorn im November 2026 genannte; sie verbessert sich mit jeder Version des Projekts (aktuelle Abdeckungskarte auf mapterhorn.com).

| | Land | Relief | Gebäude, Straßen | Kataster, Luftbild | Getestet |
|---|---|---|---|---|---|
| 🇫🇷 | Frankreich | IGN LiDAR HD 0,5 m (sonst RGE ALTI 1 m) | IGN BD TOPO | IGN (Flurstücke, Luftbild oder Karte) | ✅ |
| 🇧🇪 | Belgien | Mapterhorn: 0,5 m (Wallonien) | OpenStreetMap | — | ❌ |
| 🇩🇰 | Dänemark | Mapterhorn: 0,4 m | OpenStreetMap | — | ❌ |
| 🇩🇪 | Deutschland | Mapterhorn: 0,25 m (Baden-Württemberg), 1 m (die meisten Bundesländer) | OpenStreetMap | — | ❌ |
| 🇪🇪 | Estland | Mapterhorn: 1 m | OpenStreetMap | — | ❌ |
| 🇮🇹 | Italien | Mapterhorn: LiDAR in Sizilien und einem Teil Sardiniens | OpenStreetMap | — | ❌ |
| 🇱🇺 | Luxemburg | Mapterhorn: 0,5 m | OpenStreetMap | — | ❌ |
| 🇳🇱 | Niederlande | Mapterhorn: nationales LiDAR | OpenStreetMap | — | ❌ |
| 🇳🇴 | Norwegen | Mapterhorn: 1 m | OpenStreetMap | — | ❌ |
| 🇦🇹 | Österreich | Mapterhorn: 1 m | OpenStreetMap | — | ❌ |
| 🇵🇱 | Polen | Mapterhorn: nationales LiDAR | OpenStreetMap | — | ❌ |
| 🇵🇹 | Portugal | Mapterhorn: 0,5 m (teilweise Abdeckung) | OpenStreetMap | — | ❌ |
| 🇷🇴 | Rumänien | Mapterhorn: 0,5 m (teilweise Abdeckung) | OpenStreetMap | — | ❌ |
| 🇸🇪 | Schweden | Mapterhorn: 1 m | OpenStreetMap | — | ❌ |
| 🇨🇭 | Schweiz | Mapterhorn: 0,25 m (Kanton Zürich), 0,5 m (teilweise Abdeckung) | OpenStreetMap | — | ❌ |
| 🇸🇰 | Slowakei | Mapterhorn: 1 m | OpenStreetMap | — | ❌ |
| 🇸🇮 | Slowenien | Mapterhorn: 0,5 m | OpenStreetMap | — | ❌ |
| 🇪🇸 | Spanien | Mapterhorn: 0,5 m (teilweise Abdeckung) | OpenStreetMap | — | ❌ |
| 🇬🇧 | Vereinigtes Königreich | Mapterhorn: 1 m (England, Schottland, Wales) | OpenStreetMap | — | ❌ |
| 🌍 | Rest der Welt | Mapterhorn: 30 m (Copernicus GLO-30); ersatzweise Terrain Tiles (Mapzen / AWS) | OpenStreetMap | — | ❌ |

> **Außerhalb Frankreichs nicht getestet.** Die weltweiten Quellen wurden anhand ihrer Dokumentation geschrieben und mit simulierten Daten geprüft, ohne sie unter realen Bedingungen ausprobieren zu können. Wenn der Abruf fehlschlägt oder bei Ihnen ein unstimmiges Relief liefert, [eröffnen Sie bitte ein Issue](https://github.com/elwinmage/ha-house-view-component/issues) mit dem Land, der gewählten Quelle und der unter dem Formular angezeigten Meldung. Auch eine positive Rückmeldung ist willkommen: Dann kann das Land als getestet markiert werden.

Mit einem 30-m-Modell ist das Gelände nur eine geneigte Ebene: Mit den Bodenkorrekturen des Editors (✎) lassen sich Terrassen und Böschungen nachzeichnen. Kataster und Luftbilder gibt es nur Land für Land; sie können auf Anfrage ergänzt werden, ein Issue pro Land.

## HTTP-API (von der Karte verwendet)

| Route | GET | POST | DELETE |
|---|---|---|---|
| `/api/house_view/info` | Zustand + Standort von Home Assistant | | |
| `/api/house_view/scene` | Plan | ersetzt (Admin) | |
| `/api/house_view/terrain` | Höhenraster | ersetzt (Admin) | löscht (Admin) |
| `/api/house_view/edits` | Korrekturen | ersetzt (Admin) | löscht (Admin) |
| `/api/house_view/ortho` | Bodenfoto / -karte | ersetzt (Admin) | löscht (Admin) |
| `/api/house_view/fetch` | Zustand des Abrufs | startet den Abruf des Geländes, `provider`: `auto` \| `ign` \| `world` (Admin) | |
| `/api/house_view/github` | | `{"action": "backup" \| "restore"}` (Admin) | |
| `/api/house_view/unlock` | `{locked, unlocked}` | `{"password"}` → Token (Admin) | sperrt wieder |

Ist ein Bearbeitungspasswort gesetzt, verlangen die Schreibzugriffe (POST / DELETE oben) zusätzlich den Header `X-House-View-Unlock` mit dem von `/unlock` gelieferten Token; andernfalls antworten sie mit 423.

Jedes Dokument wird validiert (`validate.py`) und in `.storage/house_view.<schlüssel>` abgelegt; jeder Schreibzugriff löst das Ereignis `house_view_updated` aus (`key`, `updated`). Die Dokumente sind groß (ein Gelände umfasst mehrere MB): Sie laufen über HTTP (Home-Assistant-Grenze von 16 MB pro Anfrage), nicht über den Websocket.

## Entwicklung und Tests

```bash
pip install pre-commit
# (optional) cd card && npm install, um Build und Tests von Hand zu starten
pre-commit install            # ruff, prettier, vitest, Übersetzungen, pytest (100 % Abdeckung); pre-commit verwaltet die Abhängigkeiten der Hooks
pre-commit run --all-files
```

- **Integration**: `pytest` (echter HTTP-Server von Home Assistant über `pytest-homeassistant-custom-component`, 100 % Abdeckung verlangt).
- **Karte**: `cd card && npm test` (vitest); `npm run build` schreibt `custom_components/house_view/frontend/house-view-card.js`; `npm run format` (prettier).
- **Übersetzungen**: `scripts/check_translations.py` prüft, dass jede Sprache der Integration (en, fr, it, de, es, pl, pt) und der Karte (`card/src/i18n.js`) genau die Schlüssel des Englischen hat. Dieses README gibt es in denselben sieben Sprachen (`doc/<sprache>/README.<sprache>.md`).
- **Testseite ohne Home Assistant**: `python3 card/test/harness/server.py` (nachgebildeter API-Server), dann http://localhost:8765/card/test/harness/index.html
- **Markenbilder**: `custom_components/house_view/brand/` (Symbol und Logo, hell und dunkel), von Home Assistant 2026.3+ ausgeliefert, ohne Umweg über das Repository `home-assistant/brands`. Vektorquellen in `assets/brand/`; `scripts/build_brand.sh` erzeugt die PNG-Dateien neu (`rsvg-convert`, ImageMagick, Schrift Inter).
- **CI** (`.github/workflows/`): `validate.yml` (hassfest + HACS), `tests.yml` (pre-commit, pytest, vitest + Build), `release.yml` (von Hand mit der Version gestartet: aktualisiert `manifest.json` und `card/package.json`, baut die Karte, setzt das Tag, veröffentlicht das Release mit `house_view.zip`).
- **Katalog-Client**: `catalog_pack.py` und `catalog_runtime.py` sind Kopien von `reeftech-catalog/client/` (der Client kennt nur seine eigenen Bereiche: `catalog.py` meldet ihm die des Hauses an); `house_catalog_sections.py` und `catalog_builtin*/` sind Kopien der Beschreibung und der Einträge von `house-catalog`. Alle werden vom `scripts/sync_client.py` dieser Repositories geschrieben: Geändert wird dort, nie hier.

`card/src/engine.js` ist die 3D-Engine (eine Instanz pro Karte, ohne Abhängigkeit von Home Assistant); `card/src/ha-bridge.js` wandelt den Zustand von Home Assistant in Daten für die Engine um; `card/src/engine/` enthält die Module des Prototyps (Geometrie, Vegetation, Gelände, Lichter…).

## Fahrplan

1. ✅ Phase 1: Integration + Karte, Planimport, Gelände, Ausrichtung, Lichter und Wetter live.
2. ✅ Editoren in der Karte: Außenobjekte, Bäume, Bodenkorrekturen, eigene Ansichten.
3. ✅ Abruf des Geländes durch die Integration für Frankreich (IGN), Straßen, Bodenfoto, Zäune, platzierte Entitäten, Saugroboter, Zoom auf einen Raum, Jahreszeit- / Wettervorschau, GitHub-Sicherung.
4. ✅ Weitere Länder: Relief von Mapterhorn, Gebäude und Straßen von OpenStreetMap (Land für Land zu bestätigen). Danach: Kataster und Luftbild der Länder, die sie als offene Daten veröffentlichen.
5. ✅ Katalog (Bäume in vier Jahreszeiten, Objekte), gelesen aus `house-catalog` und bearbeitet mit `catalog_editor`. Danach: mehr Arten und Objekte, Regnermodelle.

## Lizenz

Code unter der [MIT](../../LICENSE)-Lizenz © Elwinmage. Symbol und Logo (`assets/brand/`) sind eigene Entwürfe des Projekts, unter derselben Lizenz.

- **In der gebauten Karte enthaltene Bibliotheken**: [three.js](https://threejs.org) (MIT), [Lit](https://lit.dev) (BSD-3-Clause) und [fflate](https://github.com/101arrowz/fflate) (MIT); ihre Lizenzhinweise bleiben am Ende der gebauten Datei erhalten.
- **Daten**: Das Repository enthält keinerlei Kartendaten; jede Nutzerin und jeder Nutzer lädt die Daten des eigenen Grundstücks, und die Quelle wird unter ⚙ → *Terrain (DTM)* angezeigt. Wer einen Screenshot veröffentlicht, nennt diese Quelle:
  - Frankreich: Dienste des IGN (cartes.gouv.fr), unter der [Licence Ouverte Etalab 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/);
  - Relief außerhalb Frankreichs: [Mapterhorn](https://mapterhorn.com/attribution) und die offenen Datensätze, die es zusammenführt, oder die [Terrain Tiles](https://registry.opendata.aws/terrain-tiles) von Mapzen;
  - Gebäude und Straßen außerhalb Frankreichs: © [OpenStreetMap](https://www.openstreetmap.org/copyright)-Mitwirkende, unter der ODbL-Lizenz.
- Markennamen (Hunter, Roborock, Sweet Home 3D…) gehören ihren Inhabern und werden nur genannt, um die Kompatibilität zu beschreiben.
