import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createStoredZip } from "./lib/stored-zip.mjs";

const runFile = promisify(execFile);
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(moduleDirectory, "..");
const canonicalSkillsDirectory = join(repositoryRoot, "skills");
const pinnedSchemaFile = join(
  repositoryRoot,
  "schemas",
  "microsoft",
  "teams",
  "v1.28",
  "MicrosoftTeams.schema.json",
);
const EXPECTED_ID = "a5b85f1e-f1d5-5c3e-bce6-c2d58512c0cf";
const MAX_PLUGIN_BYTES = 10_000_000;
const MAX_COMPANION_BYTES = 5_000_000;
const MAX_COMPANION_TOTAL_BYTES = 10_000_000;
const MAX_COMPANION_FILES = 20;

assert.throws(
  () => createStoredZip([{ name: "ambiguous.", content: Buffer.from("unsafe") }]),
  /Unsafe ZIP entry path/,
  "ZIP entries ending in a dot must be rejected for Windows-safe extraction",
);
assert.throws(
  () => createStoredZip([{ name: "ambiguous ", content: Buffer.from("unsafe") }]),
  /Unsafe ZIP entry path/,
  "ZIP entries ending in a space must be rejected for Windows-safe extraction",
);

let buildMicrosoftCoworkPlugin;
try {
  ({ buildMicrosoftCoworkPlugin } = await import("./build-microsoft-cowork-plugin.mjs"));
} catch {
  // The RED run should fail on the missing production export, not a syntax error.
}
assert.equal(
  typeof buildMicrosoftCoworkPlugin,
  "function",
  "build-microsoft-cowork-plugin.mjs must export buildMicrosoftCoworkPlugin",
);

const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}
function crc32(content) {
  let value = 0xffffffff;
  for (const byte of content) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function readStoredZip(archive) {
  assert.ok(archive.length >= 22, "ZIP must contain an end-of-central-directory record");
  const endOffset = archive.length - 22;
  assert.equal(archive.readUInt32LE(endOffset), 0x06054b50, "ZIP must end with EOCD");
  assert.equal(archive.readUInt16LE(endOffset + 4), 0, "ZIP must use one disk");
  assert.equal(archive.readUInt16LE(endOffset + 6), 0, "ZIP central directory must use one disk");
  const entryCount = archive.readUInt16LE(endOffset + 10);
  assert.equal(archive.readUInt16LE(endOffset + 8), entryCount);
  const centralSize = archive.readUInt32LE(endOffset + 12);
  const centralOffset = archive.readUInt32LE(endOffset + 16);
  assert.equal(archive.readUInt16LE(endOffset + 20), 0, "ZIP comment must be empty");
  assert.equal(centralOffset + centralSize, endOffset, "central directory bounds must be valid");

  const files = new Map();
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(archive.readUInt32LE(offset), 0x02014b50, "central entry signature must be valid");
    assert.equal(archive.readUInt16LE(offset + 8), 0x0800, "entries must declare UTF-8 names");
    assert.equal(archive.readUInt16LE(offset + 10), 0, "entries must use the stored method");
    const centralChecksum = archive.readUInt32LE(offset + 16);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    assert.equal(compressedSize, uncompressedSize, "stored entry sizes must match");
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    assert.equal(files.has(name), false, `ZIP entry must be unique: ${name}`);

    assert.equal(archive.readUInt32LE(localOffset), 0x04034b50, "local entry signature must be valid");
    assert.equal(archive.readUInt16LE(localOffset + 6), 0x0800, "local entry must declare UTF-8 names");
    assert.equal(archive.readUInt16LE(localOffset + 8), 0, "local entry must use the stored method");
    const localChecksum = archive.readUInt32LE(localOffset + 14);
    const localCompressedSize = archive.readUInt32LE(localOffset + 18);
    const localUncompressedSize = archive.readUInt32LE(localOffset + 22);
    assert.equal(localCompressedSize, compressedSize, "local and central compressed sizes must match");
    assert.equal(localUncompressedSize, uncompressedSize, "local and central sizes must match");
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const localName = archive.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString("utf8");
    assert.equal(localName, name, "local and central entry names must match");
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const content = archive.subarray(dataOffset, dataOffset + uncompressedSize);
    assert.equal(localChecksum, centralChecksum, "local and central CRC32 values must match");
    assert.equal(centralChecksum, crc32(content), "entry CRC32 must match its bytes");
    files.set(name, content);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(offset, endOffset, "central directory must contain only declared entries");
  return files;
}

async function listRegularFiles(directory, prefix = "") {
  const output = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    const absolute = join(directory, entry.name);
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    const stats = await lstat(absolute);
    assert.equal(stats.isSymbolicLink(), false, `canonical source must not contain symlinks: ${name}`);
    if (stats.isDirectory()) output.push(...await listRegularFiles(absolute, name));
    else if (stats.isFile()) output.push(name);
    else assert.fail(`canonical source must contain only files and directories: ${name}`);
  }
  return output;
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function pngDimensions(content) {
  assert.deepEqual(
    [...content.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    "icon must be a PNG",
  );
  assert.equal(content.subarray(12, 16).toString("ascii"), "IHDR", "PNG must start with IHDR");
  return { width: content.readUInt32BE(16), height: content.readUInt32BE(20) };
}

function parseFrontmatterName(content) {
  const match = content.toString("utf8").match(/^---\r?\n[\s\S]*?^name:\s*([^\r\n]+)\r?$/m);
  assert.ok(match, "SKILL.md must have a frontmatter name");
  return match[1].trim();
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "renoolab-microsoft-cowork-"));
try {
  const firstOutput = join(temporaryRoot, "first.zip");
  const secondOutput = join(temporaryRoot, "nested", "second.zip");
  await buildMicrosoftCoworkPlugin({ outputFile: firstOutput });
  await buildMicrosoftCoworkPlugin({ outputFile: secondOutput });

  const firstArchive = await readFile(firstOutput);
  const secondArchive = await readFile(secondOutput);
  assert.deepEqual(firstArchive, secondArchive, "Microsoft Cowork ZIP bytes must be deterministic");
  assert.ok(firstArchive.length < MAX_PLUGIN_BYTES, "Microsoft Cowork ZIP must remain smaller than 10 MB");

  const files = readStoredZip(firstArchive);
  const canonicalSkillFiles = await listRegularFiles(canonicalSkillsDirectory);
  const expectedFiles = [
    "manifest.json",
    "color.png",
    "outline.png",
    "tools/renoolab-tools.json",
    ...canonicalSkillFiles.map((name) => `skills/${name}`),
  ];
  assert.deepEqual([...files.keys()], expectedFiles, "ZIP must contain exactly the audited Cowork package files");

  for (const name of canonicalSkillFiles) {
    const source = await readFile(join(canonicalSkillsDirectory, ...name.split("/")));
    assert.deepEqual(files.get(`skills/${name}`), source, `skills/${name} must match the canonical source`);
  }

  const manifest = JSON.parse(files.get("manifest.json").toString("utf8"));
  const packageDocument = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
  assert.equal(packageDocument.version, "0.5.2", "Microsoft Cowork packaging requires a new synchronized release");
  assert.equal(
    packageDocument.scripts?.["microsoft:build"],
    "node scripts/build-microsoft-cowork-plugin.mjs --output dist/microsoft/renoolab-microsoft-cowork.zip",
  );
  assert.equal(packageDocument.scripts?.["microsoft:test"], "node scripts/test-microsoft-cowork-plugin.mjs");
  assert.match(packageDocument.scripts?.test ?? "", /npm run microsoft:test/);
  const readme = await readFile(join(repositoryRoot, "README.md"), "utf8");
  assert.ok(readme.includes("Microsoft 365 Copilot Cowork"), "README must document the Cowork package");
  assert.ok(
    readme.includes("https://renoolab.fr/.well-known/agent-skills/packages/v0.5.2/renoolab-microsoft-cowork.zip"),
    "README must link the versioned first-party Cowork package",
  );
  assert.ok(readme.includes("validation structurelle"), "README must state what has been structurally validated");
  assert.ok(readme.includes("import frais"), "README must disclose that a fresh Cowork host test remains required");
  assert.equal(manifest.$schema, "https://developer.microsoft.com/json-schemas/teams/v1.28/MicrosoftTeams.schema.json");
  assert.equal(manifest.manifestVersion, "1.28");
  assert.equal(manifest.version, packageDocument.version, "Cowork package version must follow package.json");
  assert.equal(manifest.id, EXPECTED_ID, "Cowork app ID must remain the Microsoft-compatible deterministic UUID v5");
  assert.deepEqual(manifest.developer, {
    name: "RenooLab",
    websiteUrl: "https://renoolab.fr/mcp/",
    privacyUrl: "https://renoolab.fr/privacy/",
    termsOfUseUrl: "https://renoolab.fr/cgu/",
  });
  assert.deepEqual(manifest.name, {
    short: "RenooLab",
    full: "RenooLab – Artisans et rénovation",
  });
  assert.ok(manifest.description.short.length <= 80, "short description must fit the Microsoft limit");
  assert.ok(manifest.description.full.length <= 4000, "full description must fit the Microsoft limit");
  assert.deepEqual(manifest.localizationInfo, { defaultLanguageTag: "fr-FR" });
  assert.deepEqual(manifest.icons, { color: "color.png", outline: "outline.png" });
  assert.equal(manifest.accentColor, "#A855F7");
  assert.equal("packageName" in manifest, false, "v1.28 rejects the legacy packageName field");

  const expectedSkillFolders = [...new Set(canonicalSkillFiles.map((name) => name.split("/")[0]))];
  assert.deepEqual(
    manifest.agentSkills,
    expectedSkillFolders.map((folder) => ({ folder: `./skills/${folder}` })),
    "manifest must expose all canonical skills exactly once",
  );
  assert.ok(manifest.agentSkills.length <= 20, "Cowork supports at most 20 skills per package");
  for (const folder of expectedSkillFolders) {
    const prefix = `${folder}/`;
    const skillFiles = canonicalSkillFiles.filter((name) => name.startsWith(prefix));
    assert.ok(skillFiles.includes(`${folder}/SKILL.md`), `${folder} must contain SKILL.md`);
    assert.equal(
      parseFrontmatterName(files.get(`skills/${folder}/SKILL.md`)),
      folder,
      `${folder} must match its SKILL.md name`,
    );
    const companionFiles = skillFiles.filter((name) => name !== `${folder}/SKILL.md`);
    assert.ok(companionFiles.length <= MAX_COMPANION_FILES, `${folder} must have at most 20 companion files`);
    let companionBytes = 0;
    for (const name of companionFiles) {
      const content = files.get(`skills/${name}`);
      assert.ok(content.length <= MAX_COMPANION_BYTES, `${name} must be no larger than 5 MB`);
      companionBytes += content.length;
    }
    assert.ok(companionBytes <= MAX_COMPANION_TOTAL_BYTES, `${folder} companions must total no more than 10 MB`);
  }

  assert.deepEqual(manifest.agentConnectors, [{
    id: "renoolab-mcp",
    displayName: "RenooLab — Artisans en France",
    description: "Recherche et services RenooLab pour les artisans du bâtiment en France.",
    toolSource: {
      remoteMcpServer: {
        mcpServerUrl: "https://mcp.renoolab.fr/mcp",
        mcpToolDescription: { file: "./tools/renoolab-tools.json" },
      },
    },
  }]);
  assert.equal(
    "authorization" in manifest.agentConnectors[0].toolSource.remoteMcpServer,
    false,
    "RenooLab DCR must not ship a vault reference or a static credential",
  );

  const toolsBytes = files.get("tools/renoolab-tools.json");
  assert.equal(
    sha256(toolsBytes),
    "ffdb7fd74fcfbb781a4dce1802ab283501ce890f1ea6704c498c1597e76d26e0",
    "Cowork tools snapshot must match the current production tools/list contract exported by its test harness",
  );
  const toolsDocument = JSON.parse(toolsBytes.toString("utf8"));
  assert.deepEqual(toolsDocument.tools.map((tool) => tool.name), [
    "rechercher_artisans",
    "contacter_artisan",
    "creer_profil_artisan",
  ]);
  const expectedAnnotations = [
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  ];
  const expectedRequiredInputs = [
    ["metier", "ville"],
    ["artisan_id", "nom", "email", "telephone", "message"],
    ["nom_entreprise", "metiers", "ville", "email", "telephone"],
  ];
  for (let index = 0; index < toolsDocument.tools.length; index += 1) {
    const tool = toolsDocument.tools[index];
    assert.equal(typeof tool.title, "string", `${tool.name} must expose a title`);
    assert.ok(tool.description.length >= 80, `${tool.name} must expose a discriminating description`);
    assert.equal(tool.inputSchema.type, "object", `${tool.name} must expose an object input schema`);
    assert.deepEqual(tool.inputSchema.required, expectedRequiredInputs[index]);
    assert.equal(tool.outputSchema.type, "object", `${tool.name} must expose its structured output schema`);
    assert.deepEqual(tool.annotations, expectedAnnotations[index]);
    assert.deepEqual(tool.execution, { taskSupport: "forbidden" });
    assert.equal("_meta" in tool, false, "Cowork snapshot must not carry host-specific OpenAI metadata");
  }

  assert.deepEqual(pngDimensions(files.get("color.png")), { width: 192, height: 192 });
  assert.equal(
    sha256(files.get("color.png")),
    "7cd3f16ac70c9c58d64b5dd60a987e1275b8caaefe8cafcb60f00c5737147938",
    "color.png must be the audited fully opaque flat #A855F7 brand icon",
  );
  assert.deepEqual(pngDimensions(files.get("outline.png")), { width: 32, height: 32 });

  const { default: AjvDraft04 } = await import("ajv-draft-04");
  const schemaBytes = await readFile(pinnedSchemaFile);
  assert.equal(schemaBytes.includes(Buffer.from("\r\n")), false, "pinned Microsoft schema must use canonical LF bytes");
  assert.equal(
    sha256(schemaBytes),
    "5e33914fc0f9b10e37bafba9f4886eca7ff374d739dfa98dbe90b7733b03511f",
    "pinned Microsoft 365 v1.28 schema changed",
  );
  const schema = JSON.parse(schemaBytes.toString("utf8"));
  const ajv = new AjvDraft04({ allErrors: true, strict: true, strictTypes: false, strictRequired: false });
  ajv.addFormat("uri", (value) => {
    try {
      return new URL(value).protocol.length > 0;
    } catch {
      return false;
    }
  });
  const validateManifest = ajv.compile(schema);
  assert.equal(validateManifest(manifest), true, JSON.stringify(validateManifest.errors, null, 2));

  const secretPattern = /(bearer\s+|client_secret|service_role|supabase_service_role_key|mcp_auth_token)/i;
  for (const [name, content] of files) {
    if (name.endsWith(".json") || name.endsWith(".md")) {
      assert.equal(secretPattern.test(content.toString("utf8")), false, `${name} must not contain a credential`);
    }
    assert.equal(name.includes("\\"), false, `${name} must use POSIX separators`);
    assert.equal(name.split("/").some((segment) => segment === ".." || segment.startsWith(".")), false, `${name} must be safe and non-hidden`);
  }

  const cliOutput = join(temporaryRoot, "cli", "renoolab-microsoft-cowork.zip");
  const cliResult = await runFile(
    process.execPath,
    [join(moduleDirectory, "build-microsoft-cowork-plugin.mjs"), "--output", cliOutput],
    { cwd: repositoryRoot },
  );
  assert.equal(cliResult.stderr, "", "CLI must not write to stderr");
  assert.match(cliResult.stdout, /Generated Microsoft Cowork plugin ZIP:/);
  assert.deepEqual(await readFile(cliOutput), firstArchive, "CLI and API must produce identical bytes");
  await assert.rejects(
    runFile(process.execPath, [join(moduleDirectory, "build-microsoft-cowork-plugin.mjs")]),
    (error) => {
      assert.match(error.stderr, /Usage: node scripts\/build-microsoft-cowork-plugin\.mjs --output <file>/);
      return true;
    },
  );

  const fixtureRoot = join(temporaryRoot, "fixture-repository");
  await mkdir(fixtureRoot, { recursive: true });
  await cp(join(repositoryRoot, "package.json"), join(fixtureRoot, "package.json"));
  await cp(join(repositoryRoot, "skills"), join(fixtureRoot, "skills"), { recursive: true });
  await cp(join(repositoryRoot, "distribution"), join(fixtureRoot, "distribution"), { recursive: true });
  const fixturePackageBefore = await readFile(join(fixtureRoot, "package.json"));
  await assert.rejects(
    buildMicrosoftCoworkPlugin({
      outputFile: join(fixtureRoot, "package.json"),
      repositoryRoot: fixtureRoot,
    }),
    /outputFile must be written under dist or outside the repository/,
  );
  assert.deepEqual(await readFile(join(fixtureRoot, "package.json")), fixturePackageBefore);
  await assert.rejects(
    buildMicrosoftCoworkPlugin({
      outputFile: join(fixtureRoot, "skills", "source-overwrite.zip"),
      repositoryRoot: fixtureRoot,
    }),
    /outputFile must be written under dist or outside the repository/,
  );
  if (process.platform === "win32") {
    await assert.rejects(
      buildMicrosoftCoworkPlugin({
        outputFile: join(fixtureRoot.toUpperCase(), "skills", "case-variant.zip"),
        repositoryRoot: fixtureRoot,
      }),
      /outputFile must be written under dist or outside the repository/,
    );
  }
  const linkedTarget = join(temporaryRoot, "linked-target");
  await mkdir(linkedTarget);
  await writeFile(join(linkedTarget, "payload.md"), "linked\n");
  const linkedDirectory = join(
    fixtureRoot,
    "skills",
    expectedSkillFolders[0],
    "references",
    "linked-directory",
  );
  await symlink(linkedTarget, linkedDirectory, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(
    buildMicrosoftCoworkPlugin({
      outputFile: join(temporaryRoot, "rejections", "symlink.zip"),
      repositoryRoot: fixtureRoot,
    }),
    /symlinks are not allowed/i,
  );
  await rm(linkedDirectory, { recursive: true, force: true });

  const hiddenFile = join(fixtureRoot, "skills", expectedSkillFolders[0], ".hidden.md");
  await writeFile(hiddenFile, "hidden\n");
  await assert.rejects(
    buildMicrosoftCoworkPlugin({
      outputFile: join(temporaryRoot, "rejections", "hidden.zip"),
      repositoryRoot: fixtureRoot,
    }),
    /hidden files are not allowed/i,
  );
  await rm(hiddenFile, { force: true });

  const tooManyDirectory = join(fixtureRoot, "skills", expectedSkillFolders[0], "many");
  await mkdir(tooManyDirectory);
  for (let index = 0; index <= MAX_COMPANION_FILES; index += 1) {
    await writeFile(join(tooManyDirectory, `extra-${index}.md`), "extra\n");
  }
  await assert.rejects(
    buildMicrosoftCoworkPlugin({
      outputFile: join(temporaryRoot, "rejections", "too-many.zip"),
      repositoryRoot: fixtureRoot,
    }),
    /at most 20 companion files/i,
  );

  console.log("Validated deterministic Microsoft Cowork package, v1.28 manifest, 10 skills, 3 MCP tools, icons, CLI, and safety rejections.");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}