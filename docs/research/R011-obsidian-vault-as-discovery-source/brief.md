---
initiative: obsidian-vault-as-discovery-source
prefix: R011
methodology: technical
status: open
created: 2026-06-14
---

# R011: Obsidian Vault as Discovery Source — Plugin Architecture for External Context

## Objective

Design the plugin architecture for Obsidian vault integration as a gwrk extension plugin, including:
1. **Extension plugin type** — the missing `ExtensionManifestSchema`, `ContextProvider` interface, and context injection lifecycle
2. **Plugin registry** — monorepo catalog model (`gforge-esc/gwrk-plugins` provisioned as bare repo [gwrk-plugins](https://github.com/gforge-esc/gwrk-plugins)) with `gwrk plugin install <name>`, `update`, and `search`
3. **001-P10 init extensions** — registry clone during global home provisioning, extension detection during project init

### Evolved Thesis

Obsidian is a **personal thinking surface** (phone, laptop, mobile) where long-form reasoning, concept development, and idea incubation happen. The vault feeds gwrk's Discovery and Definition pillars as **read-only context**, not managed artifacts. The integration is a **plugin** — not core gwrk functionality.

### Foxtrot Charlie Alignment

This serves P1 (Discovery): "Actively extract, synthesize, and validate the truths that determine what must be built and why." Obsidian vaults are truth repositories. The integration point is the Truth→Clarity transition.

## Methodology: technical

### Research Questions

1. **ExtensionManifestSchema**: What fields does it need beyond `PluginBase`? `provides: context` is central. What other extension capabilities might exist? (`provides: metrics`, `provides: search`, `provides: notification`)

2. **ContextProvider interface**: What is the contract? Analogous to `resolveEnforcementSkills()` — need `resolveExtensionContext(projectRoot, workflow, keywords)` that discovers active extensions, checks availability, queries each, merges and truncates results.

3. **Extension lifecycle in agent dispatch**: Where does context injection happen? The enforcement skill precedent injects via `processForAgent()` in `agent.ts`. Extensions should follow the same path.

4. **Per-project extension config**: How does `.gwrkrc.json` map extension settings? e.g., `extensions.obsidian-vault.vault = "EnergyWork"`.

5. **Obsidian adapter surface**: What is the minimal CLI interaction? `search:context query=<text> format=json` + `read path=<file>` covers the core. How to handle availability check, stderr noise, context truncation.

6. **Registry architecture**: What goes in `gforge-esc/gwrk-plugins`? Directory layout, initial contents (language skills, obsidian extension), manifest validation, README.

7. **001-P10 init extensions**: How does registry clone fit into the init wizard flow? Before or after project detection? What if offline?

8. **Feature sequencing**: How do these three features sequence against 001-P10 (init wizard) and 020 (polyglot monorepo)?

### Grounding Sources

**Plugin Architecture (existing)**:
- `src/plugins/manifest.ts` — Plugin type enum includes `extension` (no schema yet)
- `src/plugins/loader.ts` — Resolution: project-local → global → builtins. Already scans `extensions/` dir.
- `src/plugins/skill-runtime.ts:155-216` — `resolveEnforcementSkills()` is the exact precedent: global install, per-project language filtering, silent skip on mismatch
- `src/commands/plugin.ts` — `install <path>`, `remove`, `list`, `disable`, `enable`
- `specs/014-plugin-system/spec.md` — Canonical spec. Layer 3 = "Extension Plugins (Domain Packs, Channel Adapters) — FUTURE"

**Obsidian CLI (v1.12.7)**:
- `search:context query=<text> format=json` — full-text search with line context
- `read path=<file>` — read note contents
- `files format=json` — list vault files
- `tags counts sort=count` — topic discovery
- `vaults verbose` — vault registry
- Constraint: requires Obsidian app running (Electron IPC)

**EnergyWork Vault** (proof of value):
- 6 files of deep domain thinking: Technical Architecture (2000+ lines), Cold Start Runbook (7-phase plan), Founder Memo, Protocol Pack, elevator pitches
- iCloud-synced (phone-accessible)
- Path: `/Users/gonzo/Library/Mobile Documents/iCloud~md~obsidian/Documents/EnergyWork/EnergyWork`

**001-P10 (init wizard)**:
- `src/commands/init.ts` — currently `throw new Error("Not implemented")`
- Plan: interactive profile wizard, workstation provisioning, agent detection, `--non-interactive`
- Tests just generated via `gwrk define tests 001 10`

**Enforcement skill precedent** (the pattern to follow):
- `typescript-standards`: builtin, `language: TypeScript`, auto-filtered by project profile
- `gwrk-conventions`: builtin, no language filter (loads for all projects)
- Pattern: installed global → filtered per-project → disabled via `gwrk plugin disable`

**Distribution decision**: Monorepo registry (oh-my-zsh model). `~/.gwrk/registry/gwrk-plugins/` cloned during `gwrk init`. `gwrk plugin install <name>` copies from registry to `~/.gwrk/plugins/`. Upgrade path to tap model (Homebrew) is additive.

## Discovery
<!-- Key findings and observations -->

## Conclusion
<!-- Recommendations and next steps -->
