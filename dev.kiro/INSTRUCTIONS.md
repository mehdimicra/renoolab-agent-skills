## Overview

RenooLab fournit dix workflows spécialisés en français pour préparer des travaux, piloter une activité artisanale et trouver des artisans en France.

## Available MCP Servers

- `renoolab` : serveur distant RenooLab déclaré dans `mcp.json`. L’hôte gère OAuth ; aucun secret n’est fourni par ce Power.

## Tool Usage

- Pour une recherche locale réelle, utiliser uniquement `rechercher_artisans` et ne présenter que les profils et URL effectivement renvoyés.
- Ne jamais inventer un profil, une disponibilité, un résultat ou une URL.
- `contacter_artisan` et `creer_profil_artisan` ont des effets externes : les appeler uniquement après une demande explicite et une confirmation explicite de l’utilisateur.
- Pour une demande de conseil sans recherche réelle, charger le skill le plus pertinent sans appeler le MCP inutilement.

## Configuration

Le serveur distant et son authentification sont déclarés dans `mcp.json`.

- Privacy: https://renoolab.fr/privacy/
- Support: contact@renoolab.fr
- License: Apache-2.0
