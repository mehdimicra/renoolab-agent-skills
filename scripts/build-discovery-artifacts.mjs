import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const DISCOVERY_SCHEMA = "https://schemas.agentskills.io/discovery/0.2.0/schema.json";
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(moduleDirectory, "..");
const defaultSkillsDirectory = join(repositoryRoot, "skills");
const packageDocument = JSON.parse(
  await readFile(join(repositoryRoot, "package.json"), "utf8")
);
const defaultOutputDirectory = join(repositoryRoot, "dist", "agent-skills-discovery");
const defaultPublicBaseUrl =
  `https://renoolab.fr/.well-known/agent-skills/packages/v${packageDocument.version}`;

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
function assertInside(parent, child) {
  const resolvedParent = resolve(parent);
  const resolvedChild = resolve(child);
  if (!resolvedChild.startsWith(`${resolvedParent}${sep}`)) {
    throw new Error(`Refusing path outside ${resolvedParent}: ${resolvedChild}`);
  }
}

function parseFrontmatter(skillMd, expectedName) {
  const match = skillMd.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`${expectedName}: missing YAML frontmatter`);
  const values = new Map();
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    const value = rawValue.startsWith('"') ? JSON.parse(rawValue) : rawValue;
    values.set(key, value);
  }
  if (values.get("name") !== expectedName) {
    throw new Error(`${expectedName}: frontmatter name mismatch`);
  }
  const description = values.get("description");
  if (typeof description !== "string" || description.length === 0) {
    throw new Error(`${expectedName}: missing frontmatter description`);
  }
  return { name: expectedName, description };
}

async function listRegularFiles(directory, root = directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      throw new Error(`Symlinks are not allowed in discovery archives: ${path}`);
    }
    if (stats.isDirectory()) {
      files.push(...await listRegularFiles(path, root));
    } else if (stats.isFile()) {
      files.push({ path, relativePath: relative(root, path).replaceAll("\\", "/") });
    } else {
      throw new Error(`Unsupported filesystem entry: ${path}`);
    }
  }
  return files.sort((left, right) => compareStrings(left.relativePath, right.relativePath));
}

function writeAscii(buffer, offset, length, value, label) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > length) throw new Error(`${label} exceeds tar field length`);
  bytes.copy(buffer, offset);
}

function octal(value, width) {
  const encoded = value.toString(8);
  if (encoded.length > width - 1) throw new Error(`Value ${value} is too large for tar field`);
  return `${encoded.padStart(width - 1, "0")}\0`;
}

function splitTarPath(path) {
  const bytes = Buffer.byteLength(path, "utf8");
  if (bytes <= 100) return { name: path, prefix: "" };
  for (let index = path.lastIndexOf("/"); index > 0; index = path.lastIndexOf("/", index - 1)) {
    const prefix = path.slice(0, index);
    const name = path.slice(index + 1);
    if (Buffer.byteLength(prefix, "utf8") <= 155 && Buffer.byteLength(name, "utf8") <= 100) {
      return { name, prefix };
    }
  }
  throw new Error(`Tar path is too long: ${path}`);
}

function tarHeader(path, size) {
  const header = Buffer.alloc(512);
  const { name, prefix } = splitTarPath(path);
  writeAscii(header, 0, 100, name, "name");
  writeAscii(header, 100, 8, octal(0o644, 8), "mode");
  writeAscii(header, 108, 8, octal(0, 8), "uid");
  writeAscii(header, 116, 8, octal(0, 8), "gid");
  writeAscii(header, 124, 12, octal(size, 12), "size");
  writeAscii(header, 136, 12, octal(0, 12), "mtime");
  header.fill(0x20, 148, 156);
  writeAscii(header, 156, 1, "0", "typeflag");
  writeAscii(header, 257, 6, "ustar\0", "magic");
  writeAscii(header, 263, 2, "00", "version");
  writeAscii(header, 345, 155, prefix, "prefix");
  const checksum = header.reduce((total, byte) => total + byte, 0);
  writeAscii(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `, "checksum");
  return header;
}

async function createSkillArchive(skillDirectory, skillName) {
  const chunks = [];
  for (const file of await listRegularFiles(skillDirectory)) {
    assertInside(skillDirectory, file.path);
    const content = await readFile(file.path);
    const archivePath = `${skillName}/${file.relativePath}`;
    chunks.push(tarHeader(archivePath, content.length), content);
    const paddingLength = (512 - (content.length % 512)) % 512;
    if (paddingLength > 0) chunks.push(Buffer.alloc(paddingLength));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks), { level: 9, mtime: 0 });
}

function normalizePublicBaseUrl(publicBaseUrl) {
  const url = new URL(publicBaseUrl);
  if (url.protocol !== "https:") throw new Error("publicBaseUrl must use HTTPS");
  return url.toString().replace(/\/$/, "");
}

export async function buildDiscoveryArtifacts({
  outputDir,
  publicBaseUrl,
  skillsDir = defaultSkillsDirectory,
}) {
  if (!outputDir) throw new Error("outputDir is required");
  const normalizedPublicBaseUrl = normalizePublicBaseUrl(publicBaseUrl);
  const resolvedOutputDirectory = resolve(outputDir);
  const resolvedSkillsDirectory = resolve(skillsDir);
  if (resolvedOutputDirectory === repositoryRoot || resolvedOutputDirectory === resolvedSkillsDirectory) {
    throw new Error("outputDir must not overwrite the repository or skills source directory");
  }

  const skillEntries = [];
  for (const entry of await readdir(resolvedSkillsDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillName = entry.name;
    const skillDirectory = join(resolvedSkillsDirectory, skillName);
    assertInside(resolvedSkillsDirectory, skillDirectory);
    const skillMd = await readFile(join(skillDirectory, "SKILL.md"), "utf8");
    const frontmatter = parseFrontmatter(skillMd, skillName);
    const archive = await createSkillArchive(skillDirectory, skillName);
    const archiveName = `${skillName}.tar.gz`;
    const digest = `sha256:${createHash("sha256").update(archive).digest("hex")}`;
    skillEntries.push({
      name: skillName,
      type: "archive",
      description: frontmatter.description,
      url: `${normalizedPublicBaseUrl}/${archiveName}`,
      digest,
      archiveName,
      archive,
    });
  }
  skillEntries.sort((left, right) => compareStrings(left.name, right.name));

  const packagesDirectory = join(resolvedOutputDirectory, "packages");
  await mkdir(packagesDirectory, { recursive: true });
  for (const entry of skillEntries) {
    await writeFile(join(packagesDirectory, entry.archiveName), entry.archive);
  }
  const index = {
    $schema: DISCOVERY_SCHEMA,
    skills: skillEntries.map(({ archiveName: _archiveName, archive: _archive, ...entry }) => entry),
  };
  await writeFile(join(resolvedOutputDirectory, "index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return index;
}

function cliArguments(argv) {
  const values = new Map();
  const allowedKeys = new Set(["--output", "--public-base-url"]);
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!allowedKeys.has(key) || value === undefined) {
      throw new Error("Usage: node scripts/build-discovery-artifacts.mjs [--output <dir>] [--public-base-url <https-url>]");
    }
    values.set(key, value);
  }
  return {
    outputDir: values.get("--output") ?? defaultOutputDirectory,
    publicBaseUrl: values.get("--public-base-url") ?? defaultPublicBaseUrl,
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const options = cliArguments(process.argv.slice(2));
  const index = await buildDiscoveryArtifacts(options);
  console.log(`Generated ${index.skills.length} Agent Skills discovery archives.`);
}