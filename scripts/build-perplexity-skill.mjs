import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createStoredZip } from "./lib/stored-zip.mjs";

const MAX_ARCHIVE_BYTES = 10_000_000;
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
