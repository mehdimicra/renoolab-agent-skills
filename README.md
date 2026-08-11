# RenooLab Agent Skills

> **Registry review summary (English):** this is an Apache-2.0 open-source collection of 10 standard Agent Skills, not a single executable package. Each implementation lives in `skills/<name>/SKILL.md`; generation, validation and behavioral evaluation code lives in `scripts/`.

## Quick verification for registries

- **License:** [Apache License 2.0](LICENSE), with attribution details in [NOTICE](NOTICE).
- **Install:** `npx skills add https://github.com/mehdimicra/renoolab-agent-skills` installs the collection; add `--skill <name>` to install one workflow.
- **Source:** 10 `SKILL.md` implementations and their references are in [`skills/`](skills/); the 29 source intents and mappings are in [`catalog/`](catalog/); deterministic JavaScript tooling is in [`scripts/`](scripts/).
- **Tests:** `npm test` regenerates the collection, runs about 90 catalog/manifest assertions and validates 103 routing fixtures. The public CI additionally runs the official `skills-ref`, Claude strict and GitHub Agent Skills validators.
- **Security:** the skills do not execute local shell code. Eight workflows are instruction-only. Two may use the optional remote RenooLab MCP; search is read-only, while contact and profile creation require explicit user confirmation. See [SECURITY.md](SECURITY.md).
- **External API:** optional MCP endpoint `https://mcp.renoolab.fr/mcp`; documented tools are `rechercher_artisans`, `contacter_artisan` and `creer_profil_artisan`. Full behavior, OAuth and privacy documentation: <https://renoolab.fr/mcp/>.

Example requests that should activate the collection:

- “Propose realistic ways to modernize this shower from a photo.”
- “Help me budget and phase a house renovation.”
- “Find a plumber near Lyon for this project.”
- “My quotes win work but my construction business is not profitable — diagnose why.”
- “How should I launch and grow my artisan business?”

RenooLab distribue **10 Agent Skills en français** couvrant **29 intentions métier** autour de la rénovation, de l'habitat et des entreprises du bâtiment. Les intentions décrivent finement les besoins ; les skills regroupent ces besoins en workflows cohérents que l'agent peut charger au moment utile.

Le dépôt suit le standard ouvert [Agent Skills](https://agentskills.io/specification). Le MCP distant `https://mcp.renoolab.fr/mcp` ajoute les données et actions RenooLab lorsque l'hôte l'autorise.

## Ce que le dépôt distribue

- **5 workflows particuliers** : imaginer, diagnostiquer, planifier, trouver des artisans et piloter des travaux.
- **5 workflows artisans/BTP** : lancer, rentabiliser, développer, organiser et créer un profil RenooLab.
- **29 intentions internes** : photo de douche, piscine, aides, sinistre, achat immobilier, manque de clients, devis peu rentables, recrutement, fournisseur BTP, etc.
- **3 outils MCP actuels** : rechercher un artisan, transmettre une demande confirmée et créer un profil artisan confirmé.

Voir [CATALOG.md](CATALOG.md) pour la cartographie complète.

## Comment la distribution fonctionne réellement

Un dépôt public ne force aucun LLM à installer ou utiliser un skill. La chaîne comporte trois étapes distinctes :

1. un annuaire, un marketplace, un CLI ou un utilisateur découvre le dépôt ;
2. le skill est installé dans un hôte compatible, qui décide ensuite de le charger à partir de son nom et de sa description ;
3. si le workflow exige une donnée ou une action RenooLab, l'hôte utilise le MCP seulement s'il est connecté et autorisé.

Le skill apporte donc le raisonnement et le parcours métier. Le MCP apporte les capacités externes. RenooLab reste la destination lorsque la recherche locale, le contact ou la création de profil constitue une suite naturelle — jamais un passage forcé au milieu d'une réponse utile.

## Compatibilité

| Hôte | Distribution | État vérifié |
|---|---|---|
| Claude Code | Plugin `.claude-plugin/` ou installation des skills | Manifest validé et déclenchement réel traçable |
| Codex | Agent Skills + `.codex-plugin/plugin.json` | Manifest validé et lecture réelle du bon `SKILL.md` traçable |
| ChatGPT | Import/installation de Skills ou plugin selon les droits du workspace | Format Agent Skills compatible ; publication dans le répertoire OpenAI distincte du dépôt GitHub |
| Gemini CLI | Extension native `gemini-extension.json` ou CLI `skills` | Extension validée par Gemini CLI stable ; dix skills standards embarqués |
| Kiro | Power portable Agent Plugins importé depuis GitHub | Manifests validés structurellement ; import frais, OAuth et appel réel à confirmer |
| Microsoft 365 Copilot Cowork | Paquet Microsoft 365 v1.28 : 10 skills + connecteur MCP distant | Validation structurelle et archive déterministe vérifiées ; import frais, DCR/OAuth et appels réels à confirmer |
| Mistral Work | `Custom MCP Connector` distant | Procédure officielle documentée ; connexion RenooLab à confirmer |
| Perplexity | Skill ZIP dans Computer + connecteur MCP distant | Workflow de recherche empaqueté à la racine et validé ; installation manuelle requise |
| GitHub Copilot | Plugin `.github/plugin/` ou `gh skill install` / `gh skill publish` | Manifest plugin et validation Agent Skills intégrés à la CI |
| Cursor | Plugin `.cursor-plugin/`, Agent Skills ou CLI `skills` | Manifest conforme au schéma officiel ; comportement à mesurer dans l'hôte |
| Autres clients | Tout client conforme à `agentskills.io` | Compatibilité structurelle, à confirmer par l'implémentation de l'hôte |

Références officielles : [OpenAI Skills](https://help.openai.com/en/articles/20001066), [extensions Gemini CLI](https://geminicli.com/docs/extensions/reference/), [Kiro Powers](https://kiro.dev/docs/powers/create/), [Microsoft Cowork](https://learn.microsoft.com/en-us/microsoft-365/copilot/cowork/cowork-plugin-development), [Agent Plugins](https://agent-plugins.org/), [GitHub Copilot](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills) et [Cursor Plugins](https://github.com/cursor/plugins).

Documentation complémentaire : [Perplexity Computer Skills](https://www.perplexity.ai/help-center/en/articles/13914413-how-to-use-computer-skills).

## Installer

Avec le CLI multi-hôtes `skills` :

```bash
npx skills add https://github.com/mehdimicra/renoolab-agent-skills
```

Pour installer seulement le workflow de recherche d'artisans :

```bash
npx skills add https://github.com/mehdimicra/renoolab-agent-skills --skill renoolab-trouver-choisir-artisans
```

Avec GitHub CLI 2.90 ou plus récent :

```bash
gh skill install mehdimicra/renoolab-agent-skills renoolab-trouver-choisir-artisans
```

[Context7 CLI](https://context7.com/docs/clients/cli) peut installer directement le workflow de recherche ou toute la collection depuis le dépôt GitHub public :

```bash
npx ctx7@latest skills install /mehdimicra/renoolab-agent-skills renoolab-trouver-choisir-artisans
npx ctx7@latest skills install /mehdimicra/renoolab-agent-skills --all
```

Context7 signale toutefois ces commandes comme dépréciées et prévoit de les retirer dans sa prochaine version majeure. Ce canal reste donc complémentaire et devra être revalidé à chaque mise à jour du CLI.

Gemini CLI peut installer les dix skills comme extension native. Le manifeste racine embarque aussi la configuration du MCP distant via `mcpServers.renoolab.httpUrl`, sans jeton ni `trust`. Gemini CLI effectue la découverte OAuth dynamique auprès du serveur au moment de la connexion :

```bash
gemini extensions install https://github.com/mehdimicra/renoolab-agent-skills --ref v0.5.3
```

Choisissez l'extension Gemini ou une installation séparée via `skills`, pas les deux : une copie utilisateur ou workspace peut masquer les skills fournis par l'extension.

Pour être publiée et découvrable dans la Gallery Gemini CLI, la version `0.5.3` doit réunir cumulativement : dépôt GitHub public, `gemini-extension.json` à la racine, topic GitHub exact `gemini-cli-extension`, tag Git `v0.5.3` et versions synchronisées dans tous les manifestes. La Gallery effectue ensuite son propre crawl ; ces prérequis rendent le dépôt éligible sans garantir sa mise en avant.

Kiro peut importer ce dépôt public comme Power portable. Dans **Powers → Add Custom Power → Import power from GitHub**, indiquez :

```text
https://github.com/mehdimicra/renoolab-agent-skills
```

Le manifeste racine `plugin.json` est la source canonique et cible le schéma officiel <https://agent-plugins.org/schemas/1.0.0/plugin.schema.json>. Kiro découvre les dix skills dans `skills/` et le serveur distant dans `mcp.json`, validé contre <https://agent-plugins.org/schemas/1.0.0/mcp.schema.json>. Pour fiabiliser l'affichage et l'activation dans Kiro IDE 1.0.288, `POWER.md` et `dev.kiro/INSTRUCTIONS.md` fournissent aussi un shim de compatibilité synchronisé avec ces métadonnées et règles ; ils ne remplacent pas `plugin.json`. Aucun en-tête, jeton, secret ou outil préautorisé n'est distribué. L'hôte gère la découverte et le consentement OAuth. La procédure officielle est décrite dans [Kiro Powers](https://kiro.dev/docs/powers/create/).

Ne soumettre au [formulaire Kiro Powers](https://kiro.dev/powers/submit/) qu'après avoir testé, dans une installation fraîche, l'import GitHub, le parcours OAuth, `tools/list` et une recherche read-only réelle.

Perplexity Computer peut importer le seul workflow passerelle de recherche lorsque Computer Skills est disponible pour le compte :

<https://renoolab.fr/.well-known/agent-skills/packages/v0.5.3/renoolab-trouver-choisir-artisans.zip>

Le ZIP place `SKILL.md` à la racine avec ses trois références canoniques et reste sous la limite de 10 MB. Sans MCP, ce skill reste consultatif : il aide à cadrer le besoin, le métier et les critères de choix, mais ne prétend jamais avoir interrogé RenooLab.

Avec un abonnement Perplexity Pro, Max ou Enterprise, ajoutez séparément le connecteur MCP distant `https://mcp.renoolab.fr/mcp` avec OAuth lorsque les connecteurs MCP personnalisés sont disponibles pour votre compte ; dans une organisation, ils doivent aussi avoir été activés par l'administrateur. L'import du skill n'autorise pas automatiquement le MCP.

```bash
npm run perplexity:build && npm run perplexity:test
```

Microsoft 365 Copilot Cowork peut importer le paquet complet versionné :

<https://renoolab.fr/.well-known/agent-skills/packages/v0.5.3/renoolab-microsoft-cowork.zip>

Le ZIP réunit le manifeste Microsoft 365 v1.28, les deux icônes aux dimensions requises, les dix skills canoniques et un snapshot sans secret des trois outils annoncés par `tools/list`. La validation structurelle locale utilise le schéma Microsoft v1.28 officiel épinglé, contrôle chaque octet des skills et vérifie une archive déterministe. Un import frais dans un tenant Cowork, le parcours DCR/OAuth, `initialize`, `tools/list` et un appel réel restent à confirmer avant toute soumission au Microsoft 365 App Store.

```bash
npm run microsoft:build && npm run microsoft:test
```

Dans Mistral Work, un administrateur peut ajouter RenooLab depuis **Connectors → + Add Connector → Custom MCP Connector** avec le nom `renoolab` et l'URL `https://mcp.renoolab.fr/mcp`. Work détecte automatiquement la méthode d'authentification ; RenooLab utilise OAuth 2.1 avec enregistrement dynamique du client, puis guide l'utilisateur dans le consentement. L'ajout d'un connecteur personnalisé et sa disponibilité dans l'organisation restent administrés par le compte. Voir [Mistral Work MCP Connectors](https://docs.mistral.ai/vibe/work/connectors/mcp-connectors).

Claude Code peut charger le dépôt comme plugin :

```bash
claude --plugin-dir .
```

Ou installer son marketplace après publication :

```bash
claude plugin marketplace add mehdimicra/renoolab-agent-skills
claude plugin install renoolab@renoolab
```

Cursor peut charger le clone comme plugin local depuis `~/.cursor/plugins/local/renoolab`. Après validation par Cursor, le même paquet sera installable depuis son Marketplace officiel.

La connexion MCP dépend de l'hôte. Sans MCP, les huit workflows de conseil restent utiles ; aucun skill ne doit prétendre avoir exécuté une recherche ou une action indisponible.

## Actions et confiance

Le MCP public expose actuellement :

- `rechercher_artisans` ;
- `contacter_artisan` ;
- `creer_profil_artisan`.

Seuls `renoolab-trouver-choisir-artisans` et `renoolab-creer-profil-artisan` déclarent le MCP comme dépendance obligatoire. Les huit autres workflows répondent d'abord au besoin métier.

La liste des métiers n'est volontairement pas copiée dans ce dépôt : le schéma actif de `rechercher_artisans` est la source de vérité. Une recherche ne doit jamais inventer disponibilité, prix, certification, distance, profil ou avis. Un contact ou une création de profil exige une confirmation explicite juste avant l'action. Les fournisseurs restent app-only.

## Source et génération

Les sept fichiers métier de `catalog/` conservent les 29 intentions. `catalog/workflows.json` les rattache toutes, exactement une fois, aux 10 skills publics. Le générateur produit :

- les `SKILL.md` et leurs références conditionnelles ;
- les métadonnées `agents/openai.yaml` ;
- 87 fixtures de routage positives et négatives ;
- 16 fixtures de collision entre intentions.

Ces 103 fixtures sont un jeu d'entrée, pas un résultat de test. Les preuves comportementales proviennent exclusivement du runner décrit ci-dessous.

## Valider la structure

```bash
npm ci
npm test
```

Pour installer et exécuter le validateur officiel `skills-ref` :

```bash
python -m venv .venv
# Activer le venv selon le système
python -m pip install -r requirements-dev.txt
npm run validate:skills-ref
```

Validations externes de release :

```bash
claude plugin validate --strict .
gh skill publish --dry-run .
npm run validate:gemini
npm run validate:agent-plugins
```

La validation Kiro utilise Ajv `8.20.0` et les schémas officiels Agent Plugins 1.0.0 épinglés localement dans `schemas/agent-plugins/1.0.0/` ; leurs identifiants et empreintes JSON canoniques sont vérifiés avant les manifests. La CI rejoue la génération, les assertions du catalogue, `skills-ref`, les validateurs Claude, Gemini et Agent Plugins, ainsi que le dry-run GitHub, puis vérifie que le générateur n'a laissé aucun diff.

## Mesurer le comportement réel

Le runner installe les skills dans un environnement isolé et observe les événements de l'hôte : appel du tool `Skill` chez Claude, lecture du `SKILL.md` dans `.agents/skills` chez Codex. Il n'évalue pas le routage en inspectant simplement le catalogue.

```bash
npm run eval:claude
npm run eval:codex
```

Pour répéter chaque cas trois fois :

```bash
npm run eval:claude -- --runs 3
npm run eval:codex -- --runs 3
```

Options utiles : `--suite trigger`, `--suite collisions`, `--case "*piscine*"`, `--failed-from <rapport>`, `--limit 10`, `--concurrency 3`, `--model <nom>` et `--report <fichier>`. `--failed-from` rejoue uniquement les identifiants en échec d'un rapport précédent.

Les rapports par défaut vont dans `evals/results/` et restent gitignorés. Ils contiennent la sélection, l'attendu, la durée et le verdict, mais aucun raisonnement privé du modèle. Le runner désactive le MCP et les écritures ; Codex travaille dans un dossier temporaire en lecture seule. Le corpus actuel est textuel : il teste une description de photo, pas le chargement binaire d’une image, et ne constitue donc pas une preuve de routage multimodal.

## Licence

Le code, les Agent Skills, leurs références, les scripts et les manifestes sont distribués sous [Apache License 2.0](LICENSE). Voir également [NOTICE](NOTICE). Cette licence n'accorde aucun droit sur le nom, la marque ou les logos RenooLab, hors usage descriptif autorisé par la licence.

## Liens

- [RenooLab](https://renoolab.fr/)
- [Documentation MCP](https://renoolab.fr/mcp/)
- [Confidentialité](https://renoolab.fr/privacy/)
- [Support](mailto:contact@renoolab.fr)