import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readRequiredText(path, label) {
  try {
    return (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
  } catch (error) {
    if (error.code === "ENOENT") {
      assert.fail(`${label} must exist`);
    }
    throw error;
  }
}

function splitPower(source) {
  const match = /^---\n([\s\S]+?)\n---\n\n([\s\S]+)\n?$/.exec(source);
  assert.ok(match, "POWER.md must contain YAML frontmatter and a non-empty Markdown body");
  return { frontmatter: match[1], body: `${match[2].trim()}\n` };
}

const plugin = JSON.parse(await readFile(join(repositoryRoot, "plugin.json"), "utf8"));
const mcp = JSON.parse(await readFile(join(repositoryRoot, "mcp.json"), "utf8"));
const powerSource = await readRequiredText(join(repositoryRoot, "POWER.md"), "root POWER.md");
const instructions = await readRequiredText(
  join(repositoryRoot, "dev.kiro", "INSTRUCTIONS.md"),
  "dev.kiro/INSTRUCTIONS.md",
);
const { frontmatter, body } = splitPower(powerSource);

const expectedFrontmatter = [
  `name: ${JSON.stringify(plugin.name)}`,
  'displayName: "RenooLab"',
  `description: ${JSON.stringify(plugin.description)}`,
  `keywords: ${JSON.stringify(plugin.keywords)}`,
  `author: ${JSON.stringify(plugin.author.name)}`,
  `repository: ${JSON.stringify(plugin.repository)}`,
  `license: ${JSON.stringify(plugin.license)}`,
].join("\n");

assert.equal(frontmatter, expectedFrontmatter, "POWER.md metadata must mirror plugin.json");
assert.equal(instructions, body, "Kiro instruction shim must equal the POWER.md body");

for (const required of [
  "## Overview",
  "## Available MCP Servers",
  "## Tool Usage",
  "## Configuration",
  "`renoolab`",
  "`rechercher_artisans`",
  "`contacter_artisan`",
  "`creer_profil_artisan`",
  "demande explicite",
  "confirmation explicite",
  "https://renoolab.fr/privacy/",
  "contact@renoolab.fr",
  "Apache-2.0",
]) {
  assert.ok(body.includes(required), `Kiro instructions must contain ${required}`);
}

assert.deepEqual(Object.keys(mcp.mcpServers), ["renoolab"], "Kiro Power must expose one logical MCP server");
assert.ok(!body.includes("power-renoolab-agent-skills-renoolab"), "Instructions must not expose Kiro's internal namespaced server id");
function assertNoSensitiveKeys(value, path = "mcp.json") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSensitiveKeys(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.doesNotMatch(
      key,
      /authorization|api[_-]?key|access[_-]?token|client[_-]?secret|private[_-]?key|password|token|secret|autoApprove|alwaysAllow/i,
      `${path}.${key} must not distribute credentials or static approvals`,
    );
    assertNoSensitiveKeys(child, `${path}.${key}`);
  }
}

assertNoSensitiveKeys(mcp);
const distributedKiroText = `${powerSource}\n${instructions}\n${JSON.stringify(mcp)}`;
assert.doesNotMatch(
  distributedKiroText,
  /Authorization\s*:|Bearer\s+|X-API-Key|(?:api[_-]?key|access[_-]?token|client[_-]?secret|private[_-]?key|password|token|secret)\s*["']?\s*[:=]|\$\{[^}]*(?:KEY|TOKEN|SECRET|PASSWORD)[^}]*\}|autoApprove|alwaysAllow/i,
  "Kiro distribution must not contain credentials or static approvals",
);

const skillEntries = await readdir(join(repositoryRoot, "skills"), { withFileTypes: true });
const skillNames = [];
for (const entry of skillEntries) {
  if (!entry.isDirectory()) continue;
  await readRequiredText(join(repositoryRoot, "skills", entry.name, "SKILL.md"), `${entry.name}/SKILL.md`);
  skillNames.push(entry.name);
}
assert.equal(skillNames.length, 10, "Kiro Power must expose exactly ten Agent Skills");

console.log("Validated Kiro dual-format compatibility with ten skills and read-only-first steering.");
