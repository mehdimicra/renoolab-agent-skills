# Kiro Power v0.5.3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish RenooLab Agent Skills v0.5.3 with a dual-format Kiro compatibility layer, prove it in Kiro IDE 1.0.288 without write actions, and synchronize every first-party distribution surface.

**Architecture:** `plugin.json` remains the canonical Agent Plugins manifest. Root `POWER.md` supplies the legacy Kiro card metadata and shared steering body; `dev.kiro/INSTRUCTIONS.md` mirrors only that body for the Agent Plugins activation path observed in Kiro 1.0.288. Existing skills and MCP configuration remain unchanged. Publication is blocked until automated validation and two read-only Kiro smokes pass.

**Tech Stack:** Node.js 20 ESM, PowerShell, Ajv 8.20.0, Agent Plugins 1.0.0 schemas, GitHub CLI 2.92+, Kiro IDE 1.0.288, React/Vite website, GitHub Actions, Cloudflare Pages.

## Global Constraints

- Work directly in the existing clean repositories; do not create a Git worktree.
- `plugin.json` is canonical. Keep `mcp.json` limited to logical server `renoolab`, `streamable-http`, and `https://mcp.renoolab.fr/mcp`.
- Add no secret, static credential, authorization header, token, or pre-approved tool.
- The Kiro smoke may call only `rechercher_artisans`; never call `contacter_artisan` or `creer_profil_artisan`.
- Keep all fifteen activation keywords exactly aligned between `plugin.json` and `POWER.md`.
- Preserve the ten existing skills and their generated content.
- Do not modify the MCP live runtime, OAuth, OpenAI review, candidate v3, or A2A.
- Do not rewrite or delete v0.5.2 artifacts. v0.5.3 uses a new immutable tag and versioned directory.
- Do not submit the Kiro Gallery form until the public GitHub import passes; Mehdi must personally accept the publisher terms.

---

## File map

- Create `POWER.md`: legacy Kiro card metadata plus shared steering.
- Create `dev.kiro/INSTRUCTIONS.md`: Kiro 1.0.288 instruction shim; body identical to `POWER.md` after frontmatter.
- Create `scripts/test-kiro-compat.mjs`: validates metadata synchronization, instructions, safety, ten skills, and absence of secrets.
- Modify `package.json`: add the Kiro compatibility test and bump to 0.5.3.
- Modify `package-lock.json`, `skill.json`, `plugin.json`, `gemini-extension.json`, `.claude-plugin/*`, `.codex-plugin/plugin.json`, `.cursor-plugin/plugin.json`, `.github/plugin/plugin.json`: synchronize 0.5.3.
- Modify `README.md`: document the dual-format Kiro behavior and update versioned commands/assets.
- Modify `scripts/test-discovery-artifacts.mjs`, `scripts/test-microsoft-cowork-plugin.mjs`, `scripts/validate-agent-plugins.mjs`: synchronize release assertions.
- Add `website/public/.well-known/agent-skills/packages/v0.5.3/*`: ten immutable tarballs and two ZIPs.
- Modify `website/public/.well-known/agent-skills/index.json`, `website/public/.well-known/ai-catalog.json`, `website/public/llms.txt`, `website/src/pages/Mcp.tsx`, `website/scripts/test-agent-discovery.mjs`: publish and verify v0.5.3.
- Modify the existing xAI marketplace PR files only after the release SHA is public and only if its review state remains safe to repin.
- Modify `SPRINT_LOG.md` and `docs/mcp-aeo-distribution.md` after live verification.

---

### Task 1: Add the Kiro compatibility contract test-first

**Files:**
- Create: `scripts/test-kiro-compat.mjs`
- Modify: `package.json`
- Create after the RED proof: `POWER.md`
- Create after the RED proof: `dev.kiro/INSTRUCTIONS.md`

**Interfaces:**
- Consumes: `plugin.json`, `mcp.json`, and generated `skills/*/SKILL.md`.
- Produces: `npm run test:kiro-compat`, root legacy metadata, and the shared Kiro steering body.

- [ ] **Step 1: Read the TDD test-quality rules before changing the validator**

Read completely:

```powershell
Get-Content -Raw 'C:\Users\mehdi\.codex\plugins\cache\claude-plugins-official\superpowers\6.2.0\skills\test-driven-development\writing-good-tests.md'
```

- [ ] **Step 2: Create the failing Kiro compatibility test**

Create `scripts/test-kiro-compat.mjs` with real filesystem assertions. The core contract must be:

```js
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readRequiredText(path, label) {
  try {
    return (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
  } catch (error) {
    if (error.code === "ENOENT") assert.fail(`${label} must exist`);
    throw error;
  }
}

function splitPower(source) {
  const match = /^---\n([\s\S]+?)\n---\n\n([\s\S]+)\n?$/.exec(source);
  assert.ok(match, "POWER.md must contain YAML frontmatter and a non-empty Markdown body");
  return { frontmatter: match[1], body: `${match[2].trim()}\n` };
}

const plugin = JSON.parse(await readFile(join(repositoryRoot, "plugin.json"), "utf8"));
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

assert.equal(frontmatter, expectedFrontmatter);
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

assert.ok(!body.includes("power-renoolab-agent-skills-renoolab"));
assert.doesNotMatch(powerSource, /Authorization:|Bearer\s|API_KEY=|ACCESS_TOKEN=/i);

const skillEntries = await readdir(join(repositoryRoot, "skills"), { withFileTypes: true });
const skillNames = [];
for (const entry of skillEntries) {
  if (!entry.isDirectory()) continue;
  await readRequiredText(join(repositoryRoot, "skills", entry.name, "SKILL.md"), `${entry.name}/SKILL.md`);
  skillNames.push(entry.name);
}
assert.equal(skillNames.length, 10, "Kiro Power must expose exactly ten Agent Skills");

console.log("Validated Kiro dual-format compatibility with ten skills and read-only-first steering.");
```

Add this package script and insert it into the aggregate `test` command immediately after `validate:agent-plugins`:

```json
"test:kiro-compat": "node scripts/test-kiro-compat.mjs"
```

- [ ] **Step 3: Run the focused test and prove RED**

Run:

```powershell
npm run test:kiro-compat
```

Expected: non-zero exit with `root POWER.md must exist`. Any syntax/import failure is the wrong RED and must be corrected before proceeding.

- [ ] **Step 4: Add the minimal dual-format artifacts**

Create root `POWER.md` exactly as follows:

```markdown
---
name: "renoolab"
displayName: "RenooLab"
description: "Prepare home renovation projects, find French tradespeople, and run an artisan or construction business with 10 French Agent Skills and the optional RenooLab MCP."
keywords: ["renoolab","rénovation","renovation","travaux","artisan","artisans","tradespeople","contractors","bâtiment","construction","home improvement","plombier","plumber","électricien","electrician"]
author: "RenooLab"
repository: "https://github.com/mehdimicra/renoolab-agent-skills"
license: "Apache-2.0"
---

## Overview

RenooLab fournit dix workflows spécialisés en français pour préparer des travaux, piloter une activité artisanale et trouver des artisans en France.

## Available MCP Servers

- `renoolab` : serveur distant RenooLab déclaré dans `mcp.json`. L’hôte gère OAuth ; aucun secret n’est fourni par ce Power.

## Tool Usage

- Pour une recherche locale réelle, utiliser uniquement `rechercher_artisans` et ne présenter que les profils et URL effectivement renvoyés.
- Ne jamais inventer un profil, une disponibilité, un résultat ou une URL.
- `contacter_artisan` et `creer_profil_artisan` ont des effets externes : les appeler uniquement après une demande explicite et une confirmation explicite de l’utilisateur.
- Pour une demande de conseil sans recherche réelle, charger le skill le plus pertinent sans appeler le MCP inutilement.

## Configuration

Le serveur distant et son authentification sont déclarés dans `mcp.json`.

- Privacy: https://renoolab.fr/privacy/
- Support: contact@renoolab.fr
- License: Apache-2.0
```

Create `dev.kiro/INSTRUCTIONS.md` with exactly the same content starting at `## Overview` and ending at `- License: Apache-2.0`, with no YAML frontmatter.

- [ ] **Step 5: Prove GREEN and run the existing Agent Plugins validator**

Run:

```powershell
npm run test:kiro-compat
npm run validate:agent-plugins
git diff --check
```

Expected: both validators exit 0; the focused test reports ten skills.

- [ ] **Step 6: Commit the self-contained compatibility layer**

```powershell
git add -- POWER.md dev.kiro/INSTRUCTIONS.md scripts/test-kiro-compat.mjs package.json
git diff --cached --check
git commit -m "Add Kiro dual-format compatibility"
```

---

### Task 2: Synchronize the complete v0.5.3 release

**Files:**
- Modify: `.claude-plugin/marketplace.json`
- Modify: `.claude-plugin/plugin.json`
- Modify: `.codex-plugin/plugin.json`
- Modify: `.cursor-plugin/plugin.json`
- Modify: `.github/plugin/plugin.json`
- Modify: `gemini-extension.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `plugin.json`
- Modify: `skill.json`
- Modify: `README.md`
- Modify: `scripts/test-discovery-artifacts.mjs`
- Modify: `scripts/test-microsoft-cowork-plugin.mjs`
- Modify: `scripts/validate-agent-plugins.mjs`

**Interfaces:**
- Consumes: Task 1 dual-format artifacts.
- Produces: one internally consistent 0.5.3 candidate; the design document retains historical v0.5.2 references.

- [ ] **Step 1: Change only package and lock versions to create the release-consistency RED**

```powershell
npm version 0.5.3 --no-git-tag-version
npm run validate
```

Expected: validation fails because release-bearing manifests still announce 0.5.2.

- [ ] **Step 2: Update every active version surface**

Replace `0.5.2` with `0.5.3` only in:

```text
.claude-plugin/marketplace.json
.claude-plugin/plugin.json
.codex-plugin/plugin.json
.cursor-plugin/plugin.json
.github/plugin/plugin.json
gemini-extension.json
plugin.json
skill.json
README.md
scripts/test-discovery-artifacts.mjs
scripts/test-microsoft-cowork-plugin.mjs
scripts/validate-agent-plugins.mjs
```

Do not alter `docs/superpowers/specs/2026-08-11-kiro-power-v0.5.3-design.md`; its v0.5.2 references describe the prior state.

Update the Kiro README section to state that `plugin.json` is the current canonical format, while `POWER.md` and `dev.kiro/INSTRUCTIONS.md` are synchronized Kiro 1.0.288 compatibility shims. Keep the official creation, installation, and submission links.

- [ ] **Step 3: Prove the synchronized release GREEN**

```powershell
npm run generate
npm run validate
npm run test:kiro-compat
npm run discovery:test
npm run microsoft:test
rg --hidden -n '0\.5\.2|v0\.5\.2' -g '!/.git/**' -g '!docs/superpowers/specs/2026-08-11-kiro-power-v0.5.3-design.md'
git diff --check
```

Expected: all commands exit 0; `rg` returns no active 0.5.2 reference.

- [ ] **Step 4: Commit the synchronized version**

```powershell
git add -- .claude-plugin .codex-plugin .cursor-plugin .github/plugin gemini-extension.json package.json package-lock.json plugin.json skill.json README.md scripts/test-discovery-artifacts.mjs scripts/test-microsoft-cowork-plugin.mjs scripts/validate-agent-plugins.mjs
git diff --cached --check
git commit -m "Prepare RenooLab Agent Skills v0.5.3"
```

---

### Task 3: Validate the candidate and block release on Kiro regressions

**Files:**
- Verify only: complete Agent Skills repository.
- Read host evidence: `%USERPROFILE%\.kiro\sessions\**\messages.jsonl`, latest `%USERPROFILE%\.kiro\logs\*\powers.log`, and `mcp.log`.

**Interfaces:**
- Consumes: committed 0.5.3 candidate.
- Produces: automated green matrix plus fresh local Kiro evidence.

- [ ] **Step 1: Run the complete local release matrix from a clean dependency state**

```powershell
npm ci
python -m venv .venv
& '.\.venv\Scripts\python.exe' -m pip install -r requirements-dev.txt
npm test
npm run validate:skills-ref
npm run validate:gemini
npm run validate:agent-plugins
npx --yes @anthropic-ai/claude-code@2.1.220 plugin validate --strict .
& 'C:\Program Files\GitHub CLI\gh.exe' skill publish --dry-run .
npm audit
git diff --exit-code
git diff --check
```

Expected: every command exits 0; generation leaves no tracked diff.

- [ ] **Step 2: Preserve the current Kiro configuration before the candidate import**

Record the current Kiro version, installed Power commit, and disabled write tools. Copy only these small JSON files to a timestamped temporary backup directory:

```powershell
$kiroBackup = Join-Path $env:TEMP ('renoolab-kiro-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $kiroBackup | Out-Null
Copy-Item -LiteralPath "$env:USERPROFILE\.kiro\settings\mcp.json" -Destination $kiroBackup
Copy-Item -LiteralPath "$env:USERPROFILE\.kiro\powers\installed.json" -Destination $kiroBackup
Copy-Item -LiteralPath "$env:USERPROFILE\.kiro\powers\registries\user-added.json" -Destination $kiroBackup
```

Do not delete or recursively purge `%USERPROFILE%\.kiro`.

- [ ] **Step 3: Perform a fresh local-folder Kiro import**

Using Kiro IDE 1.0.288 in supervised mode, uninstall only the current RenooLab custom Power, reload Kiro, then choose **Powers → Add Custom Power → Import power from a folder** and select:

```text
C:\Users\mehdi\Documents\renoolab-agent-skills
```

Use computer control for navigation. Mehdi performs only sign-in, OAuth consent, CAPTCHA, or equivalent identity gates. Confirm before prompts:

- card title, canonical description, author, and version 0.5.3 are populated;
- Try Power opens without a missing `POWER.md` or `INSTRUCTIONS.md` error;
- activation enumerates exactly ten skills;
- MCP shows only `rechercher_artisans` enabled; disable `contacter_artisan` and `creer_profil_artisan` before any prompt;
- OAuth remains host-managed and no token is copied.

- [ ] **Step 4: Run the two read-only candidate smokes**

Explicit prompt:

```text
Utilise le Power RenooLab et appelle uniquement rechercher_artisans pour trouver des plombiers à Marseille. N'appelle aucun autre outil. Ne contacte personne et ne crée aucun profil. Restitue uniquement les profils et liens réellement renvoyés.
```

Fresh-session natural prompt:

```text
Je cherche un carreleur à Aix-en-Provence. Trouve-moi des profils disponibles à proximité. Ne contacte personne et ne crée aucun profil.
```

Pass criteria: automatic Power activation, exactly one search call per session, real returned profiles/links, and no write call.

- [ ] **Step 5: Verify the new JSONL sessions instead of trusting the rendered UI**

For each new `messages.jsonl`, parse `payload.type === "tool_call"` and `payload.toolName === "kiro_powers"`. The `args.action === "use"` events must contain only:

```json
{
  "serverName": "renoolab",
  "toolName": "rechercher_artisans"
}
```

Reject the candidate if any use call names `contacter_artisan` or `creer_profil_artisan`, if the activation result lists fewer than ten skills, or if the tool result is not `artisan_results`. Inspect the latest `powers.log` and `mcp.log` for import or activation errors. Keep only counts, tool names, timestamps, and screenshots; never expose OAuth/session contents.

- [ ] **Step 6: Record the candidate review commit**

```powershell
git status --short --branch
git log -3 --oneline
```

Do not tag if any automated or Kiro gate is red. On failure, reinstall the public v0.5.2 Power from GitHub and restore only the backed-up Kiro JSON files after confirming their target paths.

---

### Task 4: Publish the immutable Agent Skills v0.5.3 release

**Files:**
- Publish: Agent Skills `main`, tag `v0.5.3`, GitHub Release.
- Generate locally: `dist/release-v0.5.3/renoolab-trouver-choisir-artisans.zip`
- Generate locally: `dist/release-v0.5.3/renoolab-microsoft-cowork.zip`

**Interfaces:**
- Consumes: Task 3 green candidate.
- Produces: immutable public release SHA and two audited downloadable ZIP assets.

- [ ] **Step 1: Push the exact candidate and require green CI**

```powershell
git fetch origin main
git rev-list --left-right --count HEAD...origin/main
git push origin main
$releaseSha = git rev-parse HEAD
$gh = 'C:\Program Files\GitHub CLI\gh.exe'
$run = $null
for ($attempt = 0; $attempt -lt 30 -and $null -eq $run; $attempt++) {
  $runs = & $gh run list --repo mehdimicra/renoolab-agent-skills --workflow validate.yml --branch main --limit 10 --json databaseId,headSha,status,conclusion | ConvertFrom-Json
  $run = $runs | Where-Object { $_.headSha -eq $releaseSha } | Select-Object -First 1
  if ($null -eq $run) { Start-Sleep -Seconds 2 }
}
if ($null -eq $run) { throw 'No validation run appeared for the release SHA' }
& $gh run watch $run.databaseId --repo mehdimicra/renoolab-agent-skills --exit-status
```

Expected: the run for `$releaseSha` completes successfully.

- [ ] **Step 2: Build the two release ZIPs from the frozen SHA**

```powershell
$releaseDir = Join-Path (Resolve-Path .) 'dist\release-v0.5.3'
if (Test-Path $releaseDir) {
  $resolved = [IO.Path]::GetFullPath($releaseDir)
  $allowed = [IO.Path]::GetFullPath((Join-Path (Resolve-Path .) 'dist'))
  if (!$resolved.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe release directory' }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
New-Item -ItemType Directory -Path $releaseDir | Out-Null
node scripts/build-perplexity-skill.mjs --output "$releaseDir\renoolab-trouver-choisir-artisans.zip"
node scripts/build-microsoft-cowork-plugin.mjs --output "$releaseDir\renoolab-microsoft-cowork.zip"
Get-FileHash "$releaseDir\*.zip" -Algorithm SHA256
```

- [ ] **Step 3: Publish one new tag/release using the official GitHub Skills command**

```powershell
& $gh skill publish --dry-run .
& $gh skill publish --tag v0.5.3 .
git fetch origin tag v0.5.3
$tagSha = git rev-parse 'v0.5.3^{commit}'
if ($tagSha -ne $releaseSha) { throw 'v0.5.3 tag does not match the validated release SHA' }
```

Never create the tag or release separately before `gh skill publish --tag`; that command creates both.

- [ ] **Step 4: Upload and independently verify release assets**

```powershell
& $gh release upload v0.5.3 "$releaseDir\renoolab-trouver-choisir-artisans.zip" "$releaseDir\renoolab-microsoft-cowork.zip" --repo mehdimicra/renoolab-agent-skills
& $gh release view v0.5.3 --repo mehdimicra/renoolab-agent-skills --json tagName,isDraft,isPrerelease,assets
```

Download both assets into a new temporary directory, recompute SHA-256, and compare with the local frozen files. Require HTTP/public download success, non-draft, and non-prerelease.

---

### Task 5: Publish v0.5.3 on RenooLab first-party discovery surfaces

**Files:**
- Add: `website/public/.well-known/agent-skills/packages/v0.5.3/*.tar.gz` (ten)
- Add: `website/public/.well-known/agent-skills/packages/v0.5.3/renoolab-trouver-choisir-artisans.zip`
- Add: `website/public/.well-known/agent-skills/packages/v0.5.3/renoolab-microsoft-cowork.zip`
- Modify: `website/public/.well-known/agent-skills/index.json`
- Modify: `website/public/.well-known/ai-catalog.json`
- Modify: `website/public/llms.txt`
- Modify: `website/src/pages/Mcp.tsx`
- Modify: `website/scripts/test-agent-discovery.mjs`

**Interfaces:**
- Consumes: public v0.5.3 source/tag and frozen release ZIPs.
- Produces: versioned ARD/Agent Skills/site artifacts without changing MCP Registry version 1.2.0.

- [ ] **Step 1: Prove the website test is RED for the new version before adding artifacts**

In `website/scripts/test-agent-discovery.mjs`, change only `PUBLIC_PREFIX` and expected release/version labels from 0.5.2 to 0.5.3, leaving current files untouched. Run:

```powershell
node website/scripts/test-agent-discovery.mjs
```

Expected: failure because `packages/v0.5.3` and its artifacts do not exist.

- [ ] **Step 2: Build all twelve immutable artifacts from the tagged source**

From the Agent Skills repository at the exact v0.5.3 SHA:

```powershell
node scripts/build-discovery-artifacts.mjs --output C:\Users\mehdi\Documents\Renogram\website\public\.well-known\agent-skills
node scripts/build-perplexity-skill.mjs --output C:\Users\mehdi\Documents\Renogram\website\public\.well-known\agent-skills\packages\v0.5.3\renoolab-trouver-choisir-artisans.zip
node scripts/build-microsoft-cowork-plugin.mjs --output C:\Users\mehdi\Documents\Renogram\website\public\.well-known\agent-skills\packages\v0.5.3\renoolab-microsoft-cowork.zip
```

Compare the two website ZIPs byte-for-byte with the GitHub Release assets. Require exactly ten tarballs plus two ZIPs in the new directory. Keep the v0.5.2 directory intact.

- [ ] **Step 3: Synchronize catalog, page, and audited digests**

Update all ten ARD skill entries to version 0.5.3, v0.5.3 URLs, and digests from the newly generated `index.json`. Keep the MCP ARD entry at version 1.2.0.

Update Perplexity and Microsoft URLs/version text in `llms.txt` and `Mcp.tsx`. In `test-agent-discovery.mjs`, set:

- the ten tarball SHA-256 values to the hashes actually generated;
- the Perplexity ZIP SHA-256 to the frozen release hash;
- the Microsoft Cowork ZIP SHA-256 to the frozen release hash;
- Microsoft manifest and ARD Skill versions to `0.5.3`;
- every audited-release message to `v0.5.3`.

- [ ] **Step 4: Prove GREEN locally**

```powershell
node website/scripts/test-agent-discovery.mjs
npm --prefix website ci
npm --prefix website run build:native
git diff --check
```

Expected: discovery validates ten archives plus eleven ARD entries; native build and artifact verification exit 0.

- [ ] **Step 5: Commit, push, and require the production workflow to verify the exact commit**

```powershell
git add -- website/public/.well-known/agent-skills website/public/.well-known/ai-catalog.json website/public/llms.txt website/src/pages/Mcp.tsx website/scripts/test-agent-discovery.mjs
git diff --cached --check
git commit -m "Publish Agent Skills v0.5.3 discovery artifacts"
git push origin main
$websiteSha = git rev-parse HEAD
$websiteRun = $null
for ($attempt = 0; $attempt -lt 30 -and $null -eq $websiteRun; $attempt++) {
  $websiteRuns = & $gh run list --repo mehdimicra/renoolab-app --workflow deploy-website.yml --branch main --limit 10 --json databaseId,headSha,status,conclusion | ConvertFrom-Json
  $websiteRun = $websiteRuns | Where-Object { $_.headSha -eq $websiteSha } | Select-Object -First 1
  if ($null -eq $websiteRun) { Start-Sleep -Seconds 2 }
}
if ($null -eq $websiteRun) { throw 'No website deployment run appeared for the publication SHA' }
& $gh run watch $websiteRun.databaseId --repo mehdimicra/renoolab-app --exit-status
```

Expected: build, atomic Cloudflare deployment, public-domain smoke, and IndexNow complete successfully; rollback is not triggered.

- [ ] **Step 6: Verify the live surface independently**

Require:

- live deployment marker equals `$websiteSha` and the watched run ID;
- index has exactly ten v0.5.3 skills;
- AI Catalog has ten v0.5.3 skills plus MCP 1.2.0;
- all twelve v0.5.3 assets return 200 with expected MIME, CORS `*`, immutable cache, and exact SHA-256;
- `/mcp/` and `llms.txt` link both v0.5.3 ZIPs;
- all v0.5.2 immutable URLs still return 200.

---

### Task 6: Re-pin safe reviews, prove the public Kiro import, and close documentation

**Files:**
- Conditionally modify existing xAI marketplace PR branch: `.grok-plugin/marketplace.json`, generated `.grok-plugin/plugin-index.json`.
- Modify: `SPRINT_LOG.md`
- Modify: `docs/mcp-aeo-distribution.md`

**Interfaces:**
- Consumes: public v0.5.3 SHA, live website artifacts, and green Kiro candidate smoke.
- Produces: coherent pending submissions, public GitHub-import evidence, Gallery-ready state, and canonical project trace.

- [ ] **Step 1: Audit every pending review before changing its pin**

Read current PR/issue state. Re-pin xAI `#226` only if it is still open with no human review that would be reset. Keep Awesome Copilot `#2502` at its accepted review pin unless a maintainer asks for an update. Do not reopen Goose `#11118`, alter Docker `#4541`, or claim Gallery discovery.

- [ ] **Step 2: Re-pin xAI safely when the gate permits**

In `C:\Users\mehdi\Documents\Renogram\.worktrees\xai-plugin-marketplace`, replace only RenooLab `source.sha` with the public v0.5.3 SHA, then run:

```powershell
$env:PYTHONUTF8='1'
python scripts/generate-plugin-index.py
python scripts/validate-catalog.py
python scripts/generate-plugin-index.py --check
git diff --check
```

Require the RenooLab index to resolve version 0.5.3 with exactly ten skills plus one MCP. Commit and push only the two marketplace files to the existing PR branch, then update the PR body’s SHA/version references.

- [ ] **Step 3: Perform the fresh public GitHub Kiro import**

Confirm public `main` and tag `v0.5.3` resolve to the same SHA. In Kiro, uninstall only the local candidate Power, reload, and import:

```text
https://github.com/mehdimicra/renoolab-agent-skills
```

Confirm the installed copy reports 0.5.3, the card and Try Power remain populated, activation lists ten skills, and the MCP is constrained to search before prompts. Repeat the explicit Marseille and natural Aix-en-Provence searches. Parse only the new JSONL sessions and require exactly one `rechercher_artisans` use per session and zero write uses.

- [ ] **Step 4: Prepare the Kiro Gallery submission and stop at the legal gate**

Fill the official form with the public repository, organization `RenooLab`, use case `French renovation trades`, and a concise description of the ten workflows plus read-only local professional search. Do not click final Submit until Mehdi personally accepts the Kiro Powers Publisher Terms. After his click, record only the confirmation/status, never credentials.

- [ ] **Step 5: Update canonical documentation with verified facts only**

In `SPRINT_LOG.md` and `docs/mcp-aeo-distribution.md`, record:

- v0.5.3 tag and exact SHA;
- Agent Skills CI and release asset hashes;
- Kiro local and public-import smoke results, ten skills, search-only calls, and zero writes;
- website commit/run and twelve live artifact checks;
- xAI repin state or explicit reason it was left unchanged;
- Kiro Gallery as submitted/in review only after submission confirmation;
- OpenAI review, MCP production version, v3, and A2A unchanged.

Run:

```powershell
git diff --check
git add -- SPRINT_LOG.md docs/mcp-aeo-distribution.md
git commit -m "docs(ai): consigner Agent Skills v0.5.3 [skip ci]"
git push origin main
```

- [ ] **Step 6: Final repository and public-state verification**

```powershell
git status --short --branch
git rev-list --left-right --count HEAD...origin/main
```

Run this in both repositories. Require clean trees and zero divergence. Recheck the GitHub release, live first-party assets, Kiro installed version, pending PR/issue states, and absence of any write tool call in the two final sessions.
