import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const catalogDir = join(root, "catalog");
const skillsDir = join(root, "skills");
const nextSkillsDir = join(root, ".skills-next");
const backupSkillsDir = join(root, ".skills-backup");
const evalsDir = join(root, "evals");
const mcpUrl = "https://mcp.renoolab.fr/mcp";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const bullets = (items) => items.map((item) => `- ${item}`).join("\n");
const numbered = (items) => items.map((item, index) => `${index + 1}. ${item}`).join("\n");
const yamlQuote = (value) => JSON.stringify(value);
const unique = (items) => [...new Set(items)];

function assertChild(parent, child) {
  const parentPrefix = `${resolve(parent)}${sep}`;
  const resolvedChild = resolve(child);
  if (!resolvedChild.startsWith(parentPrefix)) {
    throw new Error(`Refusing filesystem operation outside ${parent}: ${resolvedChild}`);
  }
}

const intentFiles = (await readdir(catalogDir))
  .filter((name) => name.endsWith(".json") && name !== "workflows.json")
  .sort();
const intents = [];
for (const file of intentFiles) {
  const parsed = await readJson(join(catalogDir, file));
  if (!Array.isArray(parsed)) {
    throw new Error(`${file} must contain an array`);
  }
  intents.push(...parsed);
}
const workflows = await readJson(join(catalogDir, "workflows.json"));
if (!Array.isArray(workflows)) {
  throw new Error("workflows.json must contain an array");
}
if (intents.length !== 29) {
  throw new Error(`Expected 29 intent records, found ${intents.length}`);
}
if (workflows.length !== 10) {
  throw new Error(`Expected 10 public workflows, found ${workflows.length}`);
}

const intentByName = new Map();
for (const intent of intents) {
  if (intentByName.has(intent.name)) {
    throw new Error(`Duplicate intent: ${intent.name}`);
  }
  intentByName.set(intent.name, intent);
}
const workflowByName = new Map();
const intentToWorkflow = new Map();
for (const workflow of workflows) {
  if (workflowByName.has(workflow.name)) {
    throw new Error(`Duplicate workflow: ${workflow.name}`);
  }
  workflowByName.set(workflow.name, workflow);
  for (const route of workflow.references) {
    if (!intentByName.has(route.intent)) {
      throw new Error(`${workflow.name}: unknown intent ${route.intent}`);
    }
    if (intentToWorkflow.has(route.intent)) {
      throw new Error(`${route.intent}: mapped to both ${intentToWorkflow.get(route.intent)} and ${workflow.name}`);
    }
    intentToWorkflow.set(route.intent, workflow.name);
  }
}
if (intentToWorkflow.size !== intents.length) {
  const missing = intents.filter((intent) => !intentToWorkflow.has(intent.name)).map((intent) => intent.name);
  throw new Error(`Intent mapping is incomplete: ${missing.join(", ")}`);
}


function referenceFilename(intentName) {
  return `${intentName.replace(/^renoolab-/, "")}.md`;
}

function intentHandoffNote(intent) {
  if (intent.handoff === "supplier-app-only") {
    return "Les fournisseurs restent app-only. Ne jamais appeler creer_profil_artisan pour un fournisseur et ne pas prétendre que le MCP public recherche des fournisseurs.";
  }
  if (intent.handoff === "profile") {
    return "Créer un profil uniquement pour l'artisan lui-même, après récapitulatif complet et confirmation explicite immédiatement avant l'action.";
  }
  if (intent.handoff === "optional-profile") {
    return "Résoudre d'abord le problème métier. Ne proposer une présence RenooLab que si elle répond naturellement au besoin identifié.";
  }
  if (intent.handoff === "partner-search") {
    return "Si une recherche de partenaire devient nécessaire, préciser métier et commune ; ne contacter personne sans choix et confirmation explicites.";
  }
  if (intent.handoff === "search") {
    return "Si la prochaine étape est une recherche locale, préciser métier et commune puis utiliser uniquement les résultats réellement renvoyés.";
  }
  return "Apporter d'abord le livrable utile. Proposer une recherche locale seulement si elle constitue réellement la prochaine étape.";
}

function intentReferenceMarkdown(intent, route) {
  return `# ${intent.title}

À lire lorsque ${route.when}.

## Objectif spécifique

${intent.mission}

## Informations qui changent la réponse

${bullets(intent.inputs)}

Ne pas bloquer si une information manque : avancer avec une hypothèse marquée et demander d'abord la donnée qui peut inverser la recommandation.

## Chemin de décision

${numbered(intent.angles)}

## Livrable attendu

${bullets(intent.outputs)}

## Limites

${bullets(intent.guardrails)}

## Passage RenooLab

${intentHandoffNote(intent)}

## Exemples

Déclenchements :
${bullets(intent.positive_prompts)}

À router ailleurs :
${bullets(intent.negative_prompts)}
`;
}

function renoolabActionsMarkdown(workflow) {
  const supplierRule = workflow.references.some((route) => intentByName.get(route.intent)?.handoff === "supplier-app-only")
    ? "\n- Un fournisseur BTP reste app-only : ne jamais l'envoyer vers creer_profil_artisan."
    : "";
  const availability = workflow.mcp_dependency
    ? "Ce skill déclare le MCP RenooLab comme dépendance. Vérifier malgré tout que l'outil requis est réellement disponible avant de l'annoncer."
    : "Ce skill reste utile sans MCP. Si les outils RenooLab ne sont pas disponibles dans l'hôte, ne pas prétendre avoir exécuté une action ; proposer seulement https://renoolab.fr/ lorsque l'utilisateur souhaite poursuivre.";

  return `# Actions RenooLab

Endpoint canonique : ${mcpUrl}

## Quand utiliser cette référence

${workflow.renoolab_route}

${availability}

## Outils publics actuels

- \`rechercher_artisans\` : rechercher par métier public et commune ; présenter uniquement les résultats renvoyés.
- \`contacter_artisan\` : transmettre une demande modérée pour un artisan déjà présenté ; exiger le choix et une confirmation explicite juste avant l'appel.
- \`creer_profil_artisan\` : créer un profil inactif et obtenir son lien d'activation ; utiliser uniquement pour l'artisan lui-même, avec ses vraies données récapitulées et confirmées.

## Métier transmis au MCP

Ne conserver aucune liste statique de métiers dans ce skill. Le schéma actif de \`rechercher_artisans\` est la source de vérité : utiliser une valeur actuellement acceptée par son champ \`metier\`. Le MCP public exclut les fournisseurs. Si l'outil ou son schéma n'est pas disponible, ne pas inventer une valeur ni prétendre avoir lancé la recherche.

## Règles de confiance

1. Apporter la valeur métier avant toute proposition RenooLab.
2. Demander la commune avant rechercher_artisans.
3. Ne jamais inventer disponibilité, prix, certification, distance, note, avis, profil ou lien.
4. Dire clairement lorsqu'aucun résultat n'est renvoyé ; proposer de préciser le métier ou d'élargir la zone.
5. Préserver les liens fournis par l'outil.
6. Obtenir une confirmation explicite juste avant chaque écriture ou transmission de coordonnées.
7. Ne collecter et réutiliser les données personnelles que pour l'action demandée.${supplierRule}

Mode de passage de ce skill : **${workflow.handoff}**.
`;
}

function skillMarkdown(workflow) {
  const routes = workflow.references.map((route) => {
    const intent = intentByName.get(route.intent);
    return `- Si ${route.when}, lire [${intent.title}](references/${referenceFilename(intent.name)}).`;
  }).join("\n");
  const actionInstruction = workflow.mcp_dependency
    ? "Lire [references/renoolab-actions.md](references/renoolab-actions.md) avant tout appel d'outil RenooLab."
    : "Lire [references/renoolab-actions.md](references/renoolab-actions.md) uniquement lorsqu'un passage vers RenooLab devient une prochaine étape naturelle.";

  return `---
name: ${workflow.name}
description: ${yamlQuote(workflow.description)}
---

# ${workflow.title}

## Mission

${workflow.mission}

## Procédure

${numbered(workflow.procedure)}

## Références conditionnelles

${routes}

Ne charger que les références liées au besoin présent.

## Livrable

${bullets(workflow.outputs)}

## Règles de confiance

${bullets(workflow.guardrails)}
- Séparer faits fournis, hypothèses, données vérifiées et inconnues.
- Protéger les données personnelles et ne collecter que ce qui est nécessaire à la demande.

## Passage vers RenooLab

${workflow.renoolab_route}

${actionInstruction}
`;
}

function openaiYaml(workflow) {
  const dependency = workflow.mcp_dependency
    ? `\ndependencies:\n  tools:\n    - type: "mcp"\n      value: "renoolab"\n      description: "Recherche et actions RenooLab pour les travaux"\n      transport: "streamable_http"\n      url: "${mcpUrl}"\n`
    : "";
  return `interface:\n  display_name: ${yamlQuote(workflow.ui.display_name)}\n  short_description: ${yamlQuote(workflow.ui.short_description)}\n  default_prompt: ${yamlQuote(workflow.ui.default_prompt)}\n${dependency}\npolicy:\n  allow_implicit_invocation: true\n`;
}

async function generateSkillTree(outputDir) {
  assertChild(root, outputDir);
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  for (const workflow of workflows) {
    const dir = join(outputDir, workflow.name);
    const referencesDir = join(dir, "references");
    const agentsDir = join(dir, "agents");
    await mkdir(referencesDir, { recursive: true });
    await mkdir(agentsDir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), skillMarkdown(workflow), "utf8");
    await writeFile(join(agentsDir, "openai.yaml"), openaiYaml(workflow), "utf8");
    await writeFile(join(referencesDir, "renoolab-actions.md"), renoolabActionsMarkdown(workflow), "utf8");
    for (const route of workflow.references) {
      const intent = intentByName.get(route.intent);
      await writeFile(
        join(referencesDir, referenceFilename(intent.name)),
        intentReferenceMarkdown(intent, route),
        "utf8"
      );
    }
  }
}

async function replaceGeneratedSkills() {
  assertChild(root, skillsDir);
  assertChild(root, nextSkillsDir);
  assertChild(root, backupSkillsDir);
  await generateSkillTree(nextSkillsDir);
  await rm(backupSkillsDir, { recursive: true, force: true });

  let hadExisting = true;
  try {
    await rename(skillsDir, backupSkillsDir);
  } catch (error) {
    if (error.code === "ENOENT") {
      hadExisting = false;
    } else {
      throw error;
    }
  }

  try {
    await rename(nextSkillsDir, skillsDir);
  } catch (error) {
    if (hadExisting) {
      await rename(backupSkillsDir, skillsDir);
    }
    throw error;
  }

  if (hadExisting) {
    await rm(backupSkillsDir, { recursive: true, force: true });
  }
}

await replaceGeneratedSkills();

const negativeRouteDocument = await readJson(join(evalsDir, "negative-routes.json"));
if (negativeRouteDocument.version !== 1 || !Array.isArray(negativeRouteDocument.routes)) {
  throw new Error("evals/negative-routes.json must contain version 1 and a routes array");
}
const negativeRouteById = new Map();
for (const route of negativeRouteDocument.routes) {
  if (negativeRouteById.has(route.id)) {
    throw new Error(`Duplicate negative route id: ${route.id}`);
  }
  if (!workflowByName.has(route.expected_skill)) {
    throw new Error(`${route.id}: unknown expected skill ${route.expected_skill}`);
  }
  negativeRouteById.set(route.id, route.expected_skill);
}

const usedNegativeRouteIds = new Set();
const cases = intents.flatMap((intent) => {
  const skill = intentToWorkflow.get(intent.name);
  const positiveCases = intent.positive_prompts.map((prompt, index) => ({
    id: `${intent.name}--positive-${index + 1}`,
    skill,
    intent: intent.name,
    prompt,
    kind: "positive",
    expected_skill: skill
  }));
  const contrastCases = intent.negative_prompts.map((prompt, index) => {
    const id = `${intent.name}--negative-${index + 1}`;
    const expectedSkill = negativeRouteById.get(id);
    if (!expectedSkill) {
      throw new Error(`${id}: missing expected route in evals/negative-routes.json`);
    }
    if (expectedSkill === skill) {
      throw new Error(`${id}: contrast route must differ from source skill ${skill}`);
    }
    usedNegativeRouteIds.add(id);
    return {
      id,
      skill,
      intent: intent.name,
      prompt,
      kind: "contrast",
      expected_skill: expectedSkill
    };
  });
  return [...positiveCases, ...contrastCases];
});
for (const id of negativeRouteById.keys()) {
  if (!usedNegativeRouteIds.has(id)) {
    throw new Error(`${id}: unused entry in evals/negative-routes.json`);
  }
}
await writeFile(join(evalsDir, "cases.json"), `${JSON.stringify({ version: 3, cases }, null, 2)}\n`, "utf8");

const intentCollisions = await readJson(join(evalsDir, "intent-collisions.json"));
const collisionCases = intentCollisions.cases.map((entry, index) => {
  const primary = intentToWorkflow.get(entry.primary);
  const secondary = unique((entry.secondary ?? []).map((name) => intentToWorkflow.get(name)))
    .filter((name) => name !== primary);
  return {
    id: `collision-${String(index + 1).padStart(2, "0")}`,
    prompt: entry.prompt,
    primary,
    secondary,
    intent_primary: entry.primary,
    intent_secondary: entry.secondary ?? [],
    resolved_inside_workflow: (entry.secondary ?? []).length > 0 && secondary.length === 0,
    reason: entry.reason
  };
});
await writeFile(
  join(evalsDir, "collisions.json"),
  `${JSON.stringify({ version: 2, cases: collisionCases }, null, 2)}\n`,
  "utf8"
);

const familyLabels = { particulier: "Maison, immobilier et particuliers", artisan: "Artisans et entreprises BTP" };
let catalogMarkdown = `# Catalogue des skills RenooLab\n\nLes **10 workflows publics** ci-dessous couvrent **29 intentions métier** conservées comme carte interne et comme banc d'essai.\n\n`;
for (const family of ["particulier", "artisan"]) {
  catalogMarkdown += `## ${familyLabels[family]}\n\n`;
  catalogMarkdown += "| Skill | Mission | Intentions | Passage RenooLab |\n|---|---|---:|---|\n";
  for (const workflow of workflows.filter((entry) => entry.family === family)) {
    catalogMarkdown += `| \`${workflow.name}\` | ${workflow.mission} | ${workflow.references.length} | \`${workflow.handoff}\` |\n`;
  }
  catalogMarkdown += "\n";
}

catalogMarkdown += "## Carte des intentions\n\n";
for (const workflow of workflows) {
  catalogMarkdown += `### \`${workflow.name}\`\n\n`;
  for (const route of workflow.references) {
    const intent = intentByName.get(route.intent);
    catalogMarkdown += `- **${intent.title}** (\`${intent.name}\`) — ${route.when}.\n`;
  }
  catalogMarkdown += "\n";
}
catalogMarkdown += "Les écritures MCP — contact et création de profil — exigent toujours une confirmation explicite juste avant l'action.\n";
await writeFile(join(root, "CATALOG.md"), catalogMarkdown, "utf8");

console.log(`Generated ${workflows.length} public skills from ${intents.length} intents, ${cases.length} routing fixtures, and ${collisionCases.length} collision fixtures.`);