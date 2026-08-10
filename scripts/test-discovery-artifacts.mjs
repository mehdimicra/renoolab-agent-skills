import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { gunzipSync } from "node:zlib";
import { buildDiscoveryArtifacts } from "./build-discovery-artifacts.mjs";

const EXPECTED_SKILLS = [
  "renoolab-chiffrer-piloter-rentabilite",
  "renoolab-creer-profil-artisan",
  "renoolab-developper-clientele-visibilite-btp",
  "renoolab-diagnostiquer-securiser-logement",
  "renoolab-imaginer-arbitrer-renovation",
  "renoolab-lancer-entreprise-artisanale",
  "renoolab-organiser-chantier-equipe-btp",
  "renoolab-piloter-receptionner-travaux",
  "renoolab-planifier-budgeter-travaux",
  "renoolab-trouver-choisir-artisans",
];
const PUBLIC_BASE_URL = "https://renoolab.fr/.well-known/agent-skills/packages/v0.5.0";

function readTarFiles(archive) {
  const tar = gunzipSync(archive);
  const files = new Map();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const readString = (start, length) => header.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "");
    const name = readString(0, 100);
    const prefix = readString(345, 155);
    const path = prefix ? `${prefix}/${name}` : name;
    const sizeText = readString(124, 12).trim();
    const size = sizeText ? Number.parseInt(sizeText, 8) : 0;
    const type = readString(156, 1) || "0";
    offset += 512;
    if (type === "0") files.set(path, tar.subarray(offset, offset + size));
    offset += Math.ceil(size / 512) * 512;
  }
  return files;
}

async function listSourceFiles(directory, root = directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await listSourceFiles(path, root));
    else if (entry.isFile()) paths.push(relative(root, path).replaceAll("\\", "/"));
    else throw new Error(`Unsupported test fixture entry: ${path}`);
  }
  return paths.sort();
}

function frontmatterDescription(skillMd) {
  const match = skillMd.match(/^---\r?\n[\s\S]*?^description:\s*(.+)\r?\n[\s\S]*?^---$/m);
  assert.ok(match, "SKILL.md must contain a description in frontmatter");
  const value = match[1].trim();
  return value.startsWith('"') ? JSON.parse(value) : value;
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "renoolab-skill-discovery-"));
try {
  const firstOutput = join(temporaryRoot, "first");
  const secondOutput = join(temporaryRoot, "second");
  await buildDiscoveryArtifacts({ outputDir: firstOutput, publicBaseUrl: PUBLIC_BASE_URL });
  await buildDiscoveryArtifacts({ outputDir: secondOutput, publicBaseUrl: PUBLIC_BASE_URL });

  const firstIndexBytes = await readFile(join(firstOutput, "index.json"));
  const secondIndexBytes = await readFile(join(secondOutput, "index.json"));
  assert.deepEqual(firstIndexBytes, secondIndexBytes, "index bytes must be deterministic");

  const index = JSON.parse(firstIndexBytes.toString("utf8"));
  assert.equal(index.$schema, "https://schemas.agentskills.io/discovery/0.2.0/schema.json");
  assert.deepEqual(index.skills.map((skill) => skill.name), EXPECTED_SKILLS);
  assert.equal(new Set(index.skills.map((skill) => skill.name)).size, EXPECTED_SKILLS.length);

  for (const entry of index.skills) {
    assert.equal(entry.type, "archive");
    assert.equal(entry.url, `${PUBLIC_BASE_URL}/${entry.name}.tar.gz`);
    assert.match(entry.digest, /^sha256:[0-9a-f]{64}$/);

    const archiveName = basename(new URL(entry.url).pathname);
    const firstArchive = await readFile(join(firstOutput, "packages", "v0.5.0", archiveName));
    const secondArchive = await readFile(join(secondOutput, "packages", "v0.5.0", archiveName));
    assert.deepEqual(firstArchive, secondArchive, `${entry.name} archive bytes must be deterministic`);
    assert.equal(`sha256:${createHash("sha256").update(firstArchive).digest("hex")}`, entry.digest);

    const archiveFiles = readTarFiles(firstArchive);
    const skillRoot = join(process.cwd(), "skills", entry.name);
    const expectedRelativeFiles = await listSourceFiles(skillRoot);
    assert.deepEqual([...archiveFiles.keys()], expectedRelativeFiles.map((path) => `${entry.name}/${path}`));

    const skillMdBytes = archiveFiles.get(`${entry.name}/SKILL.md`);
    assert.ok(skillMdBytes, `${entry.name} archive must contain SKILL.md`);
    assert.equal(entry.description, frontmatterDescription(skillMdBytes.toString("utf8")));
  }

  console.log(`Validated deterministic discovery artifacts for ${EXPECTED_SKILLS.length} skills.`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}