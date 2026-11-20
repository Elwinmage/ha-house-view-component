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

**Idiomas disponibles:**
[<img src="https://flagicons.lipis.dev/flags/4x3/fr.svg" style="width: 5%;"/>](../fr/README.fr.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/gb.svg" style="width: 5%;"/>](../../README.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/es.svg" style="width: 5%;"/>](README.es.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/de.svg" style="width: 5%;"/>](../de/README.de.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/pl.svg" style="width: 5%;"/>](../pl/README.pl.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/pt.svg" style="width: 5%;"/>](../pt/README.pt.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/it.svg" style="width: 5%;"/>](../it/README.it.md)

📘 **Guía completa** (instalación, configuración, uso, con imágenes): [GUIDE.es.md](GUIDE.es.md)

Vista pseudo-3D en directo de su casa para Home Assistant: su plano de **Sweet Home 3D** colocado sobre un modelo digital del terreno, con luces, meteorología, sol y estaciones en tiempo real, además de un robot aspirador, el riego del jardín y las vallas. Un único repositorio contiene:

- `custom_components/house_view/`: la **integración** (guarda el plano, el terreno y sus correcciones; descarga el terreno; API HTTP);
- `card/`: la **tarjeta Lovelace** `house-view-card` (three.js), compilada en `custom_components/house_view/frontend/`. La propia integración la sirve (`/house_view/house-view-card.js`) y la carga en todos los paneles: **no hay que declarar ningún recurso de Lovelace**.

La interfaz de la tarjeta y las opciones de la integración existen en inglés, francés, italiano, alemán, español, polaco y portugués (la tarjeta sigue el idioma de su perfil de Home Assistant). Los nombres de botones y secciones se citan aquí en inglés. Las traducciones son bienvenidas: los textos están en `custom_components/house_view/translations/` y `card/src/i18n.js`.

## Resumen

<p align="center"><img src="../images/four-seasons.webp" alt="La casa de demostración sobre su terreno durante las cuatro estaciones: sensores, riego, piscina, árboles" width="880"></p>

House View convierte el plano de su casa en una imagen viva de ella. Lo que la distingue:

- **Su casa, sobre su terreno real** : el plano de Sweet Home 3D (o IFC, SVG) se coloca sobre un modelo digital del terreno de la parcela (cartes.gouv.fr en Francia, datos abiertos en el resto), con el relieve, las carreteras, los árboles vecinos y sus vallas.
- **Sol, estaciones y tiempo reales** : la luz sigue al sol de su latitud, los árboles y el césped cambian con las estaciones, y lluvia, nieve, niebla, tormentas y viento (la lluvia se inclina hacia donde sopla el viento) siguen su entidad meteorológica o sus sensores. Un modo de simulación reproduce cualquier día, o un año entero, en pocos segundos.
- **Cada habitación, viva** : el estado, el color y el brillo reales de sus luces, las temperaturas, un toque para acercarse a una habitación y otro para encender o apagar sus luces; las luces colocadas en cualquier punto son fuentes de luz reales.
- **Sus entidades, donde están** : sensores, interruptores y selectores colocados en el plano, un panel general, una insignia central de alarmas (humo, fuga de agua, intrusión…), zonas pulsables (un reproductor sobre un mueble, un acuario de reeftank mostrado en vivo sobre su pecera).
- **Puertas, ventanas, persianas y portones que se mueven** : enlazados a sus contactos y persianas, se abren y cierran en la vista; un portón (batiente o corredero, 1 o 2 hojas, de barrotes o macizo, recto o arqueado) sigue a su cover o a su contacto.
- **Robot aspirador** : limpieza por habitaciones con un toque, un robot 3D que se mueve por el plano, habitaciones teñidas según su avance, varios robots, posición Roborock admitida.
- **Un jardín que trabaja** : goteo y aspersores animados por sus válvulas (manchas de humedad, chorros), vallas de todo tipo (malla, madera, muro, hierro forjado, caña, gaviones y nueve setos: laurel cerezo, tuya, Leyland…), zonas de flores cuyo número y colores elige, piscinas y estanques con sus peces.
- **Un catálogo que crece** : los árboles, con hasta cuatro aspectos al año y variedades de color (manzanos de fruto rojo, amarillo o verde, cerezo, sauce, eucalipto…), y los objetos vienen del [catálogo house-catalog](https://github.com/Elwinmage/house-catalog), abierto, actualizado en segundo plano, utilizable sin conexión y ampliable con el [editor de catálogo](https://github.com/Elwinmage/catalog-editor).
- **Nada que instalar salvo la integración** : la tarjeta la sirve la integración (ningún recurso de Lovelace), todo se edita desde la propia tarjeta (✎), pueden coexistir varias casas, sus correcciones se guardan aparte del plano (reimportarlo no pierde nada) y la interfaz habla siete idiomas (inglés, francés, español, alemán, italiano, polaco y portugués).

## Instalación

1. Instale con HACS (repositorio personalizado, tipo *Integración*), o copie `custom_components/house_view/` en `config/custom_components/`, y reinicie Home Assistant.
2. Añada la integración *House View*: dé un nombre a la vivienda y su ubicación (la de Home Assistant por defecto). Cada vivienda es una entrada propia: añada la integración otra vez para una segunda vivienda (casa de vacaciones…), con su propio plano, terreno y ediciones; la tarjeta muestra una vivienda, elegida con su opción `home`.
3. Añada la tarjeta a un panel (`type: custom:house-view-card`).
4. Abra ⚙ en la tarjeta (solo administradores) para importar su plano (Sweet Home 3D, IFC o SVG) o dibujar uno simple; después descargue el terreno (cartes.gouv.fr en Francia, datos abiertos mundiales en el resto: véase [Fuentes del terreno por país](#fuentes-del-terreno-por-país)) o cargue un terreno `.json`.

La versión de la tarjeta se muestra en la consola del navegador al cargarse (`🏠 HOUSE VIEW v0.x.y`). La limpieza por habitaciones y el icono de la integración requieren Home Assistant 2026.3 o posterior.

La tarjeta compilada no está en el repositorio: `release.yml` la construye en cada versión y publica `house_view.zip`, que HACS instala. Para desarrollar: `cd card && npm install && npm run build`.

## Configuración de la tarjeta

Las opciones se ajustan en el editor visual de la tarjeta (edite el panel y pulse *Editar* en la tarjeta), en cuatro secciones: hora y meteorología, visualización, luces, robot aspirador. El plano, el terreno y todo lo colocado en la vista se ajustan en la propia tarjeta (✎ y ⚙). En YAML:

```yaml
type: custom:house-view-card
home: 01JXYZ…                         # opcional, varias viviendas: la entrada mostrada (elegida en el editor visual); la primera por defecto
weather_entity: weather.casa          # meteorología en directo (opcional)
rain_entity: binary_sensor.lluvia     # opcional: detector de lluvia o sensor de intensidad (mm/h) de su estación
wind_speed_entity: sensor.viento_vel    # opcional: sensor de velocidad del viento (estación o servicio meteorológico de internet)
wind_bearing_entity: sensor.viento_dir  # opcional: sensor de dirección del viento (grados o puntos cardinales)
mode: live                            # live (hora real) | simulation (controles de hora / fecha / meteorología)
view: Vue générale                    # vista inicial (opcional): el nombre que muestra su botón
show_views: true                      # botones de las vistas de cámara
show_levels: true                     # botones tejado / plantas (+ 🌡 si se conocen temperaturas por habitación)
tap_action: zoom                      # pulsación en una habitación: zoom (2.ª pulsación = luces) | toggle_lights | none
show_entities: true                   # entidades colocadas en el editor
show_alarms: true                     # insignia central de alarmas (arriba a la derecha)
vacuum_entity: vacuum.robot           # opcional: por defecto, el primer vacuum.* encontrado
vacuum_poll: 15                       # segundos entre dos lecturas de posición (Roborock: acción en la nube, mín. 5)
vacuum_show_floor: false              # true = durante una limpieza, muestra la planta del robot vista desde arriba
vacuum_rate: 1                        # m²/min, para el recorrido estimado de un robot sin posición
vacuum_progress_entity: sensor.xxx    # opcional: progreso (%); detectado automáticamente en Roborock
movable_camera: true                  # cámara móvil (giro, zoom, desplazamiento); false = fija en las vistas
height: fill                          # fill (altura de la pantalla bajo el borde superior de la tarjeta) | aspect (16/10) | 600 | "70vh"
min_height: 320                       # altura mínima en modo fill (px)
fps_cap: 30                           # límite de imágenes por segundo (pantallas de pared, tabletas)
year_seconds: 10                      # 📅 : recorre las estaciones de un año entero en estos segundos (5 a 60)
toolbar_buttons: [preview]            # herramientas que quedan en la barra (preview, year, camera, sim, edit, setup); las demás están en el menú ⋮
hide_menu: false                      # true: sin menú ⋮ para los usuarios que no son administradores (pantalla de pared)
light_entities: [light.salon, ...]    # opcional: limita las luces que se tienen en cuenta
```

## Vista en directo

- **Barra** (arriba a la derecha): el distintivo de alarmas, los robots aspiradores y el menú ⋮, que agrupa las herramientas ocasionales (vista previa de estación / tiempo / hora, simular un año, bloqueo de la cámara, simulación, demo) y, para los administradores, el editor ✎ y la configuración ⚙. La opción `toolbar_buttons` deja algunas en la barra; `hide_menu` oculta el menú a los usuarios que no son administradores.
- **Latitud, longitud, zona horaria**: los de la vivienda (elegidos al añadirla; la configuración de Home Assistant por defecto). Las estaciones de la vegetación y del césped siguen el clima de la latitud: cuatro estaciones en zona templada; desde 50° hacia los polos, un invierno cada vez más largo y un verano corto (todavía invierno a finales de abril a 68°); entre los trópicos, sin invierno pero con una estación de lluvias y una estación seca (los árboles conservan sus hojas, el césped amarillea un poco en la estación seca, menos cerca del ecuador), que la vista previa de estaciones ofrece en lugar de las cuatro estaciones. Todo se invierte en el hemisferio sur.
- **Habitaciones ↔ áreas**: una habitación del plano se vincula al área de Home Assistant del mismo nombre (sin distinguir acentos ni mayúsculas). ⚙ lista las habitaciones sin área correspondiente; ✎ → *Rooms ↔ Home Assistant areas* permite elegir otra área, o ninguna, habitación por habitación.
- **Luces**: estado, color e intensidad de las `light.*` del área de cada habitación.
- **Meteorología**: la entidad `weather_entity` decide el tiempo mostrado: lluvia (`rainy`, `pouring`, `hail`), nieve (`snowy`, `snowy-rainy`), tormenta (`lightning`, `lightning-rainy`), niebla, nubes; se usan su temperatura, su viento y su nubosidad si están disponibles. Con `rain_entity` (un detector de lluvia `binary_sensor`, o un sensor de intensidad en mm/h), la lluvia sigue lo que realmente cae en su casa: llueve sobre el sensor → lluvia, más o menos densa según la intensidad medida; el servicio meteorológico anuncia lluvia pero el sensor está seco → cielo cubierto sin lluvia (tormenta: relámpagos sin lluvia). La nieve y la tormenta las sigue decidiendo el servicio meteorológico, porque un pluviómetro no las distingue; un acumulado («lluvia de hoy» en mm) se ignora, ya que no indica si llueve ahora.
- **Viento e intensidad de la lluvia**: la lluvia y la nieve caen inclinadas cuando sopla el viento, en el sentido en que sopla: cuanto más fuerte es el viento, más se inclinan (calma → vertical, 60 km/h o más → unos 50°). La dirección sigue el norte del plano: un viento del oeste empuja la lluvia hacia el lado este de su casa. La velocidad y la dirección proceden de la entidad meteorológica (`wind_speed`, `wind_bearing`), o de sus propios sensores con `wind_speed_entity` (km/h, m/s, mph, kn, ft/s, Beaufort) y `wind_bearing_entity` (grados, o puntos cardinales como `NO`): una estación meteorológica, o los sensores de un servicio meteorológico de internet. La cantidad de lluvia decide el aspecto de la lluvia: una llovizna es dispersa, lenta y corta; un aguacero, denso, rápido y largo. Procede de la intensidad de `rain_entity` (mm/h; 8 mm/h o más = aguacero) o, si no, de la entidad meteorológica (`pouring` es más fuerte que `rainy`). Un sensor no disponible deja el control a la entidad meteorológica.
- **Zoom en una habitación**: una pulsación acerca la habitación (tejado y plantas superiores ocultos); una segunda pulsación en la misma habitación conmuta sus luces; *← habitación* vuelve a la vista anterior.
- **Vista previa** (botón de meteorología): fuerza una estación (primavera, verano, otoño, invierno), un tiempo (despejado, nublado, lluvia, tormenta, nieve, niebla) o un momento (mañana, mediodía, atardecer, noche), que pueden combinarse; se vuelve al directo con el botón *Preview … ✕*, o automáticamente tras 3 minutos. En modo simulación son atajos hacia los controles.
- **Cámara**: el botón de arriba a la derecha desbloquea o bloquea la cámara sin tocar la configuración.
- **Temperaturas**: el sensor de temperatura del área (ajuste del área en Home Assistant) o, si no hay, el primer `sensor.*` con `device_class: temperature` del área; se muestran al pasar el cursor y como capa (🌡).
- **Modo simulación**: ☀ abre hora (con reproducción), fecha, tiempo predefinido, nubes, precipitación, viento (fuerza y dirección), temperatura y nieve.
- **Carreteras**: dibujadas como asfalto sobre el relieve (se pueden desactivar en ⚙).
- **Rendimiento**: el renderizado se detiene cuando la tarjeta no es visible; los volúmenes de luz solo se recalculan cuando cambia un estado útil.

## Robot aspirador

- **Limpieza por habitaciones**: si existe una entidad `vacuum.*`, su icono aparece arriba a la derecha. Una pulsación abre la selección de habitaciones (la planta del robot se muestra desde arriba): cada habitación pulsada, si está vinculada a un área, se resalta, y *Clean* llama a `vacuum.clean_area` con las áreas elegidas (acción genérica de Home Assistant 2026.3+; la correspondencia entre las habitaciones del robot y las áreas se hace una vez en los ajustes de la entidad del aspirador). También *Start*, *Pause* y *Dock*.
- **Seguimiento de la limpieza** (✎ → *Robot vacuum*): un robot 3D (color a elegir, blanco por defecto) se mueve por el plano, la habitación en curso se tiñe (color a elegir) con su porcentaje, las habitaciones pendientes se tiñen más claro, una habitación terminada destella durante un minuto y un indicador circular alrededor del icono del robot muestra el progreso total. En caso de error (`error`), la habitación y el robot parpadean en rojo con una señal ⚠.
- **Base**: *Place the dock* y pulse en el suelo; es el punto de referencia entre el mapa del robot y el plano. Su **orientación** se ajusta en grados (0° = mirando hacia la parte superior del plano, 90° hacia la derecha, valor por defecto), por cuartos de vuelta (⟲ / ⟳) o con *Aim with a tap*: pulse delante de la base, por donde sale el robot. El robot en reposo se aparca delante de la base, en el mismo sentido.
- **Posición del robot**: *Roborock* (acción oficial `roborock.get_vacuum_current_position`, base en 25500 / 25500; pasa por la nube, de ahí una lectura cada `vacuum_poll` segundos, más lenta tras un error), *atributos de una entidad* (`vacuum_position {x, y}` y `charger`, como los que ofrecen los extractores de mapas), o *ninguna*: el robot sigue entonces un recorrido estimado (idas y vueltas, habitación por habitación), señalado como «estimated position».
- **Calibración**: giro, espejo y escala; *Calibrate with a tap* calcula el giro cuando se pulsa la posición real del robot una vez fuera de la base; *remember* guarda las coordenadas de la base para otras marcas.
- **Alineación con el mapa del robot**: *Show the map of the robot over the plan* coloca la imagen que el robot dibuja del suelo (una entidad `image.*` o `camera.*` de su dispositivo) sobre el suelo de la base, semitransparente, con las plantas superiores ocultas. La base es el punto fijo: gire la imagen con el control de giro hasta que sus paredes sigan las del plano; el giro obtenido es el que se aplica al robot. Si la entidad proporciona `calibration_points` (extractores de mapas, *Roborock Custom Map*), la imagen se coloca sola. Si no (entidades de imagen de la integración oficial de Roborock), pulse donde la imagen dibuja la base (*The dock is here on the map*), desplácela en pasos de 5 cm y ajuste el tamaño de un píxel si las habitaciones son demasiado grandes o pequeñas (12,5 mm por defecto para Roborock, 50 mm en los demás casos).
- **Porcentaje de una habitación**: parte del suelo recorrida por el robot (estimación: se supone accesible el 80 % del suelo); el progreso total viene del sensor del robot cuando existe (Roborock: `cleaning_progress`).
- *Test the animation* reproduce una limpieza acelerada (con o sin error) sin poner en marcha el robot.
- **Varios robots**: cada `vacuum.*` tiene su botón en la barra de herramientas, su selección de habitaciones, su robot 3D, su trayecto y sus colores de habitación. En ✎ → *Robot vacuum*, la lista *Robot* elige el que se configura (base, posición, calibración y mapa son propios de cada robot); *Show this robot* lo quita de la vista y de la barra (un robot de otra vivienda, por ejemplo).

## Catálogo: árboles y objetos

Los árboles y los muebles no están programados en la tarjeta: proceden del [catálogo de la casa](https://github.com/Elwinmage/house-catalog), donde añadir una especie o un objeto es una pull request, no una nueva versión de esta integración.

- **Árboles**: cada especie tiene hasta cuatro representaciones, una por estación: color y densidad del follaje, floración, frutos, hojas en el suelo. La vista pasa de una estación a la siguiente día tras día (roble, pino, tejo, cerezo y albaricoquero para empezar). Son las especies que se ofrecen al plantar un árbol en el editor, dentro de las alturas que indica el catálogo.
- **Objetos**: un mueble del plano cuyo nombre contiene una palabra clave de un objeto del catálogo (`Chaise`, `Chair`, `Silla`…) se dibuja con él, en el lugar y con el tamaño del mueble, en vez de una simple caja; cuando el plano da un color al mueble, el objeto lo toma en sus partes teñibles. Del mismo modo, una planta del plano con el nombre de un árbol del catálogo (`Cerezo`, `Yew`) se dibuja como ese árbol.
- **Peces**: los peces de los estanques (la carpa koi para empezar), cada uno con sus variedades de color; la tarjeta los dibuja ella misma, vistos desde arriba.
- **Actualizaciones**: la integración descarga el catálogo de GitHub en segundo plano (la tarjeta nunca accede a la red) y funciona sin conexión con la copia que incluye. El dispositivo *House view catalog* tiene una entidad de actualización por sección (árboles, objetos), un interruptor *Actualización automática* (activado por defecto) y un botón *Actualizar ahora*.
- **Sus propias entradas**: con el [editor de catálogos](https://github.com/Elwinmage/catalog-editor), un árbol o un objeto que guarde se usa en la vista al instante, antes de proponerlo al catálogo (o sin proponerlo).

## Editor (✎)

Reservado a los administradores. El editor es un menú de secciones: una sección se abre en su propia ventana encima del menú, y un elemento de una lista (una línea de riego, una zona, una entidad del panel general, una puerta…) abre su ventana de edición encima de la sección; la flecha ← de una ventana vuelve a la de debajo. Todo se guarda en el archivo de ediciones, aparte del plano y del terreno; Escape cancela el trazado en curso.

- **Entidades colocadas** (sensores, luces, interruptores, selectores…): se colocan con una pulsación y se mueven arrastrando su etiqueta (con el editor abierto). Fijación al suelo (por defecto: la etiqueta permanece en su habitación sea cual sea el ángulo), a la pared (del lado de la habitación, oculta cuando la pared se ve por detrás) o libre en altura; una etiqueta tapada por una planta superior o por el tejado no se muestra, salvo una etiqueta *Shown over the roof*; mientras *Placed entities* está abierto en el editor, todas las etiquetas se muestran (atenuadas cuando la casa las tapa), para colocar y arrastrar una entidad en cualquier sitio, habitaciones incluidas. Distintivo (icono + valor) o solo icono; color, texto, icono (selector de iconos de Home Assistant con vista previa); visible en la vista general (siempre, o en la vista de su planta; *Shown over the roof* permite leer de lejos la temperatura de una habitación); pulsación = más información, conmutar o nada. En el editor la lista está plegada: solo se despliega la entidad elegida. Las entidades se eligen entre las de la habitación actual, agrupadas por dispositivo (toda la casa a una casilla, con búsqueda); los iconos se muestran mientras se escribe su nombre.
- **Panel general** (a la izquierda, bajo los botones de los niveles): sensores y actuadores de toda la casa (temperatura exterior, central de alarma…), en el orden elegido, con su etiqueta y su icono; una pulsación conmuta lo que se puede conmutar y abre el diálogo de los demás (o a elegir: conmutar, diálogo, nada).
- **Alarmas**: una insignia arriba a la derecha, verde con una marca cuando todo va bien, roja con una campana y el número entre paréntesis cuando hay alarmas activas; una pulsación abre su lista (pulsar una = su diálogo). Detectadas automáticamente: sensores de problema, humo, gas, monóxido de carbono, fuga de agua, calor, frío y sabotaje, y centrales de alarma disparadas (incluidas las alarmas de reeftank); se pueden añadir entidades a mano, e ignorar una alarma desde la propia lista (campana tachada) o desde el editor. Cada habitación con alarmas activas (habitación vinculada a un área de Home Assistant) muestra también una campana roja con su número; una pulsación abre la lista de esa habitación (*All* vuelve a toda la casa); estas insignias de habitación se desactivan en el editor. Opción `show_alarms`.
- **Zonas pulsables**: un reproductor multimedia sobre un mueble del plano (pulsado en el editor) o sobre un rectángulo colocado en una pared o un suelo; un acuario de reeftank sobre un rectángulo con las medidas del tanque (su frente en una pared, su parte superior en un suelo). Una pulsación abre el reproductor, o la vista del acuario de ha-reef-card en una ventana; el rectángulo de un acuario muestra esa vista en directo, con los peces moviéndose (opción por zona), en la vista del acuario elegida para la zona (si no, su vista por defecto). Al colocarla, la pared o el suelo bajo el puntero se ilumina y el rectángulo se dibuja en él; una zona se mueve arrastrándola sobre su superficie. Se ajustan el ancho, el alto, la altura del centro (pared) o el giro (suelo).
- **Luces colocadas**: una `light.*` colocada se convierte en una fuente de luz en ese punto de la habitación (foco, lámpara colgante, lámpara, regleta o invisible; altura y alcance ajustables; en la pared: un aplique a la altura pulsada), gobernada por su propio estado y color. Las demás luces del área siguen iluminando toda la habitación.
- **Entidades de una habitación**: con zoom en una habitación solo se muestran las entidades de esa habitación; las de la vista general desaparecen (el robot aspirador sigue moviéndose si está allí). En el editor, una pulsación en una habitación hace zoom en ella y la edición pasa a ser la de la habitación (banda roja arriba): las entidades añadidas entonces se colocan en su suelo, en una pared o en el aire, y solo pertenecen a esa habitación. Desaparecen al elegir otra habitación o al volver a la vista general. Una entidad de la vista general colocada en una habitación pasa a esa habitación con su ajuste *Its room only*.
- **Puertas y ventanas** (*Doors and windows*): las aberturas del plano de Sweet Home 3D, por planta y habitación, o elegidas con una pulsación en la vista (la abertura bajo el puntero se ilumina). Cada una puede vincularse a un sensor abierto / cerrado (`binary_sensor`), a un abridor motorizado (`cover` de la ventana) y, en ventanas y puertas correderas, a una persiana enrollable (`cover`). Una habitación con una sola ventana se vincula sola al sensor de ventana, al abridor y a la persiana de su área cuando hay uno de cada; una habitación con una sola puerta, a su sensor de puerta; un vínculo elegido a mano tiene prioridad, y un vínculo automático puede quitarse. En la vista las hojas (una, dos a partir de 1,10 m) se abren hacia dentro, una corredera se desliza, una puerta gira (una puerta interior recibe su hoja una vez vinculada) y la persiana baja por la cara exterior hasta la posición del `cover` (`current_position`, con suavidad).
- **Piscinas y estanques** (*Pools and ponds*): se dibujan vistos desde arriba, como rectángulo (dos esquinas opuestas) o forma libre (punto a punto, *Finish*), con un nombre, un color de agua y una profundidad (0,2 a 6 m). El terreno se excava: una piscina tiene paredes verticales, fondo plano y coronación, un estanque un fondo en pendiente y una orilla de guijarros; el suelo alrededor se nivela y el agua se mueve. Un robot limpiafondos puede vincularse a una entidad (`binary_sensor`, `switch`, `input_boolean` o `vacuum`): recorre el fondo mientras está activa y, si no, queda aparcado. La piscina del plano de Sweet Home 3D se queda como está. Un estanque puede tener **islas** (dibujadas como el contorno: el suelo queda un poco por encima del agua, con una orilla de guijarros; en ellas se plantan árboles y se colocan entidades) y **peces** del catálogo de la casa: grupos de un pez (la carpa koi para empezar), de una variedad (kohaku rojo y blanco, benigoi rojo, yamabuki ogon amarillo, showa…) o de colores propios (cuerpo, manchas, motivo, escamas brillantes), con un número y un tamaño: 3 rojas, 1 roja y blanca y 2 amarillas son tres grupos. Cada pez tiene su propio dibujo, nada por el agua alrededor de las islas, toma el color del agua cuanto más hondo está y se queda en el fondo cuando el agua está fría.
- **Vista por habitación**: con zoom en una habitación y el editor abierto, *📷 Room view* guarda la cámara y las plantas visibles; una pulsación en esa habitación abre después esa vista en lugar del zoom automático. *Automatic view* vuelve a él.
- **Vallas** (*Fences*): cada lado tiene su tipo (malla, madera, muro, seto, o abierto para un portón) y su altura. Dos formas de crear una: *Fence from the cadastre* (las parcelas de la casa están preseleccionadas, pulse para añadir o quitar las parcelas vecinas de la misma propiedad; se valla el contorno del conjunto) o *Draw a fence* (pulsaciones sucesivas, se recomienda la vista cenital «Dessus»; cada lado toma el tipo elegido en la paleta, un color por tipo). *Edit the sides*: cambiar el tipo de un lado con una pulsación, cortar un lado en dos (una parte en muro, la otra en malla), eliminar un punto.
- **Riego** (*Watering*):
  - **Goteo** (*Drip lines*): una línea por válvula (`switch`, `valve`, `input_boolean`), trazada punto a punto y redondeada al dibujarse; tubo negro, marrón, verde u oculto. Con la válvula abierta, la línea se vuelve azul, la recorren reflejos, una gota crece y se encoge en bucle bajo cada gotero (separados 30 cm por defecto, con un ligero desfase de un gotero a otro: la línea centellea) y una mancha húmeda crece hasta formar una franja. La anchura de la mancha sigue el modelo de Schwartzman y Zur (1986), según el caudal del gotero, el tiempo de apertura y el tipo de suelo; se borra en 30 minutos tras el cierre.
  - **Aspersores** (*Sprinklers*): un circuito por válvula, con uno o varios aspersores (modelo del catálogo: Hunter Pro-Spray PSU-04 8A a 17A, SRM-04, PGJ-04, PGP Ultra, MP Rotator, o genérico; distancias mínima / máxima, orientación y ángulo precargados y modificables; *Aim* con una pulsación). Con la válvula abierta se muestra el sector regado estimado y el chorro se anima (barrido para una turbina, abanico para una tobera).
  - *Test the animation* reproduce 30 segundos de riego acelerado (30 s = 1 h 30) en todas las líneas y circuitos, sin abrir ninguna válvula: la mancha húmeda crece, los chorros giran y luego todo vuelve al estado real. El botón *Test* de una línea o de un circuito hace lo mismo solo para él; cerrar el editor detiene la prueba.
- **Otras herramientas**: objetos exteriores (ocultar, altura, desplazamiento, giro), nivel de la piscina, árboles (quitar, añadir con especie y altura, deshacer, restaurar todo), correcciones del suelo (murete, terraza, pinceles, corte, lista de correcciones modificables), vistas.

## Configuración (⚙)

- **Demo** (para grabar o presentar la vista sin mostrar su casa ni su ubicación): *Load the demo* añade una vivienda «Démo» con una casa ficticia de dos plantas (el archivo de Sweet Home 3D `custom_components/house_view/demo/demo-maison.sh3d` puede abrirse y retocarse), un terreno en tres terrazas con un huerto de frutales, una piscina, un estanque, una valla, riego, un robot aspirador y persianas, en un lugar ficticio (45° N). Sus viviendas no se tocan. Sus entidades las simula la tarjeta (no se crea nada en Home Assistant y no aparece nada de su casa): un escenario del día, a 1 h cada 2 s, abre y cierra las persianas, enciende las luces, riega al amanecer, lanza el aspirador por la mañana y el robot de piscina por la tarde, provoca una fuga de agua antes de la cena… El botón 🎬 de la barra lo pausa, ajusta la hora y lanza un evento a mano (persianas, luces, aspirador, riego, robots, fuga, humo); una pulsación en una entidad simulada la conmuta. *Reset the demo* la deja como se entrega, *Leave the demo* vuelve a su vivienda; la vivienda de demostración se elimina como cualquier otra entrada. Sus acuarios reales (reeftank) pueden colocarse en ella. Los archivos se generan con `npm run demo` en `card/`. La vivienda de demostración empieza vacía y plana, para grabarla desde el principio: importe `demo-maison.sh3d` (*Download demo-maison.sh3d* en ⚙) con *Import a .sh3d* y luego obtenga el terreno: la descarga pasa por sus etapas y trae el terreno de la demo, sin ningún acceso a la red.
- **Plano**: *Import a plan* lee en el navegador un archivo de Sweet Home 3D (`.sh3d`), un archivo IFC (`.ifc`, BIM: ArchiCAD, Revit, FreeCAD, BlenderBIM: plantas, espacios, muros, puertas y ventanas) o un plano SVG (`.svg`, como los dibujados para ha-floorplan o con Inkscape: cada forma con nombre es una habitación, cada capa de Inkscape un nivel; *Scale: SVG units per meter* corrige el tamaño) y lista lo encontrado. Sin archivo: *Create a simple plan* abre un editor de habitaciones rectangulares, nivel por nivel (arrastrar una habitación para moverla, sus tiradores para cambiar su tamaño, los bordes se pegan a las habitaciones vecinas; nombre y área de Home Assistant, puertas, ventanas y ventanales pulsados sobre una pared con su ancho, alto y antepecho; altura por nivel, un nivel nuevo copia el contorno del de abajo; tejado automático, a dos aguas o plano), con la vista 3D actualizándose detrás. *Plan from the robot's map* parte de las habitaciones del mapa de un robot aspirador (extractores de mapa que dan `rooms`). Un SVG de rectángulos y las habitaciones del robot se abren en el plano simple, para añadir puertas y ventanas. Cada habitación recibe una luz de techo encendida por las luces de su área. Los muebles de un plano de Sweet Home 3D se dibujan con sus propios modelos 3D (modelos OBJ del archivo, aligerados: unos miles de triángulos como mucho, un color por material, el color medio de una textura), a su tamaño, girados y en espejo como en el plano; *Furniture drawn with the 3D models of the plan* vuelve a las formas simples.
- **Descarga del terreno** (*Terrain (DTM)*): la propia integración descarga el relieve y su entorno, alrededor de las coordenadas de Home Assistant (modificables). La fuente depende del país de la configuración de Home Assistant (*Automatic*), o se impone en el formulario:
  - **France: cartes.gouv.fr (IGN)**: suelo LiDAR HD a 0,5 m (RGE ALTI a 1 m en su defecto), modelo de superficie (ajuste automático, árboles), edificios, carreteras y catastro (BD TOPO, parcelario), fotografía aérea o mapa del IGN proyectado sobre el suelo. Si el IGN no tiene datos en ese lugar, las fuentes mundiales toman el relevo;
  - **World: Mapterhorn + OpenStreetMap**: relieve de las teselas de [Mapterhorn](https://mapterhorn.com) (LiDAR abiertos de muchos países, 30 m en el resto; en su defecto, las Terrain Tiles de Mapzen alojadas por AWS, menos detalladas), edificios y carreteras de OpenStreetMap. Sin modelo de superficie, catastro ni fotografía aérea: los árboles se colocan con el editor y la valla se traza a mano.

  En ambos casos: ajuste opcional sobre el edificio más cercano (la ubicación de Home Assistant suele ser aproximada), ajuste automático del plano al final y fuente mostrada bajo el formulario.
- **Copia en GitHub**: opciones de la integración, menú *Copia en GitHub* (repositorio privado `propietario/nombre`, token fine-grained con *Contents: read and write*, rama, carpeta); botones *Back up to GitHub* / *Restore from GitHub* en ⚙. Solo se confirman los archivos modificados; se rechaza un repositorio público (contiene el plano de su casa).
- **Protección de la edición**: solo los administradores de Home Assistant pueden modificar la vista. Para evitar además cambios hechos por error (una pantalla compartida que se quedó conectada con una cuenta de administrador), se puede pedir una contraseña antes de abrir el editor ✎ y la configuración ⚙:
  - se ajusta en las opciones de la integración (Ajustes → Dispositivos y servicios → House View → Configurar → *Protección de la edición*): 4 caracteres o más, campo vacío para conservar la actual, casilla para quitar la protección. Se guarda como hash con sal, nunca en claro;
  - la tarjeta la pide al abrir ✎ o ⚙ (el lápiz lleva entonces un candado), y de nuevo tras 10 minutos sin cambios, tras recargar la página o reiniciar Home Assistant. El botón 🔒 de la cabecera del panel vuelve a bloquear de inmediato;
  - la comprobación la hace la integración: sin contraseña válida se rechaza toda escritura (código HTTP 423), incluso fuera de la tarjeta. Tras 5 contraseñas incorrectas hay que esperar 1 minuto;
  - contraseña olvidada: cámbiela o quítela en las opciones de la integración;
  - ver la vista, hacer zoom, manejar las luces o el aspirador y la vista previa de estación / tiempo siguen siendo libres.

## Fuentes del terreno por país

Francia utiliza los servicios del IGN. En el resto del mundo el relieve procede de [Mapterhorn](https://mapterhorn.com), que coloca los LiDAR nacionales abiertos sobre un modelo mundial de 30 m, y los edificios y carreteras proceden de [OpenStreetMap](https://www.openstreetmap.org). La resolución indicada es la anunciada por Mapterhorn en noviembre de 2026; mejora con cada versión del proyecto (mapa de cobertura actualizado en mapterhorn.com).

| | País | Relieve | Edificios, carreteras | Catastro, fotografía aérea | Probado |
|---|---|---|---|---|---|
| 🇫🇷 | Francia | IGN LiDAR HD 0,5 m (RGE ALTI 1 m en su defecto) | IGN BD TOPO | IGN (parcelario, fotografía aérea o mapa) | ✅ |
| 🇩🇪 | Alemania | Mapterhorn: 0,25 m (Baden-Wurtemberg), 1 m (la mayoría de los estados) | OpenStreetMap | — | ❌ |
| 🇦🇹 | Austria | Mapterhorn: 1 m | OpenStreetMap | — | ❌ |
| 🇧🇪 | Bélgica | Mapterhorn: 0,5 m (Valonia) | OpenStreetMap | — | ❌ |
| 🇩🇰 | Dinamarca | Mapterhorn: 0,4 m | OpenStreetMap | — | ❌ |
| 🇸🇰 | Eslovaquia | Mapterhorn: 1 m | OpenStreetMap | — | ❌ |
| 🇸🇮 | Eslovenia | Mapterhorn: 0,5 m | OpenStreetMap | — | ❌ |
| 🇪🇸 | España | Mapterhorn: 0,5 m (cobertura parcial) | OpenStreetMap | — | ❌ |
| 🇪🇪 | Estonia | Mapterhorn: 1 m | OpenStreetMap | — | ❌ |
| 🇮🇹 | Italia | Mapterhorn: LiDAR en Sicilia y en parte de Cerdeña | OpenStreetMap | — | ❌ |
| 🇱🇺 | Luxemburgo | Mapterhorn: 0,5 m | OpenStreetMap | — | ❌ |
| 🇳🇴 | Noruega | Mapterhorn: 1 m | OpenStreetMap | — | ❌ |
| 🇳🇱 | Países Bajos | Mapterhorn: LiDAR nacional | OpenStreetMap | — | ❌ |
| 🇵🇱 | Polonia | Mapterhorn: LiDAR nacional | OpenStreetMap | — | ❌ |
| 🇵🇹 | Portugal | Mapterhorn: 0,5 m (cobertura parcial) | OpenStreetMap | — | ❌ |
| 🇬🇧 | Reino Unido | Mapterhorn: 1 m (Inglaterra, Escocia, Gales) | OpenStreetMap | — | ❌ |
| 🇷🇴 | Rumanía | Mapterhorn: 0,5 m (cobertura parcial) | OpenStreetMap | — | ❌ |
| 🇸🇪 | Suecia | Mapterhorn: 1 m | OpenStreetMap | — | ❌ |
| 🇨🇭 | Suiza | Mapterhorn: 0,25 m (cantón de Zúrich), 0,5 m (cobertura parcial) | OpenStreetMap | — | ❌ |
| 🌍 | Resto del mundo | Mapterhorn: 30 m (Copernicus GLO-30); en su defecto, Terrain Tiles (Mapzen / AWS) | OpenStreetMap | — | ❌ |

> **No probado fuera de Francia.** Las fuentes mundiales se han escrito a partir de su documentación y se han comprobado con datos simulados, sin poder probarlas en condiciones reales. Si la descarga falla o da un relieve incoherente en su casa, por favor [abra una incidencia](https://github.com/elwinmage/ha-house-view-component/issues) indicando el país, la fuente elegida y el mensaje mostrado bajo el formulario. Una buena noticia también es bienvenida: permitirá marcar el país como probado.

Con un modelo de 30 m el terreno es solo un plano inclinado: las correcciones del suelo del editor (✎) permiten redibujar terrazas y taludes. El catastro y la fotografía aérea solo existen país por país; podrán añadirse a petición, una incidencia por país.

## API HTTP (usada por la tarjeta)

| Ruta | GET | POST | DELETE |
|---|---|---|---|
| `/api/house_view/homes` | viviendas configuradas: `[{id, title}]` | | |
| `/api/house_view/demo` | plano de la casa de demostración (admin) | crea la vivienda de demostración o la deja como se entrega → `{home}` (admin) | |
| `/api/house_view/info` | estado, nombre y ubicación de la vivienda | | |
| `/api/house_view/scene` | plano | sustituye (admin) | |
| `/api/house_view/terrain` | malla de alturas | sustituye (admin) | elimina (admin) |
| `/api/house_view/edits` | correcciones | sustituye (admin) | elimina (admin) |
| `/api/house_view/ortho` | foto / mapa del suelo | sustituye (admin) | elimina (admin) |
| `/api/house_view/fetch` | estado de la descarga | inicia la descarga del terreno, `provider`: `auto` \| `ign` \| `world` (admin) | |
| `/api/house_view/github` | | `{"action": "backup" \| "restore"}` (admin) | |
| `/api/house_view/unlock` | `{locked, unlocked}` | `{"password"}` → token (admin) | vuelve a bloquear |

Con varias viviendas, cada ruta acepta `?home=<id de la entrada>` (sin él, la primera vivienda).

Cuando hay una contraseña de edición, las escrituras (POST / DELETE anteriores) exigen además la cabecera `X-House-View-Unlock` con el token devuelto por `/unlock`; de lo contrario responden 423.

Cada documento se valida (`validate.py`) y se guarda en `.storage/house_view.<clave>` (vivienda creada antes de la versión 0.2) o en `.storage/house_view.<id de la vivienda>.<clave>`; cada escritura lanza el evento `house_view_updated` (`key`, `updated`, `home`). Eliminar una vivienda elimina sus documentos. Los documentos son voluminosos (un terreno ocupa varios MB): viajan por HTTP (límite de Home Assistant de 16 MB por petición), no por el websocket.

## Desarrollo y pruebas

```bash
pip install pre-commit
# (opcional) cd card && npm install para lanzar la compilación y las pruebas a mano
pre-commit install            # ruff, prettier, vitest, traducciones, pytest (100 % de cobertura); pre-commit gestiona las dependencias de los hooks
pre-commit run --all-files
```

- **Integración**: `pytest` (servidor HTTP real de Home Assistant mediante `pytest-homeassistant-custom-component`, se exige el 100 % de cobertura).
- **Tarjeta**: `cd card && npm test` (vitest); `npm run build` escribe `custom_components/house_view/frontend/house-view-card.js`; `npm run format` (prettier).
- **Traducciones**: `scripts/check_translations.py` comprueba que cada idioma de la integración (en, fr, it, de, es, pl, pt) y de la tarjeta (`card/src/i18n.js`) tiene exactamente las claves del inglés. Este README existe en los mismos siete idiomas (`doc/<idioma>/README.<idioma>.md`).
- **Página de prueba sin Home Assistant**: `python3 card/test/harness/server.py` (servidor falso de la API) y después http://localhost:8765/card/test/harness/index.html
- **Imágenes de marca**: `custom_components/house_view/brand/` (icono y logotipo, claro y oscuro), servidas por Home Assistant 2026.3+ sin pasar por el repositorio `home-assistant/brands`. Fuentes vectoriales en `assets/brand/`; `scripts/build_brand.sh` regenera los PNG (`rsvg-convert`, ImageMagick, fuente Inter).
- **CI** (`.github/workflows/`): `validate.yml` (hassfest + HACS), `tests.yml` (pre-commit, pytest, vitest + compilación), `release.yml` (se lanza a mano con la versión: actualiza `manifest.json` y `card/package.json`, compila la tarjeta, etiqueta y publica la versión con `house_view.zip`).
- **Cliente del catálogo**: `catalog_pack.py` y `catalog_runtime.py` son copias de `reeftech-catalog/client/` (el cliente solo conoce sus propias secciones: `catalog.py` le declara las de la casa); `house_catalog_sections.py` y `catalog_builtin*/` son copias de la descripción y de las entradas de `house-catalog`. Todos los escribe el `scripts/sync_client.py` de esos repositorios: se modifican allí, nunca aquí.

`card/src/engine.js` es el motor 3D (una instancia por tarjeta, sin dependencia de Home Assistant); `card/src/ha-bridge.js` convierte el estado de Home Assistant en datos para el motor; `card/src/engine/` contiene los módulos del prototipo (geometría, vegetación, terreno, luces…).

## Hoja de ruta

1. ✅ Fase 1: integración + tarjeta, importación del plano, terreno, ajuste, luces y meteorología en directo.
2. ✅ Editores en la tarjeta: objetos exteriores, árboles, correcciones del suelo, vistas personalizadas.
3. ✅ Descarga del terreno por la integración para Francia (IGN), carreteras, foto del suelo, vallas, entidades colocadas, robot aspirador, zoom en una habitación, vista previa de estación / tiempo, copia en GitHub.
4. ✅ Otros países: relieve de Mapterhorn, edificios y carreteras de OpenStreetMap (por confirmar país por país). Después: catastro y fotografía aérea de los países que los publican como datos abiertos.
5. ✅ Catálogo (árboles de cuatro estaciones, objetos) leído de `house-catalog` y editado con `catalog_editor`. Después: más especies y objetos, modelos de aspersores.
6. ✅ Varias viviendas, varios robots aspiradores, entidades de una habitación con zoom, puertas / ventanas / persianas vinculadas a Home Assistant, piscinas y estanques excavados en el terreno, editor en ventanas.

## Licencia

Código bajo licencia [MIT](../../LICENSE) © Elwinmage. El icono y el logotipo (`assets/brand/`) son creaciones originales del proyecto, bajo la misma licencia.

- **Bibliotecas incluidas en la tarjeta compilada**: [three.js](https://threejs.org) (MIT), [Lit](https://lit.dev) (BSD-3-Clause) y [fflate](https://github.com/101arrowz/fflate) (MIT); sus avisos de licencia se conservan al final del archivo compilado.
- **Datos**: el repositorio no contiene ningún dato cartográfico; cada usuario descarga los de su propio terreno, y la fuente se recuerda en ⚙ → *Terrain (DTM)*. Si publica una captura, cite esa fuente:
  - Francia: servicios del IGN (cartes.gouv.fr), bajo la [Licence Ouverte Etalab 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/);
  - relieve fuera de Francia: [Mapterhorn](https://mapterhorn.com/attribution) y los conjuntos de datos abiertos que reúne, o las [Terrain Tiles](https://registry.opendata.aws/terrain-tiles) de Mapzen;
  - edificios y carreteras fuera de Francia: © colaboradores de [OpenStreetMap](https://www.openstreetmap.org/copyright), bajo licencia ODbL.
- Los nombres de marcas (Hunter, Roborock, Sweet Home 3D…) pertenecen a sus propietarios y solo se citan para describir la compatibilidad.
