<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../custom_components/house_view/brand/dark_logo.png">
    <img src="../../custom_components/house_view/brand/logo.png" alt="House View" width="420">
  </picture>
</p>

# House View

**Idiomas disponíveis:**
[<img src="https://flagicons.lipis.dev/flags/4x3/fr.svg" style="width: 5%;"/>](../fr/README.fr.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/gb.svg" style="width: 5%;"/>](../../README.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/es.svg" style="width: 5%;"/>](../es/README.es.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/de.svg" style="width: 5%;"/>](../de/README.de.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/pl.svg" style="width: 5%;"/>](../pl/README.pl.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/pt.svg" style="width: 5%;"/>](README.pt.md)
[<img src="https://flagicons.lipis.dev/flags/4x3/it.svg" style="width: 5%;"/>](../it/README.it.md)

Vista pseudo-3D em direto da sua casa para o Home Assistant: a sua planta do **Sweet Home 3D** assente num modelo digital do terreno, com luzes, meteorologia, sol e estações em tempo real, e ainda um robô aspirador, a rega do jardim e as vedações. Um único repositório contém:

- `custom_components/house_view/`: a **integração** (guarda a planta, o terreno e as suas correções; obtém o terreno; API HTTP);
- `card/`: o **cartão Lovelace** `house-view-card` (three.js), compilado em `custom_components/house_view/frontend/`. A própria integração serve-o (`/house_view/house-view-card.js`) e carrega-o em todos os painéis: **não é preciso declarar nenhum recurso Lovelace**.

A interface do cartão existe em inglês e em francês: em português é apresentada em inglês, por isso os nomes dos botões e das secções são aqui citados em inglês. As opções da integração existem em inglês, francês, italiano, alemão, espanhol, polaco e português. As traduções são bem-vindas: os textos estão em `custom_components/house_view/translations/` e `card/src/i18n.js`.

## Instalação

1. Instale com o HACS (repositório personalizado, tipo *Integração*), ou copie `custom_components/house_view/` para `config/custom_components/`, e reinicie o Home Assistant.
2. Adicione a integração *House View*. Não há nada a configurar: a localização vem da configuração do Home Assistant.
3. Adicione o cartão a um painel (`type: custom:house-view-card`).
4. Abra ⚙ no cartão (apenas administradores) para importar a sua planta `.sh3d`; depois obtenha o terreno (cartes.gouv.fr em França, dados abertos mundiais no resto: veja [Fontes do terreno por país](#fontes-do-terreno-por-país)) ou carregue um terreno `.json`.

A versão do cartão aparece na consola do navegador ao carregar (`🏠 HOUSE VIEW v0.x.y`). A limpeza por divisões e o ícone da integração requerem o Home Assistant 2026.3 ou posterior.

O cartão compilado não está no repositório: o `release.yml` constrói-o em cada versão e publica `house_view.zip`, que o HACS instala. Para desenvolvimento: `cd card && npm install && npm run build`.

## Configuração do cartão

As opções definem-se no editor visual do cartão (edite o painel e escolha *Editar* no cartão), em quatro secções: hora e meteorologia, apresentação, luzes, robô aspirador. A planta, o terreno e tudo o que é colocado na vista definem-se no próprio cartão (✎ e ⚙). Em YAML:

```yaml
type: custom:house-view-card
weather_entity: weather.casa          # meteorologia em direto (opcional)
rain_entity: binary_sensor.chuva      # opcional: detetor de chuva ou sensor de intensidade (mm/h) da sua estação
mode: live                            # live (hora real) | simulation (controlos de hora / data / meteorologia)
view: Vue générale                    # vista inicial (opcional): o nome mostrado no respetivo botão
show_views: true                      # botões das vistas de câmara
show_levels: true                     # botões telhado / pisos (+ 🌡 quando há temperaturas por divisão)
tap_action: zoom                      # toque numa divisão: zoom (2.º toque = luzes) | toggle_lights | none
show_entities: true                   # entidades colocadas no editor
vacuum_entity: vacuum.robot           # opcional: por omissão, o primeiro vacuum.* encontrado
vacuum_poll: 15                       # segundos entre duas leituras de posição (Roborock: ação na nuvem, mín. 5)
vacuum_show_floor: false              # true = durante uma limpeza, mostra o piso do robô visto de cima
vacuum_rate: 1                        # m²/min, para o percurso estimado de um robô sem posição
vacuum_progress_entity: sensor.xxx    # opcional: progresso (%); detetado automaticamente para Roborock
movable_camera: true                  # câmara móvel (rotação, zoom, deslocação); false = fixa nas vistas
height: fill                          # fill (altura do ecrã abaixo do topo do cartão) | aspect (16/10) | 600 | "70vh"
min_height: 320                       # altura mínima no modo fill (px)
fps_cap: 30                           # limite de imagens por segundo (ecrãs de parede, tablets)
light_entities: [light.sala, ...]     # opcional: restringe as luzes consideradas
```

## Vista em direto

- **Latitude, longitude, fuso horário**: lidos da configuração do Home Assistant. As estações da vegetação invertem-se no hemisfério sul.
- **Divisões ↔ áreas**: uma divisão da planta fica ligada à área do Home Assistant com o mesmo nome (sem distinguir acentos nem maiúsculas). ⚙ lista as divisões sem área correspondente; ✎ → *Rooms ↔ Home Assistant areas* permite escolher outra área, ou nenhuma, divisão a divisão.
- **Luzes**: estado, cor e intensidade das entidades `light.*` da área de cada divisão.
- **Meteorologia**: a entidade `weather_entity` decide o tempo apresentado: chuva (`rainy`, `pouring`, `hail`), neve (`snowy`, `snowy-rainy`), trovoada (`lightning`, `lightning-rainy`), nevoeiro, nuvens; a sua temperatura, o seu vento e a sua nebulosidade são usados quando disponíveis. Com `rain_entity` (um detetor de chuva `binary_sensor`, ou um sensor de intensidade em mm/h), a chuva segue o que realmente cai em sua casa: chove no sensor → chuva, mais ou menos densa consoante a intensidade medida; o serviço meteorológico anuncia chuva mas o sensor está seco → céu encoberto sem chuva (trovoada: relâmpagos sem chuva). A neve e a trovoada continuam a ser decididas pelo serviço meteorológico, porque um pluviómetro não as distingue; um acumulado («chuva de hoje» em mm) é ignorado, pois não diz se está a chover agora.
- **Zoom numa divisão**: um toque aproxima a divisão (telhado e pisos superiores ocultos); um segundo toque na mesma divisão alterna as suas luzes; *← divisão* regressa à vista anterior.
- **Pré-visualização** (botão de meteorologia): força uma estação (primavera, verão, outono, inverno), um tempo (limpo, nublado, chuva, trovoada, neve, nevoeiro) ou um momento (manhã, meio-dia, crepúsculo, noite), que podem ser combinados; regressa-se ao direto com o botão *Preview … ✕*, ou automaticamente ao fim de 3 minutos. No modo de simulação são atalhos para os controlos.
- **Câmara**: o botão no canto superior direito desbloqueia ou bloqueia a câmara sem tocar na configuração.
- **Temperaturas**: o sensor de temperatura da área (definição da área no Home Assistant) ou, na sua falta, o primeiro `sensor.*` com `device_class: temperature` da área; mostradas ao passar o cursor e como camada (🌡).
- **Modo de simulação**: ☀ abre hora (com reprodução), data, tempo predefinido, nuvens, precipitação, vento, temperatura e neve.
- **Estradas**: desenhadas como asfalto sobre o relevo (podem ser desativadas em ⚙).
- **Desempenho**: a renderização para quando o cartão não está visível; os volumes de luz só são recalculados quando muda um estado útil.

## Robô aspirador

- **Limpeza por divisões**: se existir uma entidade `vacuum.*`, o seu ícone aparece no canto superior direito. Um toque abre a seleção de divisões (o piso do robô é mostrado visto de cima): cada divisão tocada, se estiver ligada a uma área, fica destacada, e *Clean* chama `vacuum.clean_area` com as áreas escolhidas (ação genérica do Home Assistant 2026.3+; a correspondência entre as divisões do robô e as áreas faz-se uma vez nas definições da entidade do aspirador). Também *Start*, *Pause* e *Dock*.
- **Acompanhamento da limpeza** (✎ → *Robot vacuum*): um robô 3D (cor à escolha, branco por omissão) desloca-se na planta, a divisão em curso fica colorida (cor à escolha) com a sua percentagem, as divisões seguintes ficam coloridas num tom mais claro, uma divisão terminada cintila durante um minuto, e um indicador circular à volta do ícone do robô dá o progresso total. Em caso de erro (`error`), a divisão e o robô piscam a vermelho com um sinal ⚠.
- **Base**: *Place the dock* e depois um toque no chão; é o ponto de referência entre o mapa do robô e a planta. A sua **orientação** define-se em graus (0° = virada para o topo da planta, 90° para a direita, o valor por omissão), por quartos de volta (⟲ / ⟳) ou com *Aim with a tap*: toque à frente da base, por onde o robô sai. O robô em repouso estaciona à frente da base, no mesmo sentido.
- **Posição do robô**: *Roborock* (ação oficial `roborock.get_vacuum_current_position`, base em 25500 / 25500; passa pela nuvem, daí uma leitura a cada `vacuum_poll` segundos, mais lenta após um erro), *atributos de uma entidade* (`vacuum_position {x, y}` e `charger`, como os fornecidos pelos extratores de mapas), ou *nenhuma*: o robô segue então um percurso estimado (idas e voltas, divisão a divisão), assinalado como «estimated position».
- **Calibração**: rotação, espelho e escala; *Calibrate with a tap* calcula a rotação quando se toca na posição real do robô já fora da base; *remember* guarda as coordenadas da base para outras marcas.
- **Percentagem de uma divisão**: parte do chão percorrida pelo robô (estimativa: assume-se que 80 % do chão é acessível); o progresso total vem do sensor do robô quando existe (Roborock: `cleaning_progress`).
- *Test the animation* reproduz uma limpeza acelerada (com ou sem erro) sem pôr o robô a trabalhar.

## Editor (✎)

Reservado aos administradores. Só há uma secção aberta de cada vez; tudo é guardado no ficheiro de edições, à parte da planta e do terreno; Escape cancela o traçado em curso.

- **Entidades colocadas** (sensores, luzes, interruptores, seletores…): colocadas com um toque e depois movidas arrastando a sua etiqueta (com o editor aberto). Fixação ao chão (por omissão: a etiqueta fica na sua divisão seja qual for o ângulo), à parede (do lado da divisão, oculta quando a parede é vista por trás) ou livre em altura; uma etiqueta tapada por um piso superior ou pelo telhado não é mostrada. Emblema (ícone + valor) ou só ícone; cor, legenda, ícone (seletor de ícones do Home Assistant com pré-visualização); visível sempre, na vista do seu piso ou em zoom na sua divisão; toque = mais informações, alternar ou nada. No editor a lista está recolhida: só a entidade escolhida fica aberta.
- **Luzes colocadas**: uma `light.*` colocada torna-se uma fonte de luz nesse ponto da divisão (foco, candeeiro suspenso, candeeiro, régua ou invisível; altura e alcance ajustáveis; na parede: um aplique à altura tocada), comandada pelo seu próprio estado e cor. As outras luzes da área continuam a iluminar toda a divisão.
- **Vista por divisão**: em zoom numa divisão e com o editor aberto, *📷 Room view* guarda a câmara e os pisos visíveis; um toque nessa divisão abre depois essa vista em vez do zoom automático. *Automatic view* regressa a ele.
- **Vedações** (*Fences*): cada lado tem o seu tipo (rede, madeira, muro, sebe, ou aberto para um portão) e a sua altura. Duas formas de criar uma: *Fence from the cadastre* (as parcelas da casa estão pré-selecionadas, toque para acrescentar ou retirar as parcelas vizinhas do mesmo terreno; é vedado o contorno do conjunto) ou *Draw a fence* (toques sucessivos, recomenda-se a vista de cima «Dessus»; cada lado fica com o tipo escolhido na paleta, uma cor por tipo). *Edit the sides*: mudar o tipo de um lado com um toque, cortar um lado em dois (uma parte em muro, a outra em rede), eliminar um ponto.
- **Rega** (*Watering*):
  - **Gota-a-gota** (*Drip lines*): uma linha por válvula (`switch`, `valve`, `input_boolean`), traçada ponto a ponto e arredondada na apresentação; tubo preto, castanho, verde ou oculto. Com a válvula aberta, a linha fica azul, percorrem-na reflexos, uma gota cresce e encolhe em ciclo debaixo de cada gotejador (espaçados 30 cm por omissão, com um ligeiro desfasamento de um gotejador para o seguinte: a linha cintila) e uma mancha húmida cresce até formar uma faixa. A largura da mancha segue o modelo de Schwartzman e Zur (1986), consoante o caudal do gotejador, o tempo de abertura e o tipo de solo; desaparece em 30 minutos após o fecho.
  - **Aspersores** (*Sprinklers*): um circuito por válvula, com um ou vários aspersores (modelo do catálogo: Hunter Pro-Spray PSU-04 8A a 17A, SRM-04, PGJ-04, PGP Ultra, MP Rotator, ou genérico; distâncias mínima / máxima, orientação e ângulo pré-preenchidos e editáveis; *Aim* com um toque). Com a válvula aberta é mostrado o setor regado estimado e o jato é animado (varrimento para uma turbina, leque para um bico pulverizador).
  - *Test the animation* reproduz 30 segundos de rega acelerada (30 s = 1 h 30) em todas as linhas e circuitos, sem abrir nenhuma válvula: a mancha húmida cresce, os jatos rodam e depois tudo volta ao estado real. O botão *Test* de uma linha ou de um circuito faz o mesmo só para esse elemento; fechar o editor interrompe o teste.
- **Outras ferramentas**: objetos exteriores (ocultar, altura, deslocamento, rotação), nível da piscina, árvores (remover, acrescentar com espécie e altura, anular, repor todas), correções do solo (murete, terraço, pincéis, corte, lista de correções editáveis), vistas.

## Configuração (⚙)

- **Planta**: *Import a .sh3d* lê o seu ficheiro do Sweet Home 3D no navegador e lista o que foi encontrado (pisos, divisões, paredes, luzes…).
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
| `/api/house_view/info` | estado + localização do Home Assistant | | |
| `/api/house_view/scene` | planta | substitui (admin) | |
| `/api/house_view/terrain` | grelha de alturas | substitui (admin) | elimina (admin) |
| `/api/house_view/edits` | correções | substitui (admin) | elimina (admin) |
| `/api/house_view/ortho` | fotografia / mapa do solo | substitui (admin) | elimina (admin) |
| `/api/house_view/fetch` | estado da obtenção | inicia a obtenção do terreno, `provider`: `auto` \| `ign` \| `world` (admin) | |
| `/api/house_view/github` | | `{"action": "backup" \| "restore"}` (admin) | |
| `/api/house_view/unlock` | `{locked, unlocked}` | `{"password"}` → token (admin) | volta a bloquear |

Quando há uma palavra-passe de edição, as escritas (POST / DELETE acima) exigem também o cabeçalho `X-House-View-Unlock` com o token devolvido por `/unlock`; caso contrário respondem 423.

Cada documento é validado (`validate.py`) e guardado em `.storage/house_view.<chave>`; cada escrita dispara o evento `house_view_updated` (`key`, `updated`). Os documentos são volumosos (um terreno ocupa vários MB): viajam por HTTP (limite do Home Assistant de 16 MB por pedido), e não pelo websocket.

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

`card/src/engine.js` é o motor 3D (uma instância por cartão, sem dependência do Home Assistant); `card/src/ha-bridge.js` converte o estado do Home Assistant em dados para o motor; `card/src/engine/` contém os módulos do protótipo (geometria, vegetação, terreno, luzes…).

## Roteiro

1. ✅ Fase 1: integração + cartão, importação da planta, terreno, ajuste, luzes e meteorologia em direto.
2. ✅ Editores no cartão: objetos exteriores, árvores, correções do solo, vistas personalizadas.
3. ✅ Obtenção do terreno pela integração para França (IGN), estradas, fotografia do solo, vedações, entidades colocadas, robô aspirador, zoom numa divisão, pré-visualização de estação / tempo, cópia no GitHub.
4. ✅ Outros países: relevo do Mapterhorn, edifícios e estradas do OpenStreetMap (a confirmar país a país). Depois: cadastro e fotografia aérea dos países que os publicam como dados abertos.
5. Catálogo (árvores de quatro estações, objetos) gerido por `catalog_editor`.

## Licença

Código sob a licença [MIT](../../LICENSE) © Elwinmage. O ícone e o logótipo (`assets/brand/`) são criações originais do projeto, sob a mesma licença.

- **Bibliotecas incluídas no cartão compilado**: [three.js](https://threejs.org) (MIT), [Lit](https://lit.dev) (BSD-3-Clause) e [fflate](https://github.com/101arrowz/fflate) (MIT); os seus avisos de licença são mantidos no fim do ficheiro compilado.
- **Dados**: o repositório não contém nenhum dado cartográfico; cada utilizador descarrega os dados do seu próprio terreno, e a fonte é recordada em ⚙ → *Terrain (DTM)*. Ao publicar uma captura de ecrã, indique essa fonte:
  - França: serviços do IGN (cartes.gouv.fr), sob a [Licence Ouverte Etalab 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/);
  - relevo fora de França: [Mapterhorn](https://mapterhorn.com/attribution) e os conjuntos de dados abertos que reúne, ou os [Terrain Tiles](https://registry.opendata.aws/terrain-tiles) da Mapzen;
  - edifícios e estradas fora de França: © contribuidores do [OpenStreetMap](https://www.openstreetmap.org/copyright), sob a licença ODbL.
- Os nomes de marcas (Hunter, Roborock, Sweet Home 3D…) pertencem aos seus proprietários e só são citados para descrever a compatibilidade.
