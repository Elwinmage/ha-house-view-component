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

**Idiomas disponíveis:**
[<img src="https://flagicons.lipis.dev/flags/4x3/fr.svg" style="width: 5%;"/>](../fr/README.fr.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/gb.svg" style="width: 5%;"/>](../../README.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/es.svg" style="width: 5%;"/>](../es/README.es.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/de.svg" style="width: 5%;"/>](../de/README.de.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/pl.svg" style="width: 5%;"/>](../pl/README.pl.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/pt.svg" style="width: 5%;"/>](README.pt.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/it.svg" style="width: 5%;"/>](../it/README.it.md)

📘 **Guia completo** (instalação, configuração, utilização, com imagens): [GUIDE.pt.md](GUIDE.pt.md)

Vista pseudo-3D em direto da sua casa para o Home Assistant: a sua planta do **Sweet Home 3D** assente num modelo digital do terreno, com luzes, meteorologia, sol e estações em tempo real, e ainda um robô aspirador, a rega do jardim e as vedações. Um único repositório contém:

- `custom_components/house_view/`: a **integração** (guarda a planta, o terreno e as suas correções; obtém o terreno; API HTTP);
- `card/`: o **cartão Lovelace** `house-view-card` (three.js), compilado em `custom_components/house_view/frontend/`. A própria integração serve-o (`/house_view/house-view-card.js`) e carrega-o em todos os painéis: **não é preciso declarar nenhum recurso Lovelace**.

A interface do cartão existe em inglês e em francês: em português é apresentada em inglês, por isso os nomes dos botões e das secções são aqui citados em inglês. As opções da integração existem em inglês, francês, italiano, alemão, espanhol, polaco e português. As traduções são bem-vindas: os textos estão em `custom_components/house_view/translations/` e `card/src/i18n.js`.

## Instalação

1. Instale com o HACS (repositório personalizado, tipo *Integração*), ou copie `custom_components/house_view/` para `config/custom_components/`, e reinicie o Home Assistant.
2. Adicione a integração *House View*: dê um nome à habitação e a sua localização (a do Home Assistant por omissão). Cada habitação é uma entrada própria: adicione a integração outra vez para uma segunda habitação (casa de férias…), com a sua planta, terreno e edições; o cartão mostra uma habitação, escolhida com a sua opção `home`.
3. Adicione o cartão a um painel (`type: custom:house-view-card`).
4. Abra ⚙ no cartão (apenas administradores) para importar a sua planta (Sweet Home 3D, IFC ou SVG) ou desenhar uma simples; depois obtenha o terreno (cartes.gouv.fr em França, dados abertos mundiais no resto: veja [Fontes do terreno por país](#fontes-do-terreno-por-país)) ou carregue um terreno `.json`.

A versão do cartão aparece na consola do navegador ao carregar (`🏠 HOUSE VIEW v0.x.y`). A limpeza por divisões e o ícone da integração requerem o Home Assistant 2026.3 ou posterior.

O cartão compilado não está no repositório: o `release.yml` constrói-o em cada versão e publica `house_view.zip`, que o HACS instala. Para desenvolvimento: `cd card && npm install && npm run build`.

## Configuração do cartão

As opções definem-se no editor visual do cartão (edite o painel e escolha *Editar* no cartão), em quatro secções: hora e meteorologia, apresentação, luzes, robô aspirador. A planta, o terreno e tudo o que é colocado na vista definem-se no próprio cartão (✎ e ⚙). Em YAML:

```yaml
type: custom:house-view-card
home: 01JXYZ…                         # opcional, várias habitações: a entrada mostrada (escolhida no editor visual); a primeira por omissão
weather_entity: weather.casa          # meteorologia em direto (opcional)
rain_entity: binary_sensor.chuva      # opcional: detetor de chuva ou sensor de intensidade (mm/h) da sua estação
wind_speed_entity: sensor.vento_vel     # opcional: sensor de velocidade do vento (estação ou serviço meteorológico da internet)
wind_bearing_entity: sensor.vento_dir   # opcional: sensor de direção do vento (graus ou pontos cardeais)
mode: live                            # live (hora real) | simulation (controlos de hora / data / meteorologia)
view: Vue générale                    # vista inicial (opcional): o nome mostrado no respetivo botão
show_views: true                      # botões das vistas de câmara
show_levels: true                     # botões telhado / pisos (+ 🌡 quando há temperaturas por divisão)
tap_action: zoom                      # toque numa divisão: zoom (2.º toque = luzes) | toggle_lights | none
show_entities: true                   # entidades colocadas no editor
show_alarms: true                     # emblema central de alarmes (canto superior direito)
vacuum_entity: vacuum.robot           # opcional: por omissão, o primeiro vacuum.* encontrado
vacuum_poll: 15                       # segundos entre duas leituras de posição (Roborock: ação na nuvem, mín. 5)
vacuum_show_floor: false              # true = durante uma limpeza, mostra o piso do robô visto de cima
vacuum_rate: 1                        # m²/min, para o percurso estimado de um robô sem posição
vacuum_progress_entity: sensor.xxx    # opcional: progresso (%); detetado automaticamente para Roborock
movable_camera: true                  # câmara móvel (rotação, zoom, deslocação); false = fixa nas vistas
height: fill                          # fill (altura do ecrã abaixo do topo do cartão) | aspect (16/10) | 600 | "70vh"
min_height: 320                       # altura mínima no modo fill (px)
fps_cap: 30                           # limite de imagens por segundo (ecrãs de parede, tablets)
year_seconds: 10                      # 📅 : percorre as estações de um ano inteiro neste número de segundos (5 a 60)
toolbar_buttons: [preview]            # ferramentas que ficam na barra (preview, year, camera, sim, edit, setup); as outras estão no menu ⋮
hide_menu: false                      # true: sem menu ⋮ para os utilizadores que não são administradores (ecrã de parede)
light_entities: [light.sala, ...]     # opcional: restringe as luzes consideradas
```

## Vista em direto

- **Barra** (canto superior direito): o distintivo de alarmes, os robôs aspiradores e o menu ⋮, que agrupa as ferramentas ocasionais (pré-visualização de estação / tempo / hora, simular um ano, bloqueio da câmara, simulação, demo) e, para os administradores, o editor ✎ e a configuração ⚙. A opção `toolbar_buttons` mantém algumas na barra; `hide_menu` esconde o menu aos utilizadores que não são administradores.
- **Latitude, longitude, fuso horário**: os da habitação (escolhidos ao adicioná-la; a configuração do Home Assistant por omissão). As estações da vegetação e da relva seguem o clima da latitude: quatro estações em zona temperada; a partir de 50° em direção aos polos, um inverno cada vez mais longo e um verão curto (ainda inverno no fim de abril a 68°); entre os trópicos, sem inverno mas com uma estação das chuvas e uma estação seca (as árvores mantêm as folhas, a relva amarelece um pouco na estação seca, menos perto do equador), que a pré-visualização propõe em vez das quatro estações. Tudo se inverte no hemisfério sul.
- **Divisões ↔ áreas**: uma divisão da planta fica ligada à área do Home Assistant com o mesmo nome (sem distinguir acentos nem maiúsculas). ⚙ lista as divisões sem área correspondente; ✎ → *Rooms ↔ Home Assistant areas* permite escolher outra área, ou nenhuma, divisão a divisão.
- **Luzes**: estado, cor e intensidade das entidades `light.*` da área de cada divisão.
- **Meteorologia**: a entidade `weather_entity` decide o tempo apresentado: chuva (`rainy`, `pouring`, `hail`), neve (`snowy`, `snowy-rainy`), trovoada (`lightning`, `lightning-rainy`), nevoeiro, nuvens; a sua temperatura, o seu vento e a sua nebulosidade são usados quando disponíveis. Com `rain_entity` (um detetor de chuva `binary_sensor`, ou um sensor de intensidade em mm/h), a chuva segue o que realmente cai em sua casa: chove no sensor → chuva, mais ou menos densa consoante a intensidade medida; o serviço meteorológico anuncia chuva mas o sensor está seco → céu encoberto sem chuva (trovoada: relâmpagos sem chuva). A neve e a trovoada continuam a ser decididas pelo serviço meteorológico, porque um pluviómetro não as distingue; um acumulado («chuva de hoje» em mm) é ignorado, pois não diz se está a chover agora.
- **Vento e intensidade da chuva**: a chuva e a neve caem inclinadas quando há vento, no sentido em que ele sopra: quanto mais forte o vento, mais se inclinam (calma → vertical, 60 km/h ou mais → cerca de 50°). A direção segue o norte da planta: um vento de oeste empurra a chuva para o lado leste da sua casa. A velocidade e a direção vêm da entidade meteorológica (`wind_speed`, `wind_bearing`), ou dos seus próprios sensores com `wind_speed_entity` (km/h, m/s, mph, kn, ft/s, Beaufort) e `wind_bearing_entity` (graus, ou pontos cardeais como `NO`): uma estação meteorológica, ou os sensores de um serviço meteorológico da internet. A quantidade de chuva define o aspeto da chuva: um chuvisco é disperso, lento e curto; um aguaceiro, denso, rápido e longo. Vem da intensidade de `rain_entity` (mm/h; 8 mm/h ou mais = aguaceiro) ou, na sua falta, da entidade meteorológica (`pouring` é mais forte do que `rainy`). Um sensor indisponível deixa o controlo à entidade meteorológica.
- **Zoom numa divisão**: um toque aproxima a divisão (telhado e pisos superiores ocultos); um segundo toque na mesma divisão alterna as suas luzes; *← divisão* regressa à vista anterior.
- **Pré-visualização** (botão de meteorologia): força uma estação (primavera, verão, outono, inverno), um tempo (limpo, nublado, chuva, trovoada, neve, nevoeiro) ou um momento (manhã, meio-dia, crepúsculo, noite), que podem ser combinados; regressa-se ao direto com o botão *Preview … ✕*, ou automaticamente ao fim de 3 minutos. No modo de simulação são atalhos para os controlos.
- **Câmara**: o botão no canto superior direito desbloqueia ou bloqueia a câmara sem tocar na configuração.
- **Temperaturas**: o sensor de temperatura da área (definição da área no Home Assistant) ou, na sua falta, o primeiro `sensor.*` com `device_class: temperature` da área; mostradas ao passar o cursor e como camada (🌡).
- **Modo de simulação**: ☀ abre hora (com reprodução), data, tempo predefinido, nuvens, precipitação, vento (força e direção), temperatura e neve.
- **Estradas**: desenhadas como asfalto sobre o relevo (podem ser desativadas em ⚙).
- **Desempenho**: a renderização para quando o cartão não está visível; os volumes de luz só são recalculados quando muda um estado útil.

## Robô aspirador

- **Limpeza por divisões**: se existir uma entidade `vacuum.*`, o seu ícone aparece no canto superior direito. Um toque abre a seleção de divisões (o piso do robô é mostrado visto de cima): cada divisão tocada, se estiver ligada a uma área, fica destacada, e *Clean* chama `vacuum.clean_area` com as áreas escolhidas (ação genérica do Home Assistant 2026.3+; a correspondência entre as divisões do robô e as áreas faz-se uma vez nas definições da entidade do aspirador). Também *Start*, *Pause* e *Dock*.
- **Acompanhamento da limpeza** (✎ → *Robot vacuum*): um robô 3D (cor à escolha, branco por omissão) desloca-se na planta, a divisão em curso fica colorida (cor à escolha) com a sua percentagem, as divisões seguintes ficam coloridas num tom mais claro, uma divisão terminada cintila durante um minuto, e um indicador circular à volta do ícone do robô dá o progresso total. Em caso de erro (`error`), a divisão e o robô piscam a vermelho com um sinal ⚠.
- **Base**: *Place the dock* e depois um toque no chão; é o ponto de referência entre o mapa do robô e a planta. A sua **orientação** define-se em graus (0° = virada para o topo da planta, 90° para a direita, o valor por omissão), por quartos de volta (⟲ / ⟳) ou com *Aim with a tap*: toque à frente da base, por onde o robô sai. O robô em repouso estaciona à frente da base, no mesmo sentido.
- **Posição do robô**: *Roborock* (ação oficial `roborock.get_vacuum_current_position`, base em 25500 / 25500; passa pela nuvem, daí uma leitura a cada `vacuum_poll` segundos, mais lenta após um erro), *atributos de uma entidade* (`vacuum_position {x, y}` e `charger`, como os fornecidos pelos extratores de mapas), ou *nenhuma*: o robô segue então um percurso estimado (idas e voltas, divisão a divisão), assinalado como «estimated position».
- **Calibração**: rotação, espelho e escala; *Calibrate with a tap* calcula a rotação quando se toca na posição real do robô já fora da base; *remember* guarda as coordenadas da base para outras marcas.
- **Alinhamento com o mapa do robô**: *Show the map of the robot over the plan* coloca a imagem que o robô desenha do chão (uma entidade `image.*` ou `camera.*` do seu dispositivo) sobre o chão da base, semitransparente, com os pisos superiores ocultos. A base é o ponto fixo: rode a imagem com o cursor de rotação até as suas paredes seguirem as da planta; a rotação encontrada é a aplicada ao robô. Se a entidade fornecer `calibration_points` (extratores de mapas, *Roborock Custom Map*), a imagem posiciona-se sozinha. Caso contrário (entidades de imagem da integração oficial Roborock), toque onde a imagem desenha a base (*The dock is here on the map*), desloque-a em passos de 5 cm e ajuste o tamanho de um píxel se as divisões forem demasiado grandes ou pequenas (12,5 mm por omissão para Roborock, 50 mm nos restantes casos).
- **Percentagem de uma divisão**: parte do chão percorrida pelo robô (estimativa: assume-se que 80 % do chão é acessível); o progresso total vem do sensor do robô quando existe (Roborock: `cleaning_progress`).
- *Test the animation* reproduz uma limpeza acelerada (com ou sem erro) sem pôr o robô a trabalhar.
- **Vários robôs**: cada `vacuum.*` tem o seu botão na barra de ferramentas, a sua seleção de divisões, o seu robô 3D, o seu trajeto e as suas cores de divisão. Em ✎ → *Robot vacuum*, a lista *Robot* escolhe o que se configura (base, posição, calibração e mapa são próprios de cada robô); *Show this robot* retira-o da vista e da barra (um robô de outra habitação, por exemplo).

## Catálogo: árvores e objetos

As árvores e os móveis não estão programados no cartão: vêm do [catálogo da casa](https://github.com/Elwinmage/house-catalog), onde acrescentar uma espécie ou um objeto é um pull request, não uma nova versão desta integração.

- **Árvores**: cada espécie tem até quatro representações, uma por estação: cor e densidade da folhagem, floração, frutos, folhas no chão. A vista passa de uma estação para a seguinte dia após dia (carvalho, pinheiro, teixo, cerejeira e damasqueiro para começar). São as espécies propostas quando planta uma árvore no editor, dentro das alturas que o catálogo indica.
- **Objetos**: um móvel da planta cujo nome contém uma palavra-chave de um objeto do catálogo (`Chaise`, `Chair`, `Cadeira`…) é desenhado com ele, no lugar e com o tamanho do móvel, em vez de uma simples caixa; quando a planta dá uma cor ao móvel, o objeto assume-a nas suas partes tingíveis. Do mesmo modo, uma planta com o nome de uma árvore do catálogo (`Cerejeira`, `Yew`) é desenhada como essa árvore.
- **Peixes**: os peixes dos lagos (a carpa koi para começar), cada um com as suas variedades de cor; o cartão desenha-os ele próprio, vistos de cima.
- **Atualizações**: a integração descarrega o catálogo do GitHub em segundo plano (o cartão nunca acede à rede) e funciona offline com a cópia que inclui. O dispositivo *House view catalog* tem uma entidade de atualização por secção (árvores, objetos), um interruptor *Atualização automática* (ligado por omissão) e um botão *Atualizar agora*.
- **As suas próprias entradas**: com o [editor de catálogos](https://github.com/Elwinmage/catalog-editor), uma árvore ou um objeto que guardar é usado pela vista de imediato, antes de o propor ao catálogo (ou sem o propor).

## Editor (✎)

Reservado aos administradores. O editor é um menu de secções: uma secção abre-se numa janela própria por cima do menu, e um elemento de uma lista (uma linha de rega, uma zona, uma entidade do painel geral, uma porta…) abre a sua janela de edição por cima da secção; a seta ← de uma janela volta à de baixo. Tudo é guardado no ficheiro de edições, à parte da planta e do terreno; Escape cancela o traçado em curso.

- **Entidades colocadas** (sensores, luzes, interruptores, seletores…): colocadas com um toque e depois movidas arrastando a sua etiqueta (com o editor aberto). Fixação ao chão (por omissão: a etiqueta fica na sua divisão seja qual for o ângulo), à parede (do lado da divisão, oculta quando a parede é vista por trás) ou livre em altura; uma etiqueta tapada por um piso superior ou pelo telhado não é mostrada, exceto uma etiqueta *Shown over the roof*; enquanto *Placed entities* está aberto no editor, todas as etiquetas são mostradas (esbatidas quando a casa as tapa), para colocar e arrastar uma entidade em qualquer lugar, divisões incluídas. Emblema (ícone + valor) ou só ícone; cor, legenda, ícone (seletor de ícones do Home Assistant com pré-visualização); visível na vista geral (sempre, ou na vista do seu piso; *Shown over the roof* permite ler de longe a temperatura de uma divisão); toque = mais informações, alternar ou nada. No editor a lista está recolhida: só a entidade escolhida fica aberta. As entidades escolhem-se entre as da divisão atual, agrupadas por dispositivo (a casa toda à distância de uma caixa, com pesquisa); os ícones aparecem enquanto se escreve o nome.
- **Painel geral** (à esquerda, sob os botões dos pisos): sensores e atuadores de toda a casa (temperatura exterior, central de alarme…), pela ordem escolhida, com a sua etiqueta e o seu ícone; um toque comuta o que pode ser comutado e abre o diálogo dos restantes (ou à escolha: comutar, diálogo, nada).
- **Alarmes**: um emblema no canto superior direito, verde com um visto quando tudo está bem, vermelho com um sino e o número entre parênteses quando há alarmes ativos; um toque abre a sua lista (tocar num = o seu diálogo). Detetados automaticamente: sensores de problema, fumo, gás, monóxido de carbono, fuga de água, calor, frio e sabotagem, e centrais de alarme disparadas (incluindo os alarmes do reeftank); é possível adicionar entidades à mão, e ignorar um alarme a partir da própria lista (sino riscado) ou do editor. Cada divisão com alarmes ativos (divisão ligada a uma área do Home Assistant) mostra também um sino vermelho com o seu número; um toque abre a lista dessa divisão (*All* volta à casa toda); estes emblemas de divisão desativam-se no editor. Opção `show_alarms`.
- **Zonas clicáveis**: um leitor multimédia sobre um móvel da planta (tocado no editor) ou sobre um retângulo colocado numa parede ou num chão; um aquário do reeftank sobre um retângulo com as medidas do tanque (a frente numa parede, o topo num chão). Um toque abre o leitor, ou a vista do aquário do ha-reef-card numa janela; o retângulo de um aquário mostra essa vista ao vivo, com os peixes a mexer (opção por zona), na vista do aquário escolhida para a zona (caso contrário, a sua vista por omissão). Ao posicionar, a parede ou o chão sob o ponteiro ilumina-se e o retângulo é desenhado nele; uma zona move-se arrastando-a sobre a sua superfície. Largura, altura, altura do centro (parede) ou rotação (chão) são ajustáveis.
- **Luzes colocadas**: uma `light.*` colocada torna-se uma fonte de luz nesse ponto da divisão (foco, candeeiro suspenso, candeeiro, régua ou invisível; altura e alcance ajustáveis; na parede: um aplique à altura tocada), comandada pelo seu próprio estado e cor. As outras luzes da área continuam a iluminar toda a divisão.
- **Entidades de uma divisão**: em zoom numa divisão só aparecem as entidades dessa divisão; as da vista geral desaparecem (o robô aspirador continua a mover-se se lá estiver). No editor, um toque numa divisão faz zoom nela e a edição passa a ser a da divisão (faixa vermelha no topo): as entidades acrescentadas então colocam-se no chão, numa parede ou no ar, e só pertencem a essa divisão. Desaparecem quando se escolhe outra divisão ou se volta à vista geral. Uma entidade da vista geral colocada numa divisão passa para essa divisão com a sua definição *Its room only*.
- **Portas e janelas** (*Doors and windows*): as aberturas da planta do Sweet Home 3D, por piso e divisão, ou escolhidas com um toque na vista (a abertura sob o ponteiro acende-se). Cada uma pode ser ligada a um sensor aberto / fechado (`binary_sensor`), a um abridor motorizado (`cover` da janela) e, em janelas e portas de correr, a um estore de enrolar (`cover`). Uma divisão com uma só janela liga-se sozinha ao sensor de janela, ao abridor e ao estore da sua área quando há um de cada; uma divisão com uma só porta, ao sensor de porta; uma ligação escolhida à mão tem prioridade, e uma ligação automática pode ser retirada. Na vista as folhas (uma, duas acima de 1,10 m) abrem para dentro, uma porta de correr desliza, uma porta roda (uma porta interior recebe a folha quando ligada) e o estore desce pela face exterior até à posição do `cover` (`current_position`, suavemente).
- **Piscinas e lagos** (*Pools and ponds*): desenhados vistos de cima, em retângulo (dois cantos opostos) ou forma livre (ponto a ponto, *Finish*), com um nome, uma cor de água e uma profundidade (0,2 a 6 m). O terreno é escavado: uma piscina tem paredes verticais, fundo plano e capeamento, um lago um fundo inclinado e uma margem de seixos; o solo à volta é nivelado e a água mexe-se. Um robô de limpeza pode ser ligado a uma entidade (`binary_sensor`, `switch`, `input_boolean` ou `vacuum`): percorre o fundo enquanto está ativa e fica estacionado caso contrário. A piscina da planta do Sweet Home 3D fica como está. Um lago pode ter **ilhas** (desenhadas como o contorno: o chão fica um pouco acima da água, com uma margem de seixos; nelas plantam-se árvores e colocam-se entidades) e **peixes** do catálogo da casa: grupos de um peixe (a carpa koi para começar), de uma variedade (kohaku vermelho e branco, benigoi vermelho, yamabuki ogon amarelo, showa…) ou de cores próprias (corpo, manchas, padrão, escamas brilhantes), com um número e um tamanho: 3 vermelhas, 1 vermelha e branca e 2 amarelas são três grupos. Cada peixe tem o seu próprio padrão, nada à volta das ilhas, ganha a cor da água quanto mais fundo está e fica no fundo quando a água está fria.
- **Vista por divisão**: em zoom numa divisão e com o editor aberto, *📷 Room view* guarda a câmara e os pisos visíveis; um toque nessa divisão abre depois essa vista em vez do zoom automático. *Automatic view* regressa a ele.
- **Vedações** (*Fences*): cada lado tem o seu tipo (rede, madeira, muro, sebe, ou aberto para um portão) e a sua altura. Duas formas de criar uma: *Fence from the cadastre* (as parcelas da casa estão pré-selecionadas, toque para acrescentar ou retirar as parcelas vizinhas do mesmo terreno; é vedado o contorno do conjunto) ou *Draw a fence* (toques sucessivos, recomenda-se a vista de cima «Dessus»; cada lado fica com o tipo escolhido na paleta, uma cor por tipo). *Edit the sides*: mudar o tipo de um lado com um toque, cortar um lado em dois (uma parte em muro, a outra em rede), eliminar um ponto.
- **Rega** (*Watering*):
  - **Gota-a-gota** (*Drip lines*): uma linha por válvula (`switch`, `valve`, `input_boolean`), traçada ponto a ponto e arredondada na apresentação; tubo preto, castanho, verde ou oculto. Com a válvula aberta, a linha fica azul, percorrem-na reflexos, uma gota cresce e encolhe em ciclo debaixo de cada gotejador (espaçados 30 cm por omissão, com um ligeiro desfasamento de um gotejador para o seguinte: a linha cintila) e uma mancha húmida cresce até formar uma faixa. A largura da mancha segue o modelo de Schwartzman e Zur (1986), consoante o caudal do gotejador, o tempo de abertura e o tipo de solo; desaparece em 30 minutos após o fecho.
  - **Aspersores** (*Sprinklers*): um circuito por válvula, com um ou vários aspersores (modelo do catálogo: Hunter Pro-Spray PSU-04 8A a 17A, SRM-04, PGJ-04, PGP Ultra, MP Rotator, ou genérico; distâncias mínima / máxima, orientação e ângulo pré-preenchidos e editáveis; *Aim* com um toque). Com a válvula aberta é mostrado o setor regado estimado e o jato é animado (varrimento para uma turbina, leque para um bico pulverizador).
  - *Test the animation* reproduz 30 segundos de rega acelerada (30 s = 1 h 30) em todas as linhas e circuitos, sem abrir nenhuma válvula: a mancha húmida cresce, os jatos rodam e depois tudo volta ao estado real. O botão *Test* de uma linha ou de um circuito faz o mesmo só para esse elemento; fechar o editor interrompe o teste.
- **Outras ferramentas**: objetos exteriores (ocultar, altura, deslocamento, rotação), nível da piscina, árvores (remover, acrescentar com espécie e altura, anular, repor todas), correções do solo (murete, terraço, pincéis, corte, lista de correções editáveis), vistas.

## Configuração (⚙)

- **Demo** (para filmar ou apresentar a vista sem mostrar a sua casa nem a sua localização): *Load the demo* acrescenta uma habitação «Démo» com uma casa fictícia de dois pisos (o ficheiro do Sweet Home 3D `custom_components/house_view/demo/demo-maison.sh3d` pode ser aberto e retocado), um terreno em três socalcos com pomar, piscina, lago, vedação, rega, robô aspirador e estores, num local fictício (45° N). As suas habitações não são tocadas. As suas entidades são simuladas pelo cartão (nada é criado no Home Assistant e nada da sua casa aparece): um cenário do dia, a 1 h a cada 2 s, abre e fecha os estores, acende as luzes, rega de madrugada, lança o aspirador de manhã e o robô da piscina à tarde, provoca uma fuga de água antes do jantar… O botão 🎬 da barra pausa-o, acerta a hora e desencadeia um evento à mão (estores, luzes, aspirador, rega, robôs, fuga, fumo); um toque numa entidade simulada alterna-a. *Reset the demo* repõe-na como entregue, *Leave the demo* volta à sua habitação; a habitação de demonstração remove-se como qualquer outra entrada. Os seus aquários reais (reeftank) podem ser colocados nela. Os ficheiros são gerados por `npm run demo` em `card/`. A habitação de demonstração começa vazia e plana, para ser filmada desde o início: importe `demo-maison.sh3d` (*Download demo-maison.sh3d* em ⚙) com *Import a .sh3d* e depois obtenha o terreno: a obtenção passa pelas suas etapas e traz o terreno da demo, sem qualquer acesso à rede.
- **Planta**: *Import a plan* lê no navegador um ficheiro do Sweet Home 3D (`.sh3d`), um ficheiro IFC (`.ifc`, BIM: ArchiCAD, Revit, FreeCAD, BlenderBIM: pisos, espaços, paredes, portas e janelas) ou uma planta SVG (`.svg`, como as desenhadas para o ha-floorplan ou com o Inkscape: cada forma com nome é uma divisão, cada camada do Inkscape um nível; *Scale: SVG units per meter* corrige o tamanho) e lista o que foi encontrado. Sem ficheiro: *Create a simple plan* abre um editor de divisões retangulares, nível a nível (arrastar uma divisão para a mover, as suas pegas para a redimensionar, as arestas colam-se às divisões vizinhas; nome e área do Home Assistant, portas, janelas e portas de correr clicadas numa parede com a sua largura, altura e peitoril; pé-direito por nível, um nível novo copia o contorno do de baixo; telhado automático, de duas águas ou plano), com a vista 3D a atualizar-se por trás. *Plan from the robot's map* parte das divisões do mapa de um robô aspirador (extratores de mapa que dão `rooms`). Um SVG de retângulos e as divisões do robô abrem-se na planta simples, para acrescentar portas e janelas. Cada divisão recebe uma luz de teto acesa pelas luzes da sua área. Os móveis de uma planta do Sweet Home 3D são desenhados com os seus próprios modelos 3D (modelos OBJ do ficheiro, aligeirados: alguns milhares de triângulos no máximo, uma cor por material, a cor média de uma textura), no seu tamanho, rodados e espelhados como na planta; *Furniture drawn with the 3D models of the plan* volta às formas simples.
- **Obtenção do terreno** (*Terrain (DTM)*): a própria integração obtém o relevo e a sua envolvente, à volta das coordenadas do Home Assistant (editáveis). A fonte segue o país da configuração do Home Assistant (*Automatic*), ou é imposta no formulário:
  - **France: cartes.gouv.fr (IGN)**: solo LiDAR HD a 0,5 m (RGE ALTI a 1 m na sua falta), modelo de superfície (ajuste automático, árvores), edifícios, estradas e cadastro (BD TOPO, parcelário), fotografia aérea ou mapa do IGN projetado no solo. Se o IGN não tiver dados para o local, as fontes mundiais assumem;
  - **World: Mapterhorn + OpenStreetMap**: relevo dos mosaicos do [Mapterhorn](https://mapterhorn.com) (LiDAR abertos de muitos países, 30 m no resto; na sua falta, os Terrain Tiles da Mapzen alojados pela AWS, menos detalhados), edifícios e estradas do OpenStreetMap. Sem modelo de superfície, cadastro nem fotografia aérea: as árvores colocam-se com o editor e a vedação traça-se à mão.

  Nos dois casos: ajuste opcional ao edifício mais próximo (a localização do Home Assistant é muitas vezes aproximada), ajuste automático da planta no fim, e fonte mostrada por baixo do formulário.
- **Cópia no GitHub**: opções da integração, menu *Cópia no GitHub* (repositório privado `proprietário/nome`, token fine-grained com *Contents: read and write*, ramo, pasta); botões *Back up to GitHub* / *Restore from GitHub* em ⚙. Só os ficheiros alterados são submetidos; um repositório público é recusado (contém a planta da sua casa).
- **Proteção da edição**: só os administradores do Home Assistant podem alterar a vista. Para evitar também alterações feitas por engano (um ecrã partilhado que ficou ligado com uma conta de administrador), pode ser pedida uma palavra-passe antes de abrir o editor ✎ e a configuração ⚙:
  - define-se nas opções da integração (Definições → Dispositivos e serviços → House View → Configurar → *Proteção da edição*): 4 caracteres ou mais, campo vazio para manter a atual, uma caixa de verificação para remover a proteção. É guardada como hash com sal, nunca em texto simples;
  - o cartão pede-a ao abrir ✎ ou ⚙ (o lápis fica então com um cadeado), e de novo após 10 minutos sem alterações, depois de recarregar a página ou de reiniciar o Home Assistant. O botão 🔒 no cabeçalho do painel volta a bloquear de imediato;
  - a verificação é feita pela integração: sem palavra-passe válida, qualquer escrita é recusada (código HTTP 423), mesmo fora do cartão. Após 5 palavras-passe erradas é preciso esperar 1 minuto;
  - palavra-passe esquecida: altere-a ou remova-a nas opções da integração;
  - consultar a vista, fazer zoom, comandar as luzes ou o aspirador e a pré-visualização de estação / tempo continuam livres.

## Fontes do terreno por país

A França utiliza os serviços do IGN. No resto do mundo o relevo vem do [Mapterhorn](https://mapterhorn.com), que assenta os LiDAR nacionais abertos sobre um modelo mundial de 30 m, e os edifícios e estradas vêm do [OpenStreetMap](https://www.openstreetmap.org). A resolução indicada é a anunciada pelo Mapterhorn em novembro de 2026; melhora a cada versão do projeto (mapa de cobertura atualizado em mapterhorn.com).

| | País | Relevo | Edifícios, estradas | Cadastro, fotografia aérea | Testado |
|---|---|---|---|---|---|
| 🇫🇷 | França | IGN LiDAR HD 0,5 m (RGE ALTI 1 m na sua falta) | IGN BD TOPO | IGN (parcelário, fotografia aérea ou mapa) | ✅ |
| 🇩🇪 | Alemanha | Mapterhorn: 0,25 m (Bade-Vurtemberga), 1 m (a maioria dos estados) | OpenStreetMap | — | ❌ |
| 🇦🇹 | Áustria | Mapterhorn: 1 m | OpenStreetMap | — | ❌ |
| 🇧🇪 | Bélgica | Mapterhorn: 0,5 m (Valónia) | OpenStreetMap | — | ❌ |
| 🇩🇰 | Dinamarca | Mapterhorn: 0,4 m | OpenStreetMap | — | ❌ |
| 🇸🇰 | Eslováquia | Mapterhorn: 1 m | OpenStreetMap | — | ❌ |
| 🇸🇮 | Eslovénia | Mapterhorn: 0,5 m | OpenStreetMap | — | ❌ |
| 🇪🇸 | Espanha | Mapterhorn: 0,5 m (cobertura parcial) | OpenStreetMap | — | ❌ |
| 🇪🇪 | Estónia | Mapterhorn: 1 m | OpenStreetMap | — | ❌ |
| 🇮🇹 | Itália | Mapterhorn: LiDAR na Sicília e em parte da Sardenha | OpenStreetMap | — | ❌ |
| 🇱🇺 | Luxemburgo | Mapterhorn: 0,5 m | OpenStreetMap | — | ❌ |
| 🇳🇴 | Noruega | Mapterhorn: 1 m | OpenStreetMap | — | ❌ |
| 🇳🇱 | Países Baixos | Mapterhorn: LiDAR nacional | OpenStreetMap | — | ❌ |
| 🇵🇱 | Polónia | Mapterhorn: LiDAR nacional | OpenStreetMap | — | ❌ |
| 🇵🇹 | Portugal | Mapterhorn: 0,5 m (cobertura parcial) | OpenStreetMap | — | ❌ |
| 🇬🇧 | Reino Unido | Mapterhorn: 1 m (Inglaterra, Escócia, País de Gales) | OpenStreetMap | — | ❌ |
| 🇷🇴 | Roménia | Mapterhorn: 0,5 m (cobertura parcial) | OpenStreetMap | — | ❌ |
| 🇸🇪 | Suécia | Mapterhorn: 1 m | OpenStreetMap | — | ❌ |
| 🇨🇭 | Suíça | Mapterhorn: 0,25 m (cantão de Zurique), 0,5 m (cobertura parcial) | OpenStreetMap | — | ❌ |
| 🌍 | Resto do mundo | Mapterhorn: 30 m (Copernicus GLO-30); na sua falta, Terrain Tiles (Mapzen / AWS) | OpenStreetMap | — | ❌ |

> **Não testado fora de França.** As fontes mundiais foram escritas a partir da sua documentação e verificadas com dados simulados, sem possibilidade de as experimentar em condições reais. Se a obtenção falhar ou der um relevo incoerente em sua casa, por favor [abra um issue](https://github.com/elwinmage/ha-house-view-component/issues) indicando o país, a fonte escolhida e a mensagem mostrada por baixo do formulário. Uma boa notícia também é bem-vinda: permitirá marcar o país como testado.

Com um modelo de 30 m o terreno é apenas um plano inclinado: as correções do solo do editor (✎) permitem redesenhar terraços e taludes. O cadastro e a fotografia aérea só existem país a país; poderão ser acrescentados a pedido, um issue por país.

## API HTTP (usada pelo cartão)

| Rota | GET | POST | DELETE |
|---|---|---|---|
| `/api/house_view/homes` | habitações configuradas: `[{id, title}]` | | |
| `/api/house_view/demo` | planta da casa de demonstração (admin) | cria a habitação de demonstração ou repõe-na como entregue → `{home}` (admin) | |
| `/api/house_view/info` | estado, nome e localização da habitação | | |
| `/api/house_view/scene` | planta | substitui (admin) | |
| `/api/house_view/terrain` | grelha de alturas | substitui (admin) | elimina (admin) |
| `/api/house_view/edits` | correções | substitui (admin) | elimina (admin) |
| `/api/house_view/ortho` | fotografia / mapa do solo | substitui (admin) | elimina (admin) |
| `/api/house_view/fetch` | estado da obtenção | inicia a obtenção do terreno, `provider`: `auto` \| `ign` \| `world` (admin) | |
| `/api/house_view/github` | | `{"action": "backup" \| "restore"}` (admin) | |
| `/api/house_view/unlock` | `{locked, unlocked}` | `{"password"}` → token (admin) | volta a bloquear |

Com várias habitações, cada rota aceita `?home=<id da entrada>` (sem ele, a primeira habitação).

Quando há uma palavra-passe de edição, as escritas (POST / DELETE acima) exigem também o cabeçalho `X-House-View-Unlock` com o token devolvido por `/unlock`; caso contrário respondem 423.

Cada documento é validado (`validate.py`) e guardado em `.storage/house_view.<chave>` (habitação criada antes da versão 0.2) ou em `.storage/house_view.<id da habitação>.<chave>`; cada escrita dispara o evento `house_view_updated` (`key`, `updated`, `home`). Remover uma habitação remove os seus documentos. Os documentos são volumosos (um terreno ocupa vários MB): viajam por HTTP (limite do Home Assistant de 16 MB por pedido), e não pelo websocket.

## Desenvolvimento e testes

```bash
pip install pre-commit
# (opcional) cd card && npm install para lançar a compilação e os testes à mão
pre-commit install            # ruff, prettier, vitest, traduções, pytest (100 % de cobertura); o pre-commit gere as dependências dos hooks
pre-commit run --all-files
```

- **Integração**: `pytest` (servidor HTTP real do Home Assistant através de `pytest-homeassistant-custom-component`, exige-se 100 % de cobertura).
- **Cartão**: `cd card && npm test` (vitest); `npm run build` escreve `custom_components/house_view/frontend/house-view-card.js`; `npm run format` (prettier).
- **Traduções**: `scripts/check_translations.py` verifica que cada idioma da integração (en, fr, it, de, es, pl, pt) e do cartão (`card/src/i18n.js`) tem exatamente as chaves do inglês. Este README existe nos mesmos sete idiomas (`doc/<idioma>/README.<idioma>.md`).
- **Página de teste sem Home Assistant**: `python3 card/test/harness/server.py` (servidor falso da API) e depois http://localhost:8765/card/test/harness/index.html
- **Imagens de marca**: `custom_components/house_view/brand/` (ícone e logótipo, claro e escuro), servidas pelo Home Assistant 2026.3+ sem passar pelo repositório `home-assistant/brands`. Fontes vetoriais em `assets/brand/`; `scripts/build_brand.sh` volta a gerar os PNG (`rsvg-convert`, ImageMagick, tipo de letra Inter).
- **CI** (`.github/workflows/`): `validate.yml` (hassfest + HACS), `tests.yml` (pre-commit, pytest, vitest + compilação), `release.yml` (lançado à mão com a versão: atualiza `manifest.json` e `card/package.json`, compila o cartão, cria a etiqueta e publica a versão com `house_view.zip`).
- **Cliente do catálogo**: `catalog_pack.py` e `catalog_runtime.py` são cópias de `reeftech-catalog/client/` (o cliente só conhece as suas próprias secções: `catalog.py` declara-lhe as da casa); `house_catalog_sections.py` e `catalog_builtin*/` são cópias da descrição e das entradas de `house-catalog`. Todos são escritos pelo `scripts/sync_client.py` desses repositórios: alteram-se lá, nunca aqui.

`card/src/engine.js` é o motor 3D (uma instância por cartão, sem dependência do Home Assistant); `card/src/ha-bridge.js` converte o estado do Home Assistant em dados para o motor; `card/src/engine/` contém os módulos do protótipo (geometria, vegetação, terreno, luzes…).

## Roteiro

1. ✅ Fase 1: integração + cartão, importação da planta, terreno, ajuste, luzes e meteorologia em direto.
2. ✅ Editores no cartão: objetos exteriores, árvores, correções do solo, vistas personalizadas.
3. ✅ Obtenção do terreno pela integração para França (IGN), estradas, fotografia do solo, vedações, entidades colocadas, robô aspirador, zoom numa divisão, pré-visualização de estação / tempo, cópia no GitHub.
4. ✅ Outros países: relevo do Mapterhorn, edifícios e estradas do OpenStreetMap (a confirmar país a país). Depois: cadastro e fotografia aérea dos países que os publicam como dados abertos.
5. ✅ Catálogo (árvores de quatro estações, objetos) lido de `house-catalog` e editado com `catalog_editor`. A seguir: mais espécies e objetos, modelos de aspersores.
6. ✅ Várias habitações, vários robôs aspiradores, entidades de uma divisão em zoom, portas / janelas / estores ligados ao Home Assistant, piscinas e lagos escavados no terreno, editor em janelas.

## Licença

Código sob a licença [MIT](../../LICENSE) © Elwinmage. O ícone e o logótipo (`assets/brand/`) são criações originais do projeto, sob a mesma licença.

- **Bibliotecas incluídas no cartão compilado**: [three.js](https://threejs.org) (MIT), [Lit](https://lit.dev) (BSD-3-Clause) e [fflate](https://github.com/101arrowz/fflate) (MIT); os seus avisos de licença são mantidos no fim do ficheiro compilado.
- **Dados**: o repositório não contém nenhum dado cartográfico; cada utilizador descarrega os dados do seu próprio terreno, e a fonte é recordada em ⚙ → *Terrain (DTM)*. Ao publicar uma captura de ecrã, indique essa fonte:
  - França: serviços do IGN (cartes.gouv.fr), sob a [Licence Ouverte Etalab 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/);
  - relevo fora de França: [Mapterhorn](https://mapterhorn.com/attribution) e os conjuntos de dados abertos que reúne, ou os [Terrain Tiles](https://registry.opendata.aws/terrain-tiles) da Mapzen;
  - edifícios e estradas fora de França: © contribuidores do [OpenStreetMap](https://www.openstreetmap.org/copyright), sob a licença ODbL.
- Os nomes de marcas (Hunter, Roborock, Sweet Home 3D…) pertencem aos seus proprietários e só são citados para descrever a compatibilidade.
