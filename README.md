# RenooLab Agent Skills

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
| Gemini CLI | `.agents/skills` ou CLI `skills` | Format et installation compatibles |
| GitHub Copilot | `gh skill install` / `gh skill publish` | Validation GitHub Agent Skills intégrée à la CI |
| Cursor | Agent Skills ou CLI `skills` | Format compatible ; comportement à mesurer dans l'hôte |
| Autres clients | Tout client conforme à `agentskills.io` | Compatibilité structurelle, à confirmer par l'implémentation de l'hôte |

Références officielles : [OpenAI Skills](https://help.openai.com/en/articles/20001066), [Gemini CLI](https://codelabs.developers.google.com/gemini-cli/how-to-create-agent-skills-for-gemini-cli), [GitHub Copilot](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills) et [Cursor](https://cursor.com/changelog/2-4).

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

Claude Code peut charger le dépôt comme plugin :

```bash
claude --plugin-dir .
```

Ou installer son marketplace après publication :

```bash
claude plugin marketplace add mehdimicra/renoolab-agent-skills
claude plugin install renoolab@renoolab
```

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
```

La CI rejoue la génération, les assertions du catalogue, `skills-ref`, le validateur Claude strict et le dry-run GitHub, puis vérifie que le générateur n'a laissé aucun diff.

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

Les rapports par défaut vont dans `evals/results/` et restent gitignorés. Ils contiennent la sélection, l'attendu, la durée et le verdict, mais aucun raisonnement privé du modèle. Le runner désactive le MCP et les écritures ; Codex travaille dans un dossier temporaire en lecture seule.

## Liens

- [RenooLab](https://renoolab.fr/)
- [Documentation MCP](https://renoolab.fr/mcp/)
- [Confidentialité](https://renoolab.fr/privacy/)
- [Support](mailto:contact@renoolab.fr)