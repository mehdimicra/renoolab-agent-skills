import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MAX_ARCHIVE_BYTES = 10_000_000;
const UTF8_FLAG = 0x0800;
const FIXED_DOS_DATE = 0x0021;
const SKILL_NAME = "renoolab-trouver-choisir-artisans";
const PERPLEXITY_FILES = Object.freeze([
  "SKILL.md",
  "references/renoolab-actions.md",
  "references/sourcer-equipe-multimetier.md",
  "references/trouver-choisir-artisan.md",
]);
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(moduleDirectory, "..");
const defaultSkillDirectory = join(repositoryRoot, "skills", SKILL_NAME);

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
  for (const byte of content) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function localHeader(name, content, checksum) {
  const nameBytes = Buffer.from(name, "utf8");
  const header = Buffer.alloc(30 + nameBytes.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(UTF8_FLAG, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(FIXED_DOS_DATE, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(content.length, 18);
  header.writeUInt32LE(content.length, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt16LE(0, 28);
  nameBytes.copy(header, 30);
  return header;
}

function centralHeader(name, content, checksum, localOffset) {
  const nameBytes = Buffer.from(name, "utf8");
  const header = Buffer.alloc(46 + nameBytes.length);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(UTF8_FLAG, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(FIXED_DOS_DATE, 14);
  header.writeUInt32LE(checksum, 16);
  header.writeUInt32LE(content.length, 20);
  header.writeUInt32LE(content.length, 24);
  header.writeUInt16LE(nameBytes.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(localOffset, 42);
  nameBytes.copy(header, 46);
  return header;
}

function createStoredZip(entries) {
  const localChunks = [];
  const centralChunks = [];
  let localOffset = 0;
  for (const { name, content } of entries) {
    const checksum = crc32(content);
    const header = localHeader(name, content, checksum);
    localChunks.push(header, content);
    centralChunks.push(centralHeader(name, content, checksum, localOffset));
    localOffset += header.length + content.length;
  }
  const centralDirectory = Buffer.concat(centralChunks);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localChunks, centralDirectory, end]);
}

function validateEntryNames(entryNames) {
  if (!Array.isArray(entryNames) || entryNames.length === 0) {
    throw new Error("Perplexity skill entryNames must be a non-empty array");
  }
  const names = [];
  const seen = new Set();
  for (const name of entryNames) {
    const segments = typeof name === "string" ? name.split("/") : [];
    const unsafe =
      typeof name !== "string" ||
      name.length === 0 ||
      name.includes("\0") ||
      name.includes("\\") ||
      name.startsWith("/") ||
      /^[A-Za-z]:/.test(name) ||
      name.normalize("NFC") !== name ||
      Buffer.byteLength(name, "utf8") > 0xffff ||
      segments.some((segment) => segment === "" || segment === "." || segment === "..");
    if (unsafe) throw new Error(`Unsafe ZIP entry path: ${String(name)}`);
    if (seen.has(name)) throw new Error(`Duplicate ZIP entry path: ${name}`);
    seen.add(name);
    names.push(name);
  }
  return names;
}

async function readSourceEntries(sourceDirectory, entryNames) {
  if (typeof sourceDirectory !== "string" || sourceDirectory.length === 0) {
    throw new Error("sourceDirectory is required");
  }
  const resolvedSourceDirectory = resolve(sourceDirectory);
  const rootStats = await lstat(resolvedSourceDirectory);
  if (rootStats.isSymbolicLink()) {
    throw new Error(`Symlinks are not allowed in Perplexity skill sources: ${resolvedSourceDirectory}`);
  }
  if (!rootStats.isDirectory()) {
    throw new Error(`Perplexity skill source must be a directory: ${resolvedSourceDirectory}`);
  }

  const entries = [];
  for (const name of validateEntryNames(entryNames)) {
    const segments = name.split("/");
    const sourceFile = resolve(resolvedSourceDirectory, ...segments);
    if (!sourceFile.startsWith(`${resolvedSourceDirectory}${sep}`)) {
      throw new Error(`Unsafe ZIP entry path: ${name}`);
    }
    let currentPath = resolvedSourceDirectory;
    for (let index = 0; index < segments.length; index += 1) {
      currentPath = join(currentPath, segments[index]);
      const stats = await lstat(currentPath);
      if (stats.isSymbolicLink()) {
        throw new Error(`Symlinks are not allowed in Perplexity skill sources: ${currentPath}`);
      }
      const isLastSegment = index === segments.length - 1;
      if ((isLastSegment && !stats.isFile()) || (!isLastSegment && !stats.isDirectory())) {
        throw new Error(`Perplexity skill sources must be regular files: ${currentPath}`);
      }
    }
    entries.push({ name, content: await readFile(sourceFile) });
  }
  return entries;
}

export async function buildPerplexitySkill({
  outputFile,
  sourceDirectory = defaultSkillDirectory,
  entryNames = PERPLEXITY_FILES,
} = {}) {
  if (typeof outputFile !== "string" || outputFile.length === 0) {
    throw new Error("outputFile is required");
  }
  const resolvedOutputFile = resolve(outputFile);
  if (typeof sourceDirectory === "string") {
    const resolvedSourceDirectory = resolve(sourceDirectory);
    if (
      resolvedOutputFile === resolvedSourceDirectory ||
      resolvedOutputFile.startsWith(`${resolvedSourceDirectory}${sep}`)
    ) {
      throw new Error("outputFile must not overwrite the skill source directory");
    }
  }
  const entries = await readSourceEntries(sourceDirectory, entryNames);
  const archive = createStoredZip(entries);
  if (archive.length >= MAX_ARCHIVE_BYTES) {
    throw new Error("Perplexity skill ZIP must be smaller than 10 MB");
  }
  await mkdir(dirname(resolvedOutputFile), { recursive: true });
  await writeFile(resolvedOutputFile, archive);
  return { outputFile: resolvedOutputFile, size: archive.length };
}
function cliOutputFile(argv) {
  if (argv.length !== 2 || argv[0] !== "--output" || argv[1].length === 0) {
    throw new Error("Usage: node scripts/build-perplexity-skill.mjs --output <file>");
  }
  return argv[1];
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = await buildPerplexitySkill({ outputFile: cliOutputFile(process.argv.slice(2)) });
  console.log(`Generated Perplexity skill ZIP: ${result.outputFile} (${result.size} bytes).`);
}
