# R011 → Implementation: Command Sequence

> **Status**: Phase 1 (014 extension core) shipping. Phase 2 (001-P10 init) defined. Phase 3 blocked on P10.

## Dependency Chain

```
014 ship (in progress) → 001-P10 ship (init wizard + --agent) → gwrk-plugins bootstrap → obsidian-vault plugin
```

## Phase 1: Extension Core (014-plugin-system) — IN PROGRESS

014 spec updated with Layer 3 Extension Plugin support. Currently shipping.

```bash
# ✅ DONE: spec, plan, tasks, tests defined
gwrk define spec 014-plugin-system "..." --refs docs/research/R011-obsidian-vault-as-discovery-source/draft.md
gwrk define plan 014
gwrk define tasks 014
gwrk define tests 014

# 🔄 IN PROGRESS
gwrk ship 014
```

**Delivers**: `ExtensionManifestSchema`, `ContextProvider` interface, `extension-runtime.ts`, agent dispatch context injection, `.gwrkrc.json` extensions block.

---

## Phase 2: Init Wizard + Registry (001-cli-core P10) — DEFINED

001-P10 spec updated with `--agent` mode (FR-046), registry clone, extension detection.

```bash
# ✅ DONE: spec, plan, tasks, tests defined (including --agent mode)
gwrk define spec 001 "..." --refs docs/research/R011-obsidian-vault-as-discovery-source/draft.md
gwrk define plan 001 10
gwrk define tasks 001 10
gwrk define tests 001 10

# ⏳ BLOCKED on 014 ship completing
gwrk ship 001 10
```

**Delivers**: `gwrk init` interactive wizard, `--non-interactive` (CI), `--agent` (agent bootstrapping), registry clone to `~/.gwrk/registry/`, extension CLI detection, workstation provisioning.

---

## Phase 3: Obsidian Adapter (gwrk-plugins repo) — BLOCKED ON P10

The obsidian-vault extension lives in `gforge-esc/gwrk-plugins`, not in gwrk core. Requires `gwrk init --agent` to bootstrap gwrk in the registry repo.

```bash
# Step 1: Bootstrap gwrk in gwrk-plugins (requires P10 --agent mode)
cd ~/Code/gwrk-plugins
gwrk init --agent

# Step 2: Create the obsidian-vault extension spec
gwrk define spec obsidian-vault "Obsidian vault context provider extension. Queries Obsidian vaults via obsidian-cli search:context for relevant notes, injects results as <extension_context> into agent prompts during define/research workflows. Read-only, graceful degradation when Obsidian not running." --refs ../gwrk/docs/research/R011-obsidian-vault-as-discovery-source/draft.md

# Step 3: Define → Ship
gwrk define plan obsidian-vault
gwrk define tasks obsidian-vault
gwrk define tests obsidian-vault
gwrk ship obsidian-vault

# Step 4: Test install from gwrk
cd ~/Code/gwrk
gwrk plugin install obsidian-vault
```

**Delivers**: `extensions/obsidian-vault/manifest.yaml`, adapter script, README. First consumer of the Phase 1 extension architecture.

---

## Quick Reference: What Changes Where

### gwrk core (014-plugin-system — Phase 1)
- `[NEW] src/plugins/extension-manifest.ts` — ExtensionManifestSchema
- `[MODIFY] src/plugins/manifest.ts` — Add extension to AnyManifestSchema union
- `[NEW] src/plugins/extension-runtime.ts` — resolveExtensionContext()
- `[MODIFY] src/utils/agent.ts` — Inject extension context in dispatchToAgent()
- `[MODIFY] src/utils/config.ts` — Add extensions to GwrkConfigSchema

### gwrk core (001-cli-core P10 — Phase 2)
- `[MODIFY] src/commands/init.ts` — Interactive wizard, --non-interactive, --agent, registry clone, extension detection
- `[DELETE] src/commands/setup.ts` — Absorbed into init
- `[MODIFY] src/commands/plugin.ts` — Registry-aware install, update, search
- `[MODIFY] src/plugins/loader.ts` — Registry path in resolution chain
- `[NEW] src/engine/extension-detector.ts` — Detect installed CLIs (obsidian-cli etc.)

### gforge-esc/gwrk-plugins repo (Phase 3)
- `[NEW] extensions/obsidian-vault/manifest.yaml` — Extension manifest
- `[NEW] extensions/obsidian-vault/adapter.sh` (or .ts) — obsidian-cli wrapper
- `[NEW] README.md` — Registry catalog docs
- `[NEW] skills/` — Future: shared enforcement skills (python-standards, etc.)
