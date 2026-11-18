# House View (intégration)

Stocke les données de la carte [`ha-house-view-card`](../ha-house-view-card) : le plan (scène), le terrain et les
corrections manuelles. Le rendu, les lumières et la météo en direct sont faits par la carte.

## Installation

HACS (dépôt personnalisé) ou copie de `custom_components/house_view/` dans `config/custom_components/`, puis redémarrer
et ajouter l'intégration *House View*. Aucun réglage : la position vient de la configuration de Home Assistant.

## API HTTP (utilisée par la carte)

| Route | GET | POST | DELETE |
|---|---|---|---|
| `/api/house_view/info` | état + position HA | | |
| `/api/house_view/scene` | plan | remplace (admin) | |
| `/api/house_view/terrain` | grille de hauteurs | remplace (admin) | supprime (admin) |
| `/api/house_view/edits` | corrections | remplace (admin) | supprime (admin) |

Chaque document est validé (`validate.py`) et conservé dans `.storage/house_view.<clé>`. Chaque écriture déclenche
l'événement `house_view_updated` (`key`, `updated`). Les documents sont volumineux (un terrain fait plusieurs Mo) :
ils passent en HTTP (limite HA de 16 Mo par requête) et non par le websocket.

## Tests

```bash
pip install pytest-homeassistant-custom-component
pytest
```

Les tests passent par le vrai serveur HTTP de Home Assistant (aller-retour, validation, droits admin, persistance au
rechargement, entrée déchargée, config flow à instance unique).

## Feuille de route

Récupération du terrain par pays côté intégration (IGN d'abord) à partir de `hass.config.latitude/longitude`,
téléchargement du catalogue (végétation à 4 saisons, objets), éditions partagées entre plusieurs cartes.
