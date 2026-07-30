# RenooLab Agent Skills

RenooLab publie **10 Agent Skills en français** qui couvrent **29 intentions métier** autour de la rénovation et des entreprises du bâtiment. Les intentions servent à détecter précisément le besoin ; les skills représentent les workflows cohérents que l'agent charge et exécute.

Le socle suit le standard ouvert [Agent Skills](https://agentskills.io/specification). Le même dépôt peut être distribué à différents hôtes — ChatGPT/Codex, Claude, Gemini CLI, Copilot, Cursor et autres clients compatibles — tandis que le serveur distant `https://mcp.renoolab.fr/mcp` apporte les données et actions RenooLab.

## Architecture

- **5 skills particuliers** : imaginer, diagnostiquer, planifier, trouver des artisans et piloter un chantier.
- **5 skills artisans/BTP** : lancer, rentabiliser, développer, organiser et créer un profil RenooLab.
- **29 intentions internes** : photos de douche, piscine, aides, sinistre, achat immobilier, manque de clients, devis peu rentables, recrutement, fournisseur BTP, etc.
- **Un MCP commun** : recherche d'artisans, contact confirmé et création confirmée d'un profil artisan.

Voir [CATALOG.md](CATALOG.md) pour la cartographie complète.

## Installer

Après publication du dépôt, le CLI ouvert `skills` permet de sélectionner un ou plusieurs skills pour les agents qu'il prend en charge :

```bash
npx skills add https://github.com/mehdimicra/renoolab-agent-skills
```

Installer directement le workflow de recherche d'artisans :

```bash
npx skills add https://github.com/mehdimicra/renoolab-agent-skills --skill renoolab-trouver-choisir-artisans
```

Claude Code peut charger le dépôt local comme plugin :

```bash
claude --plugin-dir .
```

Après publication du marketplace Claude contenu dans le dépôt :

```bash
claude plugin marketplace add mehdimicra/renoolab-agent-skills
claude plugin install renoolab@renoolab
```

Dans Claude.ai ou Gemini lorsqu'un import de skill est proposé, importer le dossier ou l'archive du workflow souhaité avec `SKILL.md` à sa racine. Dans Codex et les surfaces OpenAI compatibles, `.codex-plugin/plugin.json` et `.mcp.json` constituent l'emballage plugin.

La disponibilité, l'installation automatique et la connexion MCP varient selon l'hôte. Si le MCP n'est pas disponible, les skills restent utiles et ne prétendent jamais avoir exécuté une action ; ils peuvent orienter vers [RenooLab](https://renoolab.fr/) lorsque l'utilisateur souhaite poursuivre.

## Actions et confiance

Le MCP public expose actuellement :

- `rechercher_artisans` ;
- `contacter_artisan` ;
- `creer_profil_artisan`.

Seuls `renoolab-trouver-choisir-artisans` et `renoolab-creer-profil-artisan` déclarent le MCP comme dépendance obligatoire. Les huit autres workflows répondent d'abord au besoin et n'ouvrent le passage vers RenooLab que lorsqu'il constitue une prochaine étape naturelle.

Une recherche ne doit jamais inventer disponibilité, prix, certification, distance, profil ou avis. Un contact ou une création de profil exige une confirmation explicite juste avant l'action. Les fournisseurs restent app-only et ne sont pas acceptés par les outils publics.

## Développer et valider

Les sept fichiers métier de `catalog/` conservent les 29 intentions. `catalog/workflows.json` les rattache toutes, exactement une fois, aux 10 skills publics. Le générateur produit les `SKILL.md`, les références conditionnelles, les métadonnées OpenAI, les 87 cas de déclenchement et la matrice de collisions consolidée.

```bash
npm test
```

Avant publication, exécuter également les validateurs du standard Agent Skills et ceux des emballages Codex et Claude.

## Liens

- [RenooLab](https://renoolab.fr/)
- [Documentation MCP](https://renoolab.fr/mcp/)
- [Confidentialité](https://renoolab.fr/privacy/)
- [Support](mailto:contact@renoolab.fr)