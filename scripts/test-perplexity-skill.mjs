import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const runFile = promisify(execFile);

const EXPECTED_FILES = [
  "SKILL.md",
  "references/renoolab-actions.md",
  "references/sourcer-equipe-multimetier.md",
  "references/trouver-choisir-artisan.md",
];
const MAX_ARCHIVE_BYTES = 10_000_000;
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(moduleDirectory, "..");
const sourceDirectory = join(repositoryRoot, "skills", "renoolab-trouver-choisir-artisans");

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

let buildPerplexitySkill;
try {
  ({ buildPerplexitySkill } = await import("./build-perplexity-skill.mjs"));
} catch {
  // The first TDD run should fail on the missing production module, not a syntax error.
}
assert.equal(
  typeof buildPerplexitySkill,
  "function",
  "build-perplexity-skill.mjs must export buildPerplexitySkill",
);

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

    assert.equal(archive.readUInt32LE(localOffset), 0x04034b50, "local entry signature must be valid");
    assert.equal(archive.readUInt16LE(localOffset + 8), 0, "local entry must use the stored method");
    const localChecksum = archive.readUInt32LE(localOffset + 14);
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

const temporaryRoot = await mkdtemp(join(tmpdir(), "renoolab-perplexity-skill-"));
try {
  const firstOutput = join(temporaryRoot, "first.zip");
  const secondOutput = join(temporaryRoot, "nested", "second.zip");
  await buildPerplexitySkill({ outputFile: firstOutput });
  await buildPerplexitySkill({ outputFile: secondOutput });

  const firstArchive = await readFile(firstOutput);
  const secondArchive = await readFile(secondOutput);
  assert.deepEqual(firstArchive, secondArchive, "Perplexity ZIP bytes must be deterministic");
  assert.ok(firstArchive.length < MAX_ARCHIVE_BYTES, "Perplexity ZIP must be smaller than 10 MB");

  const files = readStoredZip(firstArchive);
  assert.deepEqual([...files.keys()], EXPECTED_FILES, "ZIP must contain exactly the Perplexity skill files at root");
  for (const path of EXPECTED_FILES) {
    const source = await readFile(join(sourceDirectory, ...path.split("/")));
    assert.deepEqual(files.get(path), source, `${path} bytes must match the canonical source`);
  }

  const cliOutput = join(temporaryRoot, "cli", "renoolab-perplexity.zip");
  const cliResult = await runFile(
    process.execPath,
    [join(moduleDirectory, "build-perplexity-skill.mjs"), "--output", cliOutput],
    { cwd: repositoryRoot },
  );
  assert.equal(cliResult.stderr, "", "CLI must not write to stderr");
  assert.match(cliResult.stdout, /Generated Perplexity skill ZIP:/);
  assert.deepEqual(await readFile(cliOutput), firstArchive, "CLI and API must produce identical bytes");
  await assert.rejects(
    runFile(process.execPath, [join(moduleDirectory, "build-perplexity-skill.mjs")]),
    (error) => {
      assert.match(error.stderr, /Usage: node scripts\/build-perplexity-skill\.mjs --output <file>/);
      return true;
    },
  );

  const fixtureDirectory = join(temporaryRoot, "fixture-skill");
  await mkdir(join(fixtureDirectory, "references"), { recursive: true });
  await writeFile(join(fixtureDirectory, "SKILL.md"), "fixture\n");
  await writeFile(join(fixtureDirectory, "references", "safe.md"), "safe\n");
  const buildFixture = (label, entryNames) => buildPerplexitySkill({
    outputFile: join(temporaryRoot, "rejections", `${label}.zip`),
    sourceDirectory: fixtureDirectory,
    entryNames,
  });

  await assert.rejects(
    buildFixture("duplicate", ["SKILL.md", "SKILL.md"]),
    /duplicate ZIP entry path/i,
  );
  for (const unsafePath of ["../outside.md", "/absolute.md", "references\\safe.md"]) {
    await assert.rejects(
      buildFixture("unsafe", [unsafePath]),
      /unsafe ZIP entry path/i,
    );
  }
  await assert.rejects(
    buildPerplexitySkill({
      outputFile: join(fixtureDirectory, "generated.zip"),
      sourceDirectory: fixtureDirectory,
      entryNames: ["SKILL.md"],
    }),
    /outputFile must not overwrite the skill source directory/i,
  );

  const realDirectory = join(fixtureDirectory, "real-references");
  const linkedDirectory = join(fixtureDirectory, "linked-references");
  await mkdir(realDirectory);
  await writeFile(join(realDirectory, "linked.md"), "linked\n");
  await symlink(realDirectory, linkedDirectory, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(
    buildFixture("symlink", ["linked-references/linked.md"]),
    /symlinks are not allowed/i,
  );

  await writeFile(join(fixtureDirectory, "oversized.bin"), Buffer.alloc(MAX_ARCHIVE_BYTES));
  await assert.rejects(
    buildFixture("oversized", ["oversized.bin"]),
    /smaller than 10 MB/i,
  );

  console.log("Validated deterministic Perplexity ZIP contents, CLI output, and safety rejections.");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
