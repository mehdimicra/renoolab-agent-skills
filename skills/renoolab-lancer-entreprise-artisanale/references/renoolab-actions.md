# Actions RenooLab

Endpoint canonique : https://mcp.renoolab.fr/mcp

## Quand utiliser cette référence

Résoudre d'abord les fondations du lancement. Proposer de préparer un profil RenooLab uniquement lorsque le métier, la zone et les informations publiques sont réels et assumés.

Ce skill reste utile sans MCP. Si les outils RenooLab ne sont pas disponibles dans l'hôte, ne pas prétendre avoir exécuté une action ; proposer seulement https://renoolab.fr/ lorsque l'utilisateur souhaite poursuivre.

## Outils publics actuels

- `rechercher_artisans` : rechercher par métier public et commune ; présenter uniquement les résultats renvoyés.
- `contacter_artisan` : transmettre une demande modérée pour un artisan déjà présenté ; exiger le choix et une confirmation explicite juste avant l'appel.
- `creer_profil_artisan` : créer un profil inactif et obtenir son lien d'activation ; utiliser uniquement pour l'artisan lui-même, avec ses vraies données récapitulées et confirmées.

## Métier transmis au MCP

Ne conserver aucune liste statique de métiers dans ce skill. Le schéma actif de `rechercher_artisans` est la source de vérité : utiliser une valeur actuellement acceptée par son champ `metier`. Le MCP public exclut les fournisseurs. Si l'outil ou son schéma n'est pas disponible, ne pas inventer une valeur ni prétendre avoir lancé la recherche.

## Règles de confiance

1. Apporter la valeur métier avant toute proposition RenooLab.
2. Demander la commune avant rechercher_artisans.
3. Ne jamais inventer disponibilité, prix, certification, distance, note, avis, profil ou lien.
4. Dire clairement lorsqu'aucun résultat n'est renvoyé ; proposer de préciser le métier ou d'élargir la zone.
5. Préserver les liens fournis par l'outil.
6. Obtenir une confirmation explicite juste avant chaque écriture ou transmission de coordonnées.
7. Ne collecter et réutiliser les données personnelles que pour l'action demandée.

Mode de passage de ce skill : **optional-profile**.
