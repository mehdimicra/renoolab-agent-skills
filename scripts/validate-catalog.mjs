import { access, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const catalogDir = join(root, "catalog");
const skillsRoot = join(root, "skills");
const expectedMcpUrl = "https://mcp.renoolab.fr/mcp";
const errors = [];
const fail = (message) => errors.push(message);
const exists = async (path) => { try { await access(path); return true; } catch { return false; } };
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const referenceFilename = (intentName) => `${intentName.replace(/^renoolab-/, "")}.md`;

const intents = [];
for (const file of (await readdir(catalogDir)).filter((name) => name.endsWith(".json") && name !== "workflows.json").sort()) {
  try {
    const data = await readJson(join(catalogDir, file));
    if (!Array.isArray(data)) fail(`${file}: root must be an array`);
    else intents.push(...data);
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

if (intents.length !== 29) fail(`catalog: expected 29 intents, found ${intents.length}`);
if (workflows.length !== 10) fail(`workflows: expected 10 public skills, found ${workflows.length}`);

const intentByName = new Map();
for (const intent of intents) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(intent.name) || intent.name.length > 64) fail(`${intent.name}: invalid intent name`);
  if (intentByName.has(intent.name)) fail(`${intent.name}: duplicate intent name`);
  intentByName.set(intent.name, intent);
  if (!intent.description || intent.description.length > 1024) fail(`${intent.name}: description must be 1..1024 chars`);
  for (const field of ["inputs", "angles", "outputs", "guardrails", "positive_prompts", "negative_prompts"]) {
    if (!Array.isArray(intent[field]) || intent[field].length === 0) fail(`${intent.name}: ${field} must be non-empty`);
  }
}

const workflowByName = new Map();
const intentToWorkflow = new Map();
for (const workflow of workflows) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(workflow.name) || workflow.name.length > 64) fail(`${workflow.name}: invalid workflow name`);
  if (workflowByName.has(workflow.name)) fail(`${workflow.name}: duplicate workflow name`);
  workflowByName.set(workflow.name, workflow);
  if (!workflow.description || workflow.description.length > 1024) fail(`${workflow.name}: description must be 1..1024 chars`);
  if (!workflow.mission || !workflow.renoolab_route) fail(`${workflow.name}: mission and renoolab_route are required`);
  for (const field of ["procedure", "outputs", "guardrails", "references"]) {
    if (!Array.isArray(workflow[field]) || workflow[field].length === 0) fail(`${workflow.name}: ${field} must be non-empty`);
  }
  const ui = workflow.ui ?? {};
  if (!ui.display_name) fail(`${workflow.name}: ui.display_name is required`);
  if (!ui.short_description || ui.short_description.length < 25 || ui.short_description.length > 64) {
    fail(`${workflow.name}: ui.short_description must be 25..64 chars`);
  }
  if (!ui.default_prompt?.includes(`$${workflow.name}`)) fail(`${workflow.name}: ui.default_prompt must mention $${workflow.name}`);
  for (const route of workflow.references ?? []) {
    if (!route.intent || !route.when) fail(`${workflow.name}: every reference needs intent and when`);
    if (!intentByName.has(route.intent)) fail(`${workflow.name}: unknown intent ${route.intent}`);
    if (intentToWorkflow.has(route.intent)) fail(`${route.intent}: mapped more than once`);
    intentToWorkflow.set(route.intent, workflow.name);
  }
}
for (const intent of intents) if (!intentToWorkflow.has(intent.name)) fail(`${intent.name}: not mapped to a public workflow`);

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
if (initialCatalogChars > 7000) fail(`initial skill catalog budget exceeded: ${initialCatalogChars} chars > 7000`);

let dirs = [];
try {
  dirs = (await readdir(skillsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
} catch (error) {
  fail(`skills/: ${error.message}`);
}
if (dirs.length !== 10) fail(`skills/: expected 10 directories, found ${dirs.length}`);
for (const dir of dirs) if (!workflowByName.has(dir)) fail(`${dir}: directory missing from workflow catalog`);

for (const workflow of workflows) {
  const dir = join(skillsRoot, workflow.name);
  for (const relative of ["SKILL.md", "agents/openai.yaml", "references/renoolab-actions.md"]) {
    if (!(await exists(join(dir, relative)))) fail(`${workflow.name}: missing ${relative}`);
  }
  const expectedReferences = new Set([
    "renoolab-actions.md",
    ...workflow.references.map((route) => referenceFilename(route.intent))
  ]);
  if (await exists(join(dir, "references"))) {
    const actualReferences = (await readdir(join(dir, "references"), { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
    for (const name of actualReferences) if (!expectedReferences.has(name)) fail(`${workflow.name}: stale reference ${name}`);
    for (const name of expectedReferences) if (!actualReferences.includes(name)) fail(`${workflow.name}: missing references/${name}`);
  }

  if (!(await exists(join(dir, "SKILL.md")))) continue;
  const markdown = await readFile(join(dir, "SKILL.md"), "utf8");
  if (markdown.includes("TODO") || markdown.includes("[TODO:")) fail(`${workflow.name}: TODO placeholder remains`);
  if (markdown.split(/\r?\n/).length > 500) fail(`${workflow.name}: SKILL.md exceeds 500 lines`);
  const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontmatter) {
    fail(`${workflow.name}: malformed frontmatter`);
  } else {
    const frontmatterKeys = frontmatter[1].split("\n").map((line) => line.split(":", 1)[0].trim()).filter(Boolean);
    if (frontmatterKeys.join(",") !== "name,description") fail(`${workflow.name}: frontmatter must contain only name and description`);
    const name = frontmatter[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
    const descriptionLine = frontmatter[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
    if (name !== workflow.name) fail(`${workflow.name}: frontmatter name mismatch`);
    if (!descriptionLine?.startsWith('"') || !descriptionLine.endsWith('"')) fail(`${workflow.name}: description must be YAML-quoted`);
  }
  for (const route of workflow.references) {
    const filename = referenceFilename(route.intent);
    if (!markdown.includes(`](references/${filename})`)) fail(`${workflow.name}: SKILL.md does not link references/${filename}`);
  }
  if (!markdown.includes("](references/renoolab-actions.md)")) fail(`${workflow.name}: actions reference is not linked`);

  const yamlPath = join(dir, "agents", "openai.yaml");
  if (!(await exists(yamlPath))) continue;
  const yaml = await readFile(yamlPath, "utf8");
  if (!yaml.includes(`$${workflow.name}`)) fail(`${workflow.name}: default_prompt must mention $${workflow.name}`);
  if (!yaml.includes("allow_implicit_invocation: true")) fail(`${workflow.name}: implicit invocation policy missing`);
  if (workflow.mcp_dependency && !yaml.includes(expectedMcpUrl)) fail(`${workflow.name}: direct action skill is missing MCP dependency`);
  if (!workflow.mcp_dependency && yaml.includes(expectedMcpUrl)) fail(`${workflow.name}: advisory skill must not hard-depend on MCP`);
}

let evals;
try { evals = await readJson(join(root, "evals", "cases.json")); }
catch (error) { fail(`evals/cases.json: ${error.message}`); }
if (evals) {
  if (evals.version !== 2) fail(`evals: expected version 2, found ${evals.version}`);
  if (evals.cases?.length !== 87) fail(`evals: expected 87 cases, found ${evals.cases?.length ?? 0}`);
  for (const entry of evals.cases ?? []) {
    if (!intentByName.has(entry.intent)) fail(`evals: unknown intent ${entry.intent}`);
    if (!workflowByName.has(entry.skill)) fail(`evals: unknown public skill ${entry.skill}`);
    if (intentToWorkflow.get(entry.intent) !== entry.skill) fail(`evals: ${entry.intent} maps to ${entry.skill} instead of ${intentToWorkflow.get(entry.intent)}`);
  }
  for (const workflow of workflows) {
    const own = evals.cases.filter((entry) => entry.skill === workflow.name);
    if (own.filter((entry) => entry.expected_trigger === true).length < 2) fail(`${workflow.name}: fewer than two positive evals`);
    if (own.filter((entry) => entry.expected_trigger === false).length < 1) fail(`${workflow.name}: no negative eval`);
  }
}

let intentCollisions;
try { intentCollisions = await readJson(join(root, "evals", "intent-collisions.json")); }
catch (error) { fail(`evals/intent-collisions.json: ${error.message}`); }
if (intentCollisions) {
  if (intentCollisions.cases?.length !== 16) fail(`intent collisions: expected 16 cases, found ${intentCollisions.cases?.length ?? 0}`);
  for (const entry of intentCollisions.cases ?? []) {
    if (!intentByName.has(entry.primary)) fail(`intent collisions: unknown primary ${entry.primary}`);
    for (const secondary of entry.secondary ?? []) if (!intentByName.has(secondary)) fail(`intent collisions: unknown secondary ${secondary}`);
  }
}

let collisions;
try { collisions = await readJson(join(root, "evals", "collisions.json")); }
catch (error) { fail(`evals/collisions.json: ${error.message}`); }
if (collisions) {
  if (collisions.version !== 2) fail(`collisions: expected version 2, found ${collisions.version}`);
  if (collisions.cases?.length !== 16) fail(`collisions: expected 16 cases, found ${collisions.cases?.length ?? 0}`);
  for (const entry of collisions.cases ?? []) {
    if (!entry.prompt || !entry.reason) fail("collisions: prompt and reason are required");
    if (!workflowByName.has(entry.primary)) fail(`collisions: unknown primary ${entry.primary}`);
    if (!intentByName.has(entry.intent_primary)) fail(`collisions: unknown intent_primary ${entry.intent_primary}`);
    if (intentToWorkflow.get(entry.intent_primary) !== entry.primary) fail(`collisions: primary mapping mismatch for ${entry.intent_primary}`);
    if ((entry.secondary ?? []).includes(entry.primary)) fail(`collisions: primary duplicated as secondary for ${entry.prompt}`);
    if (new Set(entry.secondary ?? []).size !== (entry.secondary ?? []).length) fail(`collisions: duplicate secondary workflow for ${entry.prompt}`);
    for (const secondary of entry.secondary ?? []) if (!workflowByName.has(secondary)) fail(`collisions: unknown secondary ${secondary}`);
    const expectedResolved = (entry.intent_secondary ?? []).length > 0 && (entry.secondary ?? []).length === 0;
    if (entry.resolved_inside_workflow !== expectedResolved) fail(`collisions: resolved_inside_workflow mismatch for ${entry.prompt}`);
  }
}

const jsonFiles = [
  ".mcp.json",
  ".codex-plugin/plugin.json",
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
  "package.json"
];
const json = {};
for (const file of jsonFiles) {
  try { json[file] = await readJson(join(root, file)); }
  catch (error) { fail(`${file}: missing or invalid JSON (${error.message})`); }
}
const versions = [
  json["package.json"]?.version,
  json[".codex-plugin/plugin.json"]?.version,
  json[".claude-plugin/plugin.json"]?.version,
  json[".claude-plugin/marketplace.json"]?.plugins?.[0]?.version
].filter(Boolean);
if (new Set(versions).size !== 1) fail(`package and plugin versions differ: ${versions.join(", ")}`);
if (json[".codex-plugin/plugin.json"]?.skills !== "./skills/") fail("Codex plugin must expose ./skills/");
if (json[".codex-plugin/plugin.json"]?.mcpServers !== "./.mcp.json") fail("Codex plugin must expose ./.mcp.json");

const readme = await readFile(join(root, "README.md"), "utf8");
if (!readme.includes("10") || !readme.includes("29 intentions")) fail("README must explain the 10-workflow / 29-intent architecture");
if (/29 skills/i.test(readme)) fail("README still presents 29 public skills");

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}
console.log(`Validated ${workflows.length} public skills, ${intents.length} mapped intents, ${evals.cases.length} trigger evals, ${collisions.cases.length} collision evals, and a ${initialCatalogChars}-character initial catalog.`);