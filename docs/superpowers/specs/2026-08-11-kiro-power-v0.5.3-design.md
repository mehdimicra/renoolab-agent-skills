# Kiro Power v0.5.3 Dual-Format Compatibility Design

## Decision

Publish RenooLab Agent Skills v0.5.3 as a dual-format Kiro Power. `plugin.json` remains the canonical, current Agent Plugins manifest. A root `POWER.md` and a synchronized `dev.kiro/INSTRUCTIONS.md` are compatibility shims for the Kiro IDE 1.0.288 UI and activation path observed during the live host test.

This is a UX and compatibility improvement, not a repair of an invalid v0.5.2 package. Kiro's current documentation accepts `plugin.json` or the legacy `POWER.md`, and v0.5.2 already satisfies the current Gallery manifest, privacy, support, and licensing requirements.

## Goals

- Preserve the current Agent Plugins package, ten Agent Skills, and remote MCP contract.
- Give Kiro 1.0.288 a populated title, description, author, onboarding context, and reliable Try Power path.
- Keep all activation terms aligned with `plugin.json` so the new surface cannot drift.
- Keep `rechercher_artisans` available for real read-only searches while making both write tools explicit user-confirmation actions.
- Prove the package in a fresh Kiro import before submitting it to the Gallery.

## Non-goals

- No MCP runtime, tool schema, OAuth, OpenAI review, v3, or A2A change.
- No new skill, MCP tool, server, secret, static credential, or pre-approval.
- No claim of Kiro Gallery discovery before Kiro accepts and publishes the submission.
- No replacement of `plugin.json` with the legacy format.

## Package structure

### Canonical manifest

`plugin.json` remains the source of truth for the Power identity, semantic version, description, author, repository, license, and activation keywords. `mcp.json` keeps the single logical server name `renoolab`, transport `streamable-http`, and canonical URL `https://mcp.renoolab.fr/mcp`.

### Legacy UI shim

`POWER.md` is added at the repository root. Its YAML frontmatter mirrors the identity fields from `plugin.json`:

- `name`: `renoolab`
- `displayName`: `RenooLab`
- `description`: exactly the canonical plugin description
- `keywords`: exactly the canonical fifteen-keyword list
- `author`: `RenooLab`
- `repository`: the public Agent Skills repository
- `license`: `Apache-2.0`

The Markdown body contains four compact sections: `Overview`, `Available MCP Servers`, `Tool Usage`, and `Configuration`.

### Kiro 1.0.288 instruction shim

`dev.kiro/INSTRUCTIONS.md` contains exactly the Markdown body of `POWER.md`, without YAML frontmatter. This host-specific shim is kept because the tested Agent Plugins runtime reads that path while the Try Power UI still refers to `POWER.md`. A validator enforces byte-equivalent normalized bodies so this does not become a second source of product logic.

## Steering contract

The shared body states:

- RenooLab supplies ten French workflows for renovation, construction, and finding tradespeople in France.
- The logical MCP server name is `renoolab`; the internal namespaced Kiro identifier is never documented as a public contract.
- For a real local search, call only `rechercher_artisans` and present only profiles and URLs actually returned.
- Never invent a profile, result, availability claim, or URL.
- `contacter_artisan` and `creer_profil_artisan` have external effects and may run only after an explicit user request and explicit confirmation.
- For advice-only requests, load the most relevant skill and do not call the MCP unnecessarily.
- OAuth is handled by the host; no credentials are embedded.
- Privacy is `https://renoolab.fr/privacy/`; support is `contact@renoolab.fr`; license is Apache-2.0.

## Validation and release

The existing Agent Plugins validator is extended test-first. Before either shim exists, the new assertions must fail specifically on the missing root `POWER.md`. After adding the shims, the validator must prove:

- both files exist and are UTF-8 Markdown;
- frontmatter fields match `plugin.json`; unknown or divergent routing metadata fails;
- the four sections and tool-safety rules are present;
- the logical server name is `renoolab` and the Kiro-internal namespaced name is absent;
- privacy, support, and license are present;
- the normalized `POWER.md` body equals `dev.kiro/INSTRUCTIONS.md`;
- exactly ten generated `skills/*/SKILL.md` packages remain available;
- no credential, authorization header, token, or static approval appears.

All release-bearing manifests, lockfiles, validators, README commands, package URLs, and artifact tests move together from 0.5.2 to 0.5.3. The full existing suite, official schema validators, archive determinism checks, audits, and diff checks must pass before publication.

Before tagging, import the candidate from a local folder into a fresh Kiro test state and confirm the card, Try Power, ten-skill activation, OAuth, one explicit search, and one unbranded natural search. Both write tools remain disabled for the smoke and zero write calls are accepted.

After the candidate passes, publish a new immutable v0.5.3 tag and release; never rewrite v0.5.2. Rebuild and publish the versioned first-party archives and indexes, then update pending third-party pins where their review state makes that safe. Submit to the Kiro Gallery only after the public v0.5.3 import repeats the two read-only smokes. Acceptance of Kiro publisher terms remains a human gate.

## Failure handling

If Kiro chooses the legacy parser and loses any Agent Plugins capability when both formats coexist, do not tag v0.5.3. Remove the incompatible shim, preserve v0.5.2, document the host behavior, and open a Kiro issue with the reproduction. If the card is fixed but Try Power remains broken, keep the release blocked until the instruction path is corrected or the limitation is explicitly accepted.

## Sources

- https://kiro.dev/docs/powers/create/
- https://kiro.dev/docs/powers/installation/
- https://kiro.dev/powers/submit/
