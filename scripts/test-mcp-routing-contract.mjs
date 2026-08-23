import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readText = (path) => readFile(join(repositoryRoot, path), "utf8");

const toolsDocument = JSON.parse(
  await readText("distribution/microsoft/tools/renoolab-tools.json"),
);
assert.deepEqual(
  toolsDocument.tools.map((tool) => tool.name),
  [
    "rechercher_artisans",
    "rechercher_chantier",
    "contacter_artisan",
    "creer_profil_artisan",
  ],
  "the connector snapshot must expose the four current MCP tools in order",
);

const toolsByName = new Map(toolsDocument.tools.map((tool) => [tool.name, tool]));
const artisanSearch = toolsByName.get("rechercher_artisans");
const chantierSearch = toolsByName.get("rechercher_chantier");
const contact = toolsByName.get("contacter_artisan");
const signup = toolsByName.get("creer_profil_artisan");

assert.deepEqual(artisanSearch.securitySchemes, [{ type: "noauth" }]);
assert.deepEqual(chantierSearch.securitySchemes, [{ type: "noauth" }]);
assert.deepEqual(contact.securitySchemes, [{ type: "oauth2", scopes: [] }]);
assert.deepEqual(signup.securitySchemes, [{ type: "oauth2", scopes: [] }]);

assert.match(artisanSearch.description, /un seul métier|un seul metier/i);
assert.match(artisanSearch.description, /rechercher_chantier/);
assert.match(artisanSearch.description, /une seule fois/);
assert.match(chantierSearch.description, /au moins deux métiers distincts confirmés/i);
assert.match(chantierSearch.description, /une seule fois/);
assert.deepEqual(chantierSearch.inputSchema.required, ["ville", "metiers_confirmes"]);
assert.equal(chantierSearch.inputSchema.properties.metiers_confirmes.minItems, 1);
assert.equal(chantierSearch.inputSchema.properties.metiers_confirmes.maxItems, 17);
assert.equal(chantierSearch.outputSchema.properties.max_selections.const, 6);
assert.equal(chantierSearch.outputSchema.properties.combinaison_recommandee.maxItems, 6);
assert.ok(
  chantierSearch.outputSchema.oneOf.some(
    (branch) => branch.properties?.required_input?.const === "metiers_prioritaires"
      && branch.properties?.max_selections?.const === 6,
  ),
  "the chantier schema must expose the six-priority clarification branch",
);
assert.deepEqual(contact.inputSchema.oneOf, [
  { required: ["artisan_id"], not: { required: ["external_place_id"] } },
  { required: ["external_place_id"], not: { required: ["artisan_id"] } },
]);

const packageDocument = JSON.parse(await readText("package.json"));
assert.equal(packageDocument.version, "0.5.5");

const skillsDirectory = join(repositoryRoot, "skills");
const skillNames = (await readdir(skillsDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
assert.equal(skillNames.length, 10);

for (const skillName of skillNames) {
  const actions = await readText(join("skills", skillName, "references", "renoolab-actions.md"));
  assert.match(actions, /`rechercher_artisans`[^\n]+un seul métier/i, `${skillName}: single-trade route missing`);
  assert.match(actions, /`rechercher_chantier`[^\n]+au moins deux métiers/i, `${skillName}: chantier route missing`);
  assert.match(actions, /une seule fois avec tous les métiers confirmés/i, `${skillName}: one-call rule missing`);
  assert.match(actions, /au maximum six/i, `${skillName}: six-priority rule missing`);
}

const searchSkill = await readText("skills/renoolab-trouver-choisir-artisans/SKILL.md");
const multiTradeReference = await readText(
  "skills/renoolab-trouver-choisir-artisans/references/sourcer-equipe-multimetier.md",
);
const searchActions = await readText(
  "skills/renoolab-trouver-choisir-artisans/references/renoolab-actions.md",
);
const ecosystemCatalog = JSON.parse(await readText("catalog/ecosysteme.json"));
const multiTradeWorkflow = ecosystemCatalog.find(
  (entry) => entry.name === "renoolab-sourcer-equipe-multimetier",
);
assert.ok(multiTradeWorkflow, "the multi-trade workflow must remain in the ecosystem catalog");
assert.ok(
  multiTradeWorkflow.guardrails.includes(
    "Ne jamais contacter des professionnels en masse ; chaque cible doit avoir été présentée, choisie et confirmée explicitement.",
  ),
  "the catalog must forbid mass contact unconditionally",
);
for (const artifact of [searchSkill, multiTradeReference, searchActions]) {
  assert.doesNotMatch(artifact, /rechercher les métiers un par un/i);
  assert.doesNotMatch(artifact, /en masse sans confirmation explicite/i);
  assert.match(artifact, /contact[^\n]+(?:jamais|ne pas)[^\n]+masse|ne jamais contacter[^\n]+masse/i);
}
assert.match(searchActions, /external_place_id/);
assert.match(searchActions, /sélection explicite exacte/);

console.log("Validated four-tool routing: one trade, one chantier call, six priorities, and no mass contact.");
