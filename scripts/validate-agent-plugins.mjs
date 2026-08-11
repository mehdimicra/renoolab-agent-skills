import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaRoot = join(repositoryRoot, "schemas", "agent-plugins", "1.0.0");
const pluginSchemaUrl = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const mcpSchemaUrl = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";
const canonicalMcpUrl = "https://mcp.renoolab.fr/mcp";
const expectedSchemaDigests = {
  plugin: "d9a49839afcbce02858fe55ac64a844b002a9a588e9db1b31ebd72256bc61b8d",
  mcp: "fc7a2a253ba117726bfdca51229ca98d103b4616c5f25c5a941563c0493faeeb",
};

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      assert.fail(`${label} must exist`);
    }
    throw error;
  }
}

function canonicalDigest(document) {
  return createHash("sha256").update(JSON.stringify(document)).digest("hex");
}

function assertSchemaValid(validate, document, label) {
  if (!validate(document)) {
    const details = validate.errors
      .map((error) => `${error.instancePath || "/"} ${error.message}`)
      .join("; ");
    assert.fail(`${label} does not conform to Agent Plugins 1.0.0: ${details}`);
  }
}

const [packageDocument, pluginSchema, mcpSchema, pluginDocument, mcpDocument] = await Promise.all([
  readJson(join(repositoryRoot, "package.json"), "package.json"),
  readJson(join(schemaRoot, "plugin.schema.json"), "pinned official plugin schema"),
  readJson(join(schemaRoot, "mcp.schema.json"), "pinned official MCP schema"),
  readJson(join(repositoryRoot, "plugin.json"), "root plugin.json"),
  readJson(join(repositoryRoot, "mcp.json"), "root mcp.json"),
]);

assert.equal(pluginSchema.$id, pluginSchemaUrl);
assert.equal(mcpSchema.$id, mcpSchemaUrl);
assert.equal(canonicalDigest(pluginSchema), expectedSchemaDigests.plugin, "pinned plugin schema changed");
assert.equal(canonicalDigest(mcpSchema), expectedSchemaDigests.mcp, "pinned MCP schema changed");

const ajv = new Ajv2020({ allErrors: true, strict: true });
assertSchemaValid(ajv.compile(pluginSchema), pluginDocument, "plugin.json");
assertSchemaValid(ajv.compile(mcpSchema), mcpDocument, "mcp.json");

const expectedPluginDocument = {
  $schema: pluginSchemaUrl,
  name: "renoolab",
  version: "0.5.2",
  description: "Prepare home renovation projects, find French tradespeople, and run an artisan or construction business with 10 French Agent Skills and the optional RenooLab MCP.",
  author: {
    name: "RenooLab",
    email: "contact@renoolab.fr",
    url: "https://renoolab.fr/",
  },
  homepage: "https://renoolab.fr/mcp/",
  repository: "https://github.com/mehdimicra/renoolab-agent-skills",
  license: "Apache-2.0",
  keywords: [
    "renoolab",
    "rénovation",
    "renovation",
    "travaux",
    "artisan",
    "artisans",
    "tradespeople",
    "contractors",
    "bâtiment",
    "construction",
    "home improvement",
    "plombier",
    "plumber",
    "électricien",
    "electrician",
  ],
};
const expectedMcpDocument = {
  $schema: mcpSchemaUrl,
  mcpServers: {
    renoolab: {
      type: "streamable-http",
      url: canonicalMcpUrl,
    },
  },
};

assert.equal(packageDocument.version, "0.5.2", "Kiro Power release must be 0.5.2");
assert.deepEqual(pluginDocument, expectedPluginDocument, "plugin.json must remain the audited Kiro activation surface");
assert.deepEqual(mcpDocument, expectedMcpDocument, "mcp.json must contain only the canonical remote server without static credentials or approvals");

const pluginWithUnknownField = { ...pluginDocument, tools: [] };
assert.equal(ajv.compile(pluginSchema)(pluginWithUnknownField), false, "official schema must reject unknown plugin fields");
const mcpWithLegacyTransport = structuredClone(mcpDocument);
mcpWithLegacyTransport.mcpServers.renoolab.type = "http";
assert.equal(ajv.compile(mcpSchema)(mcpWithLegacyTransport), false, "official schema must reject the non-standard http transport label");

console.log("Validated the RenooLab Kiro Power against pinned official Agent Plugins 1.0.0 schemas.");