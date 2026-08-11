import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createStoredZip } from "./lib/stored-zip.mjs";

const MAX_PLUGIN_BYTES = 10_000_000;
const MAX_SKILLS = 20;
const MAX_COMPANION_FILES = 20;
const MAX_COMPANION_BYTES = 5_000_000;
const MAX_COMPANION_TOTAL_BYTES = 10_000_000;
const MICROSOFT_SCHEMA_URL = "https://developer.microsoft.com/json-schemas/teams/v1.28/MicrosoftTeams.schema.json";
const MICROSOFT_APP_ID = "a5b85f1e-f1d5-5c3e-bce6-c2d58512c0cf";
const MCP_ENDPOINT = "https://mcp.renoolab.fr/mcp";
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = resolve(moduleDirectory, "..");
const allowedComponentPattern = /^[A-Za-z0-9_! .-]+$/;
const windowsReservedPattern = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function isWithin(parent, child) {
  const comparableParent = process.platform === "win32" ? parent.toLowerCase() : parent;
  const comparableChild = process.platform === "win32" ? child.toLowerCase() : child;
  return comparableChild === comparableParent || comparableChild.startsWith(`${comparableParent}${sep}`);
}

function validatePathComponent(component) {
  if (
    component.length === 0 ||
    component.startsWith(".") ||
    component.normalize("NFC") !== component ||
    component.endsWith(".") ||
    component.endsWith(" ") ||
    !allowedComponentPattern.test(component) ||
    windowsReservedPattern.test(component)
  ) {
    if (component.startsWith(".")) {
      throw new Error(`Hidden files are not allowed in Microsoft Cowork packages: ${component}`);
    }
    throw new Error(`Unsafe Microsoft Cowork package path component: ${component}`);
  }
}

async function readCanonicalFile(file, label) {
  const stats = await lstat(file);
  if (stats.isSymbolicLink()) {
    throw new Error(`Symlinks are not allowed in Microsoft Cowork sources: ${label}`);
  }
  if (!stats.isFile()) {
    throw new Error(`Microsoft Cowork source must be a regular file: ${label}`);
  }
  return readFile(file);
}

async function collectDirectoryFiles(rootDirectory, prefix = "") {
  const rootStats = await lstat(rootDirectory);
  if (rootStats.isSymbolicLink()) {
    throw new Error(`Symlinks are not allowed in Microsoft Cowork sources: ${rootDirectory}`);
  }
  if (!rootStats.isDirectory()) {
    throw new Error(`Microsoft Cowork source must be a directory: ${rootDirectory}`);
  }

  const output = [];
  const directoryEntries = await readdir(rootDirectory, { withFileTypes: true });
  directoryEntries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of directoryEntries) {
    validatePathComponent(entry.name);
    const absolute = join(rootDirectory, entry.name);
    const relativeName = prefix ? `${prefix}/${entry.name}` : entry.name;
    const stats = await lstat(absolute);
    if (stats.isSymbolicLink()) {
      throw new Error(`Symlinks are not allowed in Microsoft Cowork sources: ${relativeName}`);
    }
    if (stats.isDirectory()) {
      output.push(...await collectDirectoryFiles(absolute, relativeName));
    } else if (stats.isFile()) {
      output.push({ name: relativeName, content: await readFile(absolute) });
    } else {
      throw new Error(`Microsoft Cowork sources must contain only regular files: ${relativeName}`);
    }
  }
  return output;
}

function frontmatterField(content, field) {
  const text = content.toString("utf8");
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) throw new Error("SKILL.md must start with YAML frontmatter");
  const match = frontmatter[1].match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
  if (!match) throw new Error(`SKILL.md frontmatter must contain ${field}`);
  return match[1].trim();
}

function validateSkillFiles(skillFolder, files) {
  const skillFile = files.find((entry) => entry.name === `${skillFolder}/SKILL.md`);
  if (!skillFile) throw new Error(`${skillFolder} must contain SKILL.md`);
  if (frontmatterField(skillFile.content, "name") !== skillFolder) {
    throw new Error(`${skillFolder} must match its SKILL.md frontmatter name`);
  }
  const description = frontmatterField(skillFile.content, "description");
  if (description.length === 0 || description.length > 1024) {
    throw new Error(`${skillFolder} SKILL.md description must contain 1 to 1024 characters`);
  }

  const companionFiles = files.filter((entry) => entry.name !== `${skillFolder}/SKILL.md`);
  if (companionFiles.length > MAX_COMPANION_FILES) {
    throw new Error(`${skillFolder} must contain at most 20 companion files`);
  }
  let companionBytes = 0;
  for (const companion of companionFiles) {
    if (companion.content.length > MAX_COMPANION_BYTES) {
      throw new Error(`${companion.name} must be no larger than 5 MB`);
    }
    companionBytes += companion.content.length;
  }
  if (companionBytes > MAX_COMPANION_TOTAL_BYTES) {
    throw new Error(`${skillFolder} companion files must total no more than 10 MB`);
  }
}

async function collectSkills(skillsDirectory) {
  const entries = await collectDirectoryFiles(skillsDirectory);
  const folders = [...new Set(entries.map((entry) => entry.name.split("/")[0]))];
  if (folders.length === 0 || folders.length > MAX_SKILLS) {
    throw new Error("Microsoft Cowork packages must contain between 1 and 20 skills");
  }
  for (const folder of folders) {
    validateSkillFiles(folder, entries.filter((entry) => entry.name.startsWith(`${folder}/`)));
  }
  return { folders, entries };
}

function pngDimensions(content, label) {
  const expectedSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (content.length < 24 || !content.subarray(0, 8).equals(expectedSignature) || content.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error(`${label} must be a PNG`);
  }
  return { width: content.readUInt32BE(16), height: content.readUInt32BE(20) };
}

function validateToolsDocument(content) {
  let document;
  try {
    document = JSON.parse(content.toString("utf8"));
  } catch (error) {
    throw new Error(`Microsoft Cowork tool description must be valid JSON: ${error.message}`);
  }
  const tools = document?.tools;
  const expectedNames = ["rechercher_artisans", "contacter_artisan", "creer_profil_artisan"];
  if (!Array.isArray(tools) || JSON.stringify(tools.map((tool) => tool?.name)) !== JSON.stringify(expectedNames)) {
    throw new Error("Microsoft Cowork tool description must expose the three current RenooLab tools in order");
  }
  const expectedAnnotations = [
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  ];
  for (let index = 0; index < tools.length; index += 1) {
    const tool = tools[index];
    if (
      typeof tool.title !== "string" ||
      typeof tool.description !== "string" ||
      tool.inputSchema?.type !== "object" ||
      tool.outputSchema?.type !== "object" ||
      JSON.stringify(tool.annotations) !== JSON.stringify(expectedAnnotations[index]) ||
      tool._meta !== undefined
    ) {
      throw new Error(`Microsoft Cowork tool description is incomplete or unsafe: ${expectedNames[index]}`);
    }
  }
  return document;
}

function createManifest(version, skillFolders) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`package.json version must be strict semver: ${version}`);
  }
  return {
    $schema: MICROSOFT_SCHEMA_URL,
    manifestVersion: "1.28",
    version,
    id: MICROSOFT_APP_ID,
    developer: {
      name: "RenooLab",
      websiteUrl: "https://renoolab.fr/mcp/",
      privacyUrl: "https://renoolab.fr/privacy/",
      termsOfUseUrl: "https://renoolab.fr/cgu/",
    },
    name: {
      short: "RenooLab",
      full: "RenooLab – Artisans et rénovation",
    },
    description: {
      short: "Trouvez des artisans et préparez vos travaux en France avec RenooLab.",
      full: "Utilisez les workflows RenooLab et son serveur MCP pour préparer un projet de rénovation, identifier le bon métier, rechercher des artisans près d’une ville française, déposer une demande de contact modérée ou créer un profil professionnel inactif à la demande explicite de l’artisan.",
    },
    localizationInfo: {
      defaultLanguageTag: "fr-FR",
    },
    icons: {
      color: "color.png",
      outline: "outline.png",
    },
    accentColor: "#A855F7",
    agentSkills: skillFolders.map((folder) => ({ folder: `./skills/${folder}` })),
    agentConnectors: [{
      id: "renoolab-mcp",
      displayName: "RenooLab — Artisans en France",
      description: "Recherche et services RenooLab pour les artisans du bâtiment en France.",
      toolSource: {
        remoteMcpServer: {
          mcpServerUrl: MCP_ENDPOINT,
          mcpToolDescription: {
            file: "./tools/renoolab-tools.json",
          },
        },
      },
    }],
  };
}

export async function buildMicrosoftCoworkPlugin({
  outputFile,
  repositoryRoot = defaultRepositoryRoot,
} = {}) {
  if (typeof outputFile !== "string" || outputFile.length === 0) {
    throw new Error("outputFile is required");
  }
  if (typeof repositoryRoot !== "string" || repositoryRoot.length === 0) {
    throw new Error("repositoryRoot is required");
  }

  const resolvedRepositoryRoot = resolve(repositoryRoot);
  const resolvedOutputFile = resolve(outputFile);
  const skillsDirectory = join(resolvedRepositoryRoot, "skills");
  const distributionDirectory = join(resolvedRepositoryRoot, "distribution", "microsoft");
  const distDirectory = join(resolvedRepositoryRoot, "dist");
  if (isWithin(resolvedRepositoryRoot, resolvedOutputFile) && !isWithin(distDirectory, resolvedOutputFile)) {
    throw new Error("outputFile must be written under dist or outside the repository");
  }

  const packageDocument = JSON.parse((await readCanonicalFile(
    join(resolvedRepositoryRoot, "package.json"),
    "package.json",
  )).toString("utf8"));
  const { folders, entries: skillEntries } = await collectSkills(skillsDirectory);
  const colorIcon = await readCanonicalFile(
    join(distributionDirectory, "assets", "color.png"),
    "distribution/microsoft/assets/color.png",
  );
  const outlineIcon = await readCanonicalFile(
    join(distributionDirectory, "assets", "outline.png"),
    "distribution/microsoft/assets/outline.png",
  );
  if (JSON.stringify(pngDimensions(colorIcon, "color.png")) !== JSON.stringify({ width: 192, height: 192 })) {
    throw new Error("Microsoft Cowork color.png must be exactly 192x192");
  }
  if (JSON.stringify(pngDimensions(outlineIcon, "outline.png")) !== JSON.stringify({ width: 32, height: 32 })) {
    throw new Error("Microsoft Cowork outline.png must be exactly 32x32");
  }
  const toolDescription = await readCanonicalFile(
    join(distributionDirectory, "tools", "renoolab-tools.json"),
    "distribution/microsoft/tools/renoolab-tools.json",
  );
  validateToolsDocument(toolDescription);

  const manifest = createManifest(packageDocument.version, folders);
  const archive = createStoredZip([
    { name: "manifest.json", content: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8") },
    { name: "color.png", content: colorIcon },
    { name: "outline.png", content: outlineIcon },
    { name: "tools/renoolab-tools.json", content: toolDescription },
    ...skillEntries.map((entry) => ({ name: `skills/${entry.name}`, content: entry.content })),
  ]);
  if (archive.length >= MAX_PLUGIN_BYTES) {
    throw new Error("Microsoft Cowork plugin ZIP must be smaller than 10 MB");
  }

  await mkdir(dirname(resolvedOutputFile), { recursive: true });
  await writeFile(resolvedOutputFile, archive);
  return {
    outputFile: resolvedOutputFile,
    size: archive.length,
    skills: folders.length,
    tools: 3,
  };
}

function cliOutputFile(argv) {
  if (argv.length !== 2 || argv[0] !== "--output" || argv[1].length === 0) {
    throw new Error("Usage: node scripts/build-microsoft-cowork-plugin.mjs --output <file>");
  }
  return argv[1];
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = await buildMicrosoftCoworkPlugin({ outputFile: cliOutputFile(process.argv.slice(2)) });
  console.log(`Generated Microsoft Cowork plugin ZIP: ${result.outputFile} (${result.size} bytes, ${result.skills} skills, ${result.tools} tools).`);
}