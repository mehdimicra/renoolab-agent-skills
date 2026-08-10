import { access, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const catalogDir = join(root, "catalog");
const skillsRoot = join(root, "skills");
const expectedMcpUrl = "https://mcp.renoolab.fr/mcp";
const errors = [];
const fail = (message) => errors.push(message);
const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const referenceFilename = (intentName) => `${intentName.replace(/^renoolab-/, "")}.md`;

const intents = [];
for (const file of (await readdir(catalogDir)).filter((name) => name.endsWith(".json") && name !== "workflows.json").sort()) {
  try {
    const data = await readJson(join(catalogDir, file));
    if (!Array.isArray(data)) {
      fail(`${file}: root must be an array`);
    }
    else {
      intents.push(...data);
    }
  } catch (error) {
    fail(`${file}: invalid JSON (${error.message})`);
  }
}
let workflows = [];
try {
  workflows = await readJson(join(catalogDir, "workflows.json"));
  if (!Array.isArray(workflows)) {
    fail("workflows.json: root must be an array");
    workflows = [];
  }
} catch (error) {
  fail(`workflows.json: invalid JSON (${error.message})`);
}

if (intents.length !== 29) {
  fail(`catalog: expected 29 intents, found ${intents.length}`);
}
if (workflows.length !== 10) {
  fail(`workflows: expected 10 public skills, found ${workflows.length}`);
}

const intentByName = new Map();
for (const intent of intents) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(intent.name) || intent.name.length > 64) {
    fail(`${intent.name}: invalid intent name`);
  }
  if (intentByName.has(intent.name)) {
    fail(`${intent.name}: duplicate intent name`);
  }
  intentByName.set(intent.name, intent);
  if (!intent.description || intent.description.length > 1024) {
    fail(`${intent.name}: description must be 1..1024 chars`);
  }
  for (const field of ["inputs", "angles", "outputs", "guardrails", "positive_prompts", "negative_prompts"]) {
    if (!Array.isArray(intent[field]) || intent[field].length === 0) {
      fail(`${intent.name}: ${field} must be non-empty`);
    }
  }
}

const workflowByName = new Map();
const intentToWorkflow = new Map();
for (const workflow of workflows) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(workflow.name) || workflow.name.length > 64) {
    fail(`${workflow.name}: invalid workflow name`);
  }
  if (workflowByName.has(workflow.name)) {
    fail(`${workflow.name}: duplicate workflow name`);
  }
  workflowByName.set(workflow.name, workflow);
  if (!workflow.description || workflow.description.length > 1024) {
    fail(`${workflow.name}: description must be 1..1024 chars`);
  }
  if (!workflow.mission || !workflow.renoolab_route) {
    fail(`${workflow.name}: mission and renoolab_route are required`);
  }
  for (const field of ["procedure", "outputs", "guardrails", "references"]) {
    if (!Array.isArray(workflow[field]) || workflow[field].length === 0) {
      fail(`${workflow.name}: ${field} must be non-empty`);
    }
  }
  const ui = workflow.ui ?? {};
  if (!ui.display_name) {
    fail(`${workflow.name}: ui.display_name is required`);
  }
  if (!ui.short_description || ui.short_description.length < 25 || ui.short_description.length > 64) {
    fail(`${workflow.name}: ui.short_description must be 25..64 chars`);
  }
  if (!ui.default_prompt?.includes(`$${workflow.name}`)) {
    fail(`${workflow.name}: ui.default_prompt must mention $${workflow.name}`);
  }
  for (const route of workflow.references ?? []) {
    if (!route.intent || !route.when) {
      fail(`${workflow.name}: every reference needs intent and when`);
    }
    if (!intentByName.has(route.intent)) {
      fail(`${workflow.name}: unknown intent ${route.intent}`);
    }
    if (intentToWorkflow.has(route.intent)) {
      fail(`${route.intent}: mapped more than once`);
    }
    intentToWorkflow.set(route.intent, workflow.name);
  }
}
for (const intent of intents) {
  if (!intentToWorkflow.has(intent.name)) {
    fail(`${intent.name}: not mapped to a public workflow`);
  }
}

const directMcpWorkflows = new Set([
  "renoolab-trouver-choisir-artisans",
  "renoolab-creer-profil-artisan"
]);
const configuredMcp = workflows.filter((workflow) => workflow.mcp_dependency).map((workflow) => workflow.name).sort();
if (configuredMcp.length !== directMcpWorkflows.size || configuredMcp.some((name) => !directMcpWorkflows.has(name))) {
  fail(`MCP dependencies must be limited to ${[...directMcpWorkflows].join(", ")}; found ${configuredMcp.join(", ")}`);
}

const initialCatalogChars = workflows.reduce(
  (total, workflow) => total + workflow.name.length + workflow.description.length + `skills/${workflow.name}/SKILL.md`.length,
  0
);
if (initialCatalogChars > 7000) {
  fail(`initial skill catalog budget exceeded: ${initialCatalogChars} chars > 7000`);
}

let dirs = [];
try {
  dirs = (await readdir(skillsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
} catch (error) {
  fail(`skills/: ${error.message}`);
}
if (dirs.length !== 10) {
  fail(`skills/: expected 10 directories, found ${dirs.length}`);
}
for (const dir of dirs) {
  if (!workflowByName.has(dir)) {
    fail(`${dir}: directory missing from workflow catalog`);
  }
}

for (const workflow of workflows) {
  const dir = join(skillsRoot, workflow.name);
  for (const relative of ["SKILL.md", "agents/openai.yaml", "references/renoolab-actions.md"]) {
    if (!(await exists(join(dir, relative)))) {
      fail(`${workflow.name}: missing ${relative}`);
    }
  }
  const expectedReferences = new Set([
    "renoolab-actions.md",
    ...workflow.references.map((route) => referenceFilename(route.intent))
  ]);
  if (await exists(join(dir, "references"))) {
    const actualReferences = (await readdir(join(dir, "references"), { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
    for (const name of actualReferences) {
      if (!expectedReferences.has(name)) {
        fail(`${workflow.name}: stale reference ${name}`);
      }
    }
    for (const name of expectedReferences) {
      if (!actualReferences.includes(name)) {
        fail(`${workflow.name}: missing references/${name}`);
      }
    }
  }

  if (!(await exists(join(dir, "SKILL.md")))) {
    continue;
  }
  const markdown = await readFile(join(dir, "SKILL.md"), "utf8");
  if (markdown.includes("TODO") || markdown.includes("[TODO:")) {
    fail(`${workflow.name}: TODO placeholder remains`);
  }
  if (markdown.split(/\r?\n/).length > 500) {
    fail(`${workflow.name}: SKILL.md exceeds 500 lines`);
  }
  const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontmatter) {
    fail(`${workflow.name}: malformed frontmatter`);
  } else {
    const frontmatterKeys = frontmatter[1].split("\n").map((line) => line.split(":", 1)[0].trim()).filter(Boolean);
    if (frontmatterKeys.join(",") !== "name,description,license") {
      fail(`${workflow.name}: frontmatter must contain only name, description and license`);
    }
    const name = frontmatter[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
    const descriptionLine = frontmatter[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
    if (name !== workflow.name) {
      fail(`${workflow.name}: frontmatter name mismatch`);
    }
    if (!descriptionLine?.startsWith('"') || !descriptionLine.endsWith('"')) {
      fail(`${workflow.name}: description must be YAML-quoted`);
    }
    const license = frontmatter[1].match(/^license:\s*(.+)$/m)?.[1]?.trim();
    if (license !== "Apache-2.0") {
      fail(`${workflow.name}: frontmatter license must be Apache-2.0`);
    }
  }
  for (const route of workflow.references) {
    const filename = referenceFilename(route.intent);
    if (!markdown.includes(`](references/${filename})`)) {
      fail(`${workflow.name}: SKILL.md does not link references/${filename}`);
    }
  }
  if (!markdown.includes("](references/renoolab-actions.md)")) {
    fail(`${workflow.name}: actions reference is not linked`);
  }

  const yamlPath = join(dir, "agents", "openai.yaml");
  if (!(await exists(yamlPath))) {
    continue;
  }
  const yaml = await readFile(yamlPath, "utf8");
  if (!yaml.includes(`$${workflow.name}`)) {
    fail(`${workflow.name}: default_prompt must mention $${workflow.name}`);
  }
  if (!yaml.includes("allow_implicit_invocation: true")) {
    fail(`${workflow.name}: implicit invocation policy missing`);
  }
  if (workflow.mcp_dependency && !yaml.includes(expectedMcpUrl)) {
    fail(`${workflow.name}: direct action skill is missing MCP dependency`);
  }
  if (!workflow.mcp_dependency && yaml.includes(expectedMcpUrl)) {
    fail(`${workflow.name}: advisory skill must not hard-depend on MCP`);
  }
}

let evals;
try {
  evals = await readJson(join(root, "evals", "cases.json"));
}
catch (error) {
  fail(`evals/cases.json: ${error.message}`);
}
if (evals) {
  const fixtureIds = new Set();
  if (evals.version !== 3) {
    fail(`evals: expected version 3, found ${evals.version}`);
  }
  if (evals.cases?.length !== 87) {
    fail(`evals: expected 87 cases, found ${evals.cases?.length ?? 0}`);
  }
  for (const entry of evals.cases ?? []) {
    if (!entry.id) {
      fail("trigger fixtures: every case needs a stable id");
    } else if (fixtureIds.has(entry.id)) {
      fail(`trigger fixtures: duplicate id ${entry.id}`);
    } else {
      fixtureIds.add(entry.id);
    }
    if (!intentByName.has(entry.intent)) {
      fail(`evals: unknown intent ${entry.intent}`);
    }
    if (!workflowByName.has(entry.skill)) {
      fail(`evals: unknown source skill ${entry.skill}`);
    }
    if (!workflowByName.has(entry.expected_skill)) {
      fail(`evals: unknown expected skill ${entry.expected_skill}`);
    }
    if (intentToWorkflow.get(entry.intent) !== entry.skill) {
      fail(`evals: ${entry.intent} maps to ${entry.skill} instead of ${intentToWorkflow.get(entry.intent)}`);
    }
    if (!new Set(["positive", "contrast"]).has(entry.kind)) {
      fail(`evals: ${entry.id} has invalid kind ${entry.kind}`);
    }
    if (entry.kind === "positive" && entry.expected_skill !== entry.skill) {
      fail(`evals: positive ${entry.id} must route to ${entry.skill}`);
    }
    if (entry.kind === "contrast" && entry.expected_skill === entry.skill) {
      fail(`evals: contrast ${entry.id} must route away from ${entry.skill}`);
    }
  }
  for (const workflow of workflows) {
    const own = evals.cases.filter((entry) => entry.skill === workflow.name);
    if (own.filter((entry) => entry.kind === "positive").length < 2) {
      fail(`${workflow.name}: fewer than two positive routing fixtures`);
    }
    if (own.filter((entry) => entry.kind === "contrast").length < 1) {
      fail(`${workflow.name}: no contrast routing fixture`);
    }
  }
}

let negativeRoutes;
try {
  negativeRoutes = await readJson(join(root, "evals", "negative-routes.json"));
} catch (error) {
  fail(`evals/negative-routes.json: ${error.message}`);
}
if (negativeRoutes) {
  if (negativeRoutes.version !== 1) {
    fail(`negative routes: expected version 1, found ${negativeRoutes.version}`);
  }
  if (negativeRoutes.routes?.length !== 29) {
    fail(`negative routes: expected 29 entries, found ${negativeRoutes.routes?.length ?? 0}`);
  }
  const routeById = new Map();
  for (const route of negativeRoutes.routes ?? []) {
    if (routeById.has(route.id)) {
      fail(`negative routes: duplicate id ${route.id}`);
    }
    if (!workflowByName.has(route.expected_skill)) {
      fail(`negative routes: unknown expected skill ${route.expected_skill}`);
    }
    routeById.set(route.id, route.expected_skill);
  }
  const contrastCases = evals?.cases?.filter((entry) => entry.kind === "contrast") ?? [];
  for (const entry of contrastCases) {
    if (routeById.get(entry.id) !== entry.expected_skill) {
      fail(`negative routes: ${entry.id} does not match generated fixture`);
    }
  }
}
let intentCollisions;
try {
  intentCollisions = await readJson(join(root, "evals", "intent-collisions.json"));
}
catch (error) {
  fail(`evals/intent-collisions.json: ${error.message}`);
}
if (intentCollisions) {
  if (intentCollisions.cases?.length !== 16) {
    fail(`intent collisions: expected 16 cases, found ${intentCollisions.cases?.length ?? 0}`);
  }
  for (const entry of intentCollisions.cases ?? []) {
    if (!intentByName.has(entry.primary)) {
      fail(`intent collisions: unknown primary ${entry.primary}`);
    }
    for (const secondary of entry.secondary ?? []) {
      if (!intentByName.has(secondary)) {
        fail(`intent collisions: unknown secondary ${secondary}`);
      }
    }
  }
}

let collisions;
try {
  collisions = await readJson(join(root, "evals", "collisions.json"));
}
catch (error) {
  fail(`evals/collisions.json: ${error.message}`);
}
if (collisions) {
  const collisionIds = new Set();
  if (collisions.version !== 2) {
    fail(`collisions: expected version 2, found ${collisions.version}`);
  }
  if (collisions.cases?.length !== 16) {
    fail(`collisions: expected 16 cases, found ${collisions.cases?.length ?? 0}`);
  }
  for (const entry of collisions.cases ?? []) {
    if (!entry.id) {
      fail("collision fixtures: every case needs a stable id");
    } else if (collisionIds.has(entry.id)) {
      fail(`collision fixtures: duplicate id ${entry.id}`);
    } else {
      collisionIds.add(entry.id);
    }
    if (!entry.prompt || !entry.reason) {
      fail("collisions: prompt and reason are required");
    }
    if (!workflowByName.has(entry.primary)) {
      fail(`collisions: unknown primary ${entry.primary}`);
    }
    if (!intentByName.has(entry.intent_primary)) {
      fail(`collisions: unknown intent_primary ${entry.intent_primary}`);
    }
    if (intentToWorkflow.get(entry.intent_primary) !== entry.primary) {
      fail(`collisions: primary mapping mismatch for ${entry.intent_primary}`);
    }
    if ((entry.secondary ?? []).includes(entry.primary)) {
      fail(`collisions: primary duplicated as secondary for ${entry.prompt}`);
    }
    if (new Set(entry.secondary ?? []).size !== (entry.secondary ?? []).length) {
      fail(`collisions: duplicate secondary workflow for ${entry.prompt}`);
    }
    for (const secondary of entry.secondary ?? []) {
      if (!workflowByName.has(secondary)) {
        fail(`collisions: unknown secondary ${secondary}`);
      }
    }
    const expectedResolved = (entry.intent_secondary ?? []).length > 0 && (entry.secondary ?? []).length === 0;
    if (entry.resolved_inside_workflow !== expectedResolved) {
      fail(`collisions: resolved_inside_workflow mismatch for ${entry.prompt}`);
    }
  }
}

const jsonFiles = [
  ".mcp.json",
  ".codex-plugin/plugin.json",
  ".cursor-plugin/plugin.json",
  ".github/plugin/plugin.json",
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
  "gemini-extension.json",
  "package.json",
  "package-lock.json",
  "skill.json"
];
const json = {};
for (const file of jsonFiles) {
  try {
    json[file] = await readJson(join(root, file));
  }
  catch (error) {
    fail(`${file}: missing or invalid JSON (${error.message})`);
  }
}
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const versionEntries = [
  ["package.json.version", json["package.json"]?.version],
  ["package-lock.json.version", json["package-lock.json"]?.version],
  ["package-lock.json.packages[\"\"].version", json["package-lock.json"]?.packages?.[""]?.version],
  ["skill.json.version", json["skill.json"]?.version],
  [".codex-plugin/plugin.json.version", json[".codex-plugin/plugin.json"]?.version],
  [".cursor-plugin/plugin.json.version", json[".cursor-plugin/plugin.json"]?.version],
  [".github/plugin/plugin.json.version", json[".github/plugin/plugin.json"]?.version],
  [".claude-plugin/plugin.json.version", json[".claude-plugin/plugin.json"]?.version],
  [".claude-plugin/marketplace.json.plugins[0].version", json[".claude-plugin/marketplace.json"]?.plugins?.[0]?.version],
  ["gemini-extension.json.version", json["gemini-extension.json"]?.version],
];
for (const [label, version] of versionEntries) {
  if (typeof version !== "string" || version.length === 0) {
    fail(`${label} is required`);
  } else if (!semverPattern.test(version)) {
    fail(`${label} must be valid SemVer; found ${version}`);
  }
}
const releaseVersion = json["package.json"]?.version;
const mismatchedVersions = versionEntries.filter(([, version]) => version !== releaseVersion);
if (mismatchedVersions.length > 0) {
  fail(`package and plugin versions must all equal ${releaseVersion}: ${mismatchedVersions.map(([label, version]) => `${label}=${String(version)}`).join(", ")}`);
}
const geminiExtension = json["gemini-extension.json"] ?? {};
const geminiExtensionKeys = Object.keys(geminiExtension).sort();
if (JSON.stringify(geminiExtensionKeys) !== JSON.stringify(["description", "mcpServers", "name", "version"])) {
  fail("Gemini CLI extension must contain exactly description, mcpServers, name, and version");
}
const expectedGeminiMcpServers = {
  renoolab: {
    httpUrl: expectedMcpUrl,
  },
};
if (JSON.stringify(geminiExtension.mcpServers) !== JSON.stringify(expectedGeminiMcpServers)) {
  fail("Gemini CLI extension must configure only the RenooLab Streamable HTTP MCP without trust overrides");
}
if (geminiExtension.name !== "renoolab-agent-skills") {
  fail("Gemini CLI extension name must be renoolab-agent-skills");
}
if (geminiExtension.description !== "10 French Agent Skills covering 29 intents for home renovation, finding tradespeople, and running an artisan or construction business.") {
  fail("Gemini CLI extension description must remain concise and distribution-focused");
}
if (json["skill.json"]?.name !== "renoolab-agent-skills") {
  fail("OpenAgentSkill manifest name must be renoolab-agent-skills");
}
if (json["skill.json"]?.license !== "Apache-2.0") {
  fail("OpenAgentSkill manifest must declare Apache-2.0");
}
if (json["skill.json"]?.repository !== "https://github.com/mehdimicra/renoolab-agent-skills") {
  fail("OpenAgentSkill manifest repository is invalid");
}
if (!Array.isArray(json["skill.json"]?.platforms) || json["skill.json"].platforms.length < 4) {
  fail("OpenAgentSkill manifest must declare multi-host platforms");
}
if (json[".codex-plugin/plugin.json"]?.skills !== "./skills/") {
  fail("Codex plugin must expose ./skills/");
}
if (json[".codex-plugin/plugin.json"]?.mcpServers !== "./.mcp.json") {
  fail("Codex plugin must expose ./.mcp.json");
}
if (json[".cursor-plugin/plugin.json"]?.name !== "renoolab") {
  fail("Cursor plugin name must be renoolab");
}
if (json[".cursor-plugin/plugin.json"]?.skills !== "./skills/") {
  fail("Cursor plugin must expose ./skills/");
}
if (json[".cursor-plugin/plugin.json"]?.mcpServers !== "./.mcp.json") {
  fail("Cursor plugin must expose ./.mcp.json");
}
if (json[".cursor-plugin/plugin.json"]?.license !== "Apache-2.0") {
  fail("Cursor plugin must declare Apache-2.0");
}
if (json[".cursor-plugin/plugin.json"]?.logo !== "assets/logo.png") {
  fail("Cursor plugin must expose assets/logo.png");
}
if (!(await exists(join(root, "assets", "logo.png")))) {
  fail("Cursor plugin logo is missing");
}
if (json[".github/plugin/plugin.json"]?.name !== "renoolab") {
  fail("GitHub Copilot plugin name must be renoolab");
}
if (!Array.isArray(json[".github/plugin/plugin.json"]?.skills)
  || json[".github/plugin/plugin.json"].skills.length !== 1
  || json[".github/plugin/plugin.json"].skills[0] !== "./skills/") {
  fail("GitHub Copilot plugin must expose ./skills/");
}
if (json[".github/plugin/plugin.json"]?.mcpServers !== "./.mcp.json") {
  fail("GitHub Copilot plugin must expose ./.mcp.json");
}
if (json[".github/plugin/plugin.json"]?.license !== "Apache-2.0") {
  fail("GitHub Copilot plugin must declare Apache-2.0");
}const generatorSource = await readFile(join(root, "scripts", "generate-skills.mjs"), "utf8");
if (generatorSource.includes("const publicTrades")) {
  fail("generator must not duplicate the public MCP trade enum");
}
if (!(await exists(join(root, "scripts", "run-behavioral-evals.mjs")))) {
  fail("behavioral evaluation runner is missing");
}

const readme = await readFile(join(root, "README.md"), "utf8");
if (!readme.includes("10") || !readme.includes("29 intentions")) {
  fail("README must explain the 10-workflow / 29-intent architecture");
}
if (/29 skills/i.test(readme)) {
  fail("README still presents 29 public skills");
}
const context7InstallCommands = [
  "npx ctx7@latest skills install /mehdimicra/renoolab-agent-skills renoolab-trouver-choisir-artisans",
  "npx ctx7@latest skills install /mehdimicra/renoolab-agent-skills --all",
];
for (const command of context7InstallCommands) {
  if (!readme.includes(command)) {
    fail(`README must document the Context7 install command: ${command}`);
  }
}
if (!readme.includes("[Context7 CLI](https://context7.com/docs/clients/cli)")) {
  fail("README must link the official Context7 CLI documentation");
}

if (!readme.includes("Context7 signale toutefois ces commandes comme dépréciées")) {
  fail("README must disclose the Context7 CLI deprecation warning observed during installation");
}
const geminiInstallCommand = `gemini extensions install https://github.com/mehdimicra/renoolab-agent-skills --ref v${json["gemini-extension.json"]?.version}`;
if (!readme.includes(geminiInstallCommand)) {
  fail("README must document the versioned Gemini CLI extension install command");
}
if (!readme.includes("gemini-cli-extension")) {
  fail("README must document the Gemini CLI Gallery discovery topic");
}
if (!readme.includes("`mcpServers.renoolab.httpUrl`") || !readme.includes("découverte OAuth dynamique")) {
  fail("README must explain the Gemini extension MCP configuration and dynamic OAuth discovery");
}
const geminiReleaseVersion = json["gemini-extension.json"]?.version;
for (const prerequisite of [
  "dépôt GitHub public",
  "`gemini-extension.json` à la racine",
  "topic GitHub exact `gemini-cli-extension`",
  `tag Git \`v${geminiReleaseVersion}\``,
  "versions synchronisées",
]) {
  if (!readme.includes(prerequisite)) {
    fail(`README must document the Gemini Gallery prerequisite: ${prerequisite}`);
  }
}
const perplexityAssetUrl =
  `https://renoolab.fr/.well-known/agent-skills/packages/v${geminiReleaseVersion}/renoolab-trouver-choisir-artisans.zip`;
if (!readme.includes(perplexityAssetUrl)) {
  fail("README must link the versioned first-party Perplexity search skill asset");
}
if (!readme.includes("SKILL.md` à la racine")) {
  fail("README must explain the Perplexity ZIP root layout");
}
if (!readme.includes("Perplexity Pro, Max ou Enterprise")
  || !readme.includes("connecteurs MCP personnalisés sont disponibles")
  || !readme.includes("activés par l'administrateur")) {
  fail("README must qualify Perplexity remote MCP access by plan, availability, and organization activation");
}
if (!readme.includes("Sans MCP, ce skill reste consultatif")) {
  fail("README must state that the Perplexity skill remains advisory without MCP access");
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}
console.log(`Validated ${workflows.length} public skills, ${intents.length} mapped intents, ${evals.cases.length} trigger fixtures, ${collisions.cases.length} collision fixtures, and a ${initialCatalogChars}-character initial catalog.`);