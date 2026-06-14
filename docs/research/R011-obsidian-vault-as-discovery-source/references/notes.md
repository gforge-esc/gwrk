# Obsidian × gwrk: Discovery Integration Research Notes

## Evolved Thesis

The original audit framing (daily-driver-audit.md §V) assumed Obsidian integration meant "vault = project root, canvas for build-plan, definitional surfaces." **That's wrong.** The real use case is:

> Obsidian is a **personal thinking surface** — phone, laptop, mobile — where long-form reasoning, concept development, and idea incubation happen. These thoughts feed into gwrk's Discovery and Definition pillars as **context**, not as managed artifacts.

### What Obsidian IS for gwrk
- **Input to Discovery**: When `gwrk define research` runs, the agent should be able to query the relevant Obsidian vault for context — searching the founder's thinking, notes, and reasoning
- **Input to ADR writing**: When reasoning about architectural decisions, vault notes contain the "why" that informs the decision
- **Input to spec writing**: When `gwrk define spec` runs, vault notes provide domain knowledge and product thinking
- **A phone-accessible thinking surface**: Ideas captured while walking, reviewing, editing — all synced via iCloud

### What Obsidian is NOT for gwrk
- NOT a replacement for `specs/` (those stay in git)
- NOT a managed document surface (no `gwrk` commands write to the vault)
- NOT a dependency (CLI requires Obsidian app running; gracefully degrades if absent)
- NOT a spec viewer (GitHub/IDE is where specs live)

---

## Foxtrot Charlie Alignment

From [FOXTROT-CHARLIE.md](file:///Users/gonzo/Code/gwrk/docs/product/FOXTROT-CHARLIE.md):

> **Discovery extracts truth.** Actively extract, synthesize, and validate the truths that determine what must be built and why.

Obsidian vaults are truth repositories. They contain:
- Long-form reasoning (the founder's thinking through problems)
- Domain knowledge (technical architecture, protocol specs, economic models)
- Concept development (ideas evolving over time)
- Decision context (why certain approaches were chosen)

The vault is a **Source of Truth** in the Foxtrot Charlie taxonomy — alongside customer interviews, engineering pain points, and telemetry. gwrk's Discovery pillar should be able to query it.

> **Truth → Clarity → Throughput → Value**

The integration point is the Truth→Clarity transition: vault content feeds `define spec`, `define plan`, and `define research` with context that would otherwise require the human to manually copy-paste.

---

## Obsidian CLI Capability Inventory

The `obsidian` CLI (v1.12.7) is remarkably full-featured. Key capabilities for gwrk integration:

### Reading & Search
| Command | Purpose | gwrk Use |
|---|---|---|
| `search:context query=<text> format=json` | Full-text search with line context | **Primary** — agent queries vault for relevant notes |
| `read path=<file>` | Read full note contents | Agent reads specific notes found via search |
| `files format=json` | List all files in vault | Discovery: what exists in the vault |
| `tags counts sort=count` | List all tags with counts | Topic discovery: what the vault is about |
| `recents` | Recently opened files | Recency signal: what's actively being thought about |

### Vault Management
| Command | Purpose | gwrk Use |
|---|---|---|
| `vaults verbose` | List all known vaults with paths | Vault discovery during init |
| `vault info=name\|path\|files` | Get vault metadata | Configuration validation |
| `--vault=<name>` | Target a specific vault | **Required** — gwrk must know which vault maps to which project |

### Advanced
| Command | Purpose | Future Potential |
|---|---|---|
| `property:get`, `property:set` | YAML frontmatter properties | Tag notes as "consumed by gwrk" |
| `backlinks` | Show what links to a note | Concept graph traversal |
| `links` | Show what a note links to | Dependency discovery |
| `graph` | Vault graph data | Concept clustering |
| `base:query` | Query Obsidian Bases (tables) | Structured data extraction |

### Constraints
- CLI requires Obsidian app to be running (Electron IPC)
- `--vault=<name>` flag required for multi-vault
- Output can be noisy (installer warnings on stderr)
- No write-back intent (read-only integration)

---

## EnergyWork Vault Exploration

### Vault Registry
```json
{
  "vaults": {
    "b2bef73548543d00": {"path": "/Users/gonzo/Projects"},
    "4f2b6eabf61fec99": {"path": "iCloud/GFORGE", "open": true},
    "4aeec54f81b65fad": {"path": "iCloud/EnergyWork/EnergyWork", "open": true}
  },
  "cli": true
}
```

Three vaults. EnergyWork is iCloud-synced (phone-accessible). GFORGE is presumably the main work vault.

### EnergyWork Contents (6 files, 1 folder)
| File | Content |
|---|---|
| `What is EnergyWork?.md` | 10s/15s/60s elevator pitches. "Consent-bounded evidence system for what's working to feel good being alive." |
| `EnergyWork Cold Start Runbook.md` | 7-phase cold start plan. Detailed protocol specs, role models, exit gates. |
| `EnergyWork Founder Memo.md` | Strategic memo |
| `EnergyWork Founder Protocol Pack.md` | Protocol definitions |
| `EnergyWork Technical Architecture.md` | Full technical spec (2000+ lines based on search density) |
| `references/bitcoin.pdf` | Reference material |

### Observations
- This vault contains **deep domain thinking** — the kind of context that would massively improve spec/plan quality if agents could access it
- The Cold Start Runbook alone is a structured plan with phases, exit gates, and decision logs — exactly the kind of thing `gwrk define` needs as grounding
- The Technical Architecture is the source of truth for the system design — any spec or ADR about EnergyWork should reference it

---

## Plugin Architecture Audit

### Current Plugin Types
| Type | Schema | Status | Example |
|---|---|---|---|
| `agent` | `AgentManifestSchema` | ✅ Shipped | `gemini`, `claude`, `agy` |
| `skill` | `SkillManifestSchema` (atomic/compound/enforcement) | ✅ Shipped | `narrative`, `gwrk-conventions` |
| `workflow` | `WorkflowManifestSchema` | ✅ Shipped | `gwrk-specify`, `gwrk-plan`, `gwrk-research-technical` |
| `review` | `ReviewManifestSchema` | ✅ Shipped | `gwrk-review-code` |
| `extension` | **Future** — declared in enum but no schema | ❌ Not implemented | — |
| `channel` | **Future** — declared in enum but no schema | ❌ Not implemented | — |

### Plugin Resolution Order
[loader.ts](file:///Users/gonzo/Code/gwrk/src/plugins/loader.ts) resolves in this order:
1. **Project-local**: `.gwrk/plugins/<type>/<name>/manifest.yaml`
2. **User global**: `~/.gwrk/plugins/<type>/<name>/manifest.yaml`
3. **Built-in**: `src/plugins/builtins/<type>/<name>/manifest.yaml`

### Key Insight: `extension` is the right slot

The `extension` type exists in the plugin type enum but has no schema, no loader behavior, and no runtime. This is the **natural home for Obsidian integration** — it's a context provider, not a skill (doesn't reason), not a workflow (doesn't orchestrate), not an agent (doesn't execute). It extends the context available to other plugin types.

### What an Extension Plugin Needs

An extension plugin needs:
1. **`ExtensionManifestSchema`** — new schema in [manifest.ts](file:///Users/gonzo/Code/gwrk/src/plugins/manifest.ts)
2. **A context provider interface** — `provide(query: string): Promise<ContextFragment[]>` 
3. **Registration in the workflow runtime** — extensions inject context before agent dispatch
4. **Config in `.gwrkrc.json`** — per-project extension configuration (vault name, search depth, etc.)

---

## Integration Architecture (Draft — Plugin-Based)

### Plugin Structure

```
~/.gwrk/plugins/extensions/obsidian-vault/
├── manifest.yaml          # ExtensionManifest: type=extension, provides=context
├── adapter.ts             # ObsidianContextProvider implementing ContextProvider
└── README.md
```

### manifest.yaml

```yaml
type: extension
name: obsidian-vault
version: 1.0.0
description: Query Obsidian vaults for project context during define and research
provides: context
command: obsidian
requirements:
  - obsidian-cli  # graceful degradation if absent

config:
  vault:
    type: string
    description: Obsidian vault name to query
  searchDepth:
    type: number
    default: 5
  excludePaths:
    type: array
    default: []
  contextLimit:
    type: number
    default: 8000
```

### Config: Project → Extension

```json
// .gwrkrc.json (per-project)
{
  "extensions": {
    "obsidian-vault": {
      "vault": "EnergyWork",
      "searchDepth": 5,
      "excludePaths": ["references/"],
      "contextLimit": 8000
    }
  }
}
```

### Context Flow

```
gwrk define spec 001 "Cold start protocol"
  │
  ├─ WorkflowRuntime resolves active extensions
  ├─ obsidian-vault extension: provides=context
  │   ├─ obsidian --vault=EnergyWork search:context query="cold start protocol" format=json
  │   ├─ Ranks results, truncates to contextLimit
  │   └─ Returns ContextFragment[]
  │
  ├─ WorkflowRuntime injects fragments into agent prompt as <extension_context>
  │
  └─ Agent writes spec grounded in vault content
```

---

## Plugin Distribution Model

> [!NOTE]
> The canonical source for plugin architecture decisions is [014 spec](file:///Users/gonzo/Code/gwrk/specs/014-plugin-system/spec.md) and [plugin-architecture-plan.md](file:///Users/gonzo/Code/gwrk/docs/archive/reference/plugin-architecture-plan.md) (archived). Key decision: **Model C** — global `~/.gwrk/plugins/` + local `.gwrk/plugins.yaml` override/disable.

### How `gwrk plugin install` Works Today

[plugin.ts](file:///Users/gonzo/Code/gwrk/src/commands/plugin.ts) implements:

```bash
gwrk plugin install <local-path>    # validates manifest.yaml, copies to ~/.gwrk/plugins/<type>s/<name>/
gwrk plugin remove <name>           # deletes from ~/.gwrk/plugins/
gwrk plugin list                    # scans builtins → global → project-local
gwrk plugin disable <name>          # adds to .gwrk/plugins.yaml disable list
gwrk plugin enable <name>           # removes from disable list
```

**Install is local-path only.** No registry, no URL resolution.

### Decision: Monorepo Registry (oh-my-zsh Model)

After evaluating three options (monorepo catalog, Homebrew tap model, hybrid pip model), the decision is **Option A: Monorepo Registry**.

```
~/.gwrk/
├── plugins/              ← installed (active) plugins, copied here on install
│   ├── skills/
│   ├── extensions/
│   └── workflows/
└── registry/             ← cloned gwrk-plugins repo (read-only catalog)
    └── gwrk-plugins/     ← git clone of gforge-esc/gwrk-plugins
        ├── skills/
        │   ├── python-standards/
        │   ├── rust-standards/
        │   └── go-standards/
        ├── extensions/
        │   └── obsidian-vault/
        ├── workflows/
        │   └── gwrk-research-jtbd/
        └── README.md
```

**Commands:**
```bash
gwrk plugin install obsidian-vault          # searches ~/.gwrk/registry/gwrk-plugins/, copies to ~/.gwrk/plugins/
gwrk plugin install ./my-local-plugin       # local path still works (today's behavior, unchanged)
gwrk plugin update                          # git pull on ~/.gwrk/registry/gwrk-plugins/
gwrk plugin search obsidian                 # scans registry manifests for matches
```

**Why this model:**
- Simplest thing that works. One `git pull` updates the entire catalog.
- Plugins are just directories with `manifest.yaml` — no package format, no build step.
- The catalog is small and founder-controlled. "Clones everything" is a non-issue.
- Local path install is unchanged — power users and one-offs work exactly as before.
- **Upgrade path to tap model**: If/when third parties want to publish plugins, add `gwrk plugin tap <repo>` and the registry becomes a list of taps. Additive, not breaking.

**Resolution order update:**
1. Project-local: `.gwrk/plugins/<type>/<name>/`
2. User global: `~/.gwrk/plugins/<type>s/<name>/` (installed)
3. Registry: `~/.gwrk/registry/gwrk-plugins/<type>s/<name>/` (available but not installed — **NEW**)
4. Built-in: `src/plugins/builtins/<type>s/<name>/`

> [!IMPORTANT]
> Registry plugins are NOT automatically active. They must be explicitly installed via `gwrk plugin install <name>`. The registry is a catalog, not a runtime path. This prevents bloat and keeps the user in control.

### What's Missing for Shareable Plugins

| Gap | What Exists | What's Needed |
|---|---|---|
| `extension` schema | Type enum has `"extension"` | `ExtensionManifestSchema` in manifest.ts |
| Extension runtime | Nothing | `ExtensionRuntime` or hook in `WorkflowRuntime` |
| Registry clone | Nothing | `gwrk init` clones `gforge-esc/gwrk-plugins` to `~/.gwrk/registry/` |
| Registry resolution | Loader scans builtins/global/project | Loader needs registry scan step |
| `gwrk plugin update` | Nothing | `git pull` on `~/.gwrk/registry/gwrk-plugins/` |
| `gwrk plugin search` | Nothing | Scan registry manifests for matches |
| Per-project extension config | `.gwrk/plugins.yaml` has disable/override | `.gwrkrc.json` needs `extensions:` config section |

---

## Enforcement Skill Precedent

The enforcement skill pattern ([skill-runtime.ts:155-216](file:///Users/gonzo/Code/gwrk/src/plugins/skill-runtime.ts#L155-L216)) is the **exact architectural precedent** for how extension plugins should work:

### Pattern: Global Install, Per-Project Filtering

```yaml
# ~/.gwrk/plugins/skills/typescript-standards/manifest.yaml
type: skill
name: typescript-standards
version: 1.0.0
tier: enforcement
scope: implementation
language: TypeScript    # ← only loaded for TypeScript projects
```

- **Installed globally** — lives in `~/.gwrk/plugins/skills/`
- **Shipped as builtin** — `src/plugins/builtins/skills/typescript-standards/`
- **Filtered by project profile** — `resolveEnforcementSkills()` checks `manifest.language` against `ProjectProfile.stack.language`
- **Polyglot-aware** — if `profile.stack.languages` has multiple entries, checks against all
- **Project-local always loads** — enforcement skills in `.gwrk/plugins/` skip language filtering (user chose them)
- **Can be disabled** — `gwrk plugin disable typescript-standards`

### How Extensions Follow the Same Pattern

```yaml
# ~/.gwrk/plugins/extensions/obsidian-vault/manifest.yaml  
type: extension
name: obsidian-vault
version: 1.0.0
provides: context
command: obsidian           # ← CLI binary it depends on
```

- **Installed globally** — `~/.gwrk/plugins/extensions/`
- **Available from registry** — `~/.gwrk/registry/gwrk-plugins/extensions/obsidian-vault/`
- **Filtered by availability** — `isAvailable()` checks if `obsidian` CLI exists and responds
- **Per-project config** — `.gwrkrc.json` specifies vault name, search limits
- **Per-project disable** — `gwrk plugin disable obsidian-vault`

### Language Skills as Shareable Plugins

Future language enforcement skills (`python-standards`, `rust-standards`, `go-standards`) live in the `gwrk-plugins` registry repo. Install and auto-filtered:

```bash
gwrk plugin install python-standards
# → copies from ~/.gwrk/registry/gwrk-plugins/skills/python-standards/
# → only loaded when ProjectProfile.stack.language === "Python"
```

---

## gwrk init Changes Required (001-P10 Extension)

> [!IMPORTANT]
> These changes extend [001-P10: Unified Init](file:///Users/gonzo/Code/gwrk/specs/001-cli-core/plan.md#L265-L303), not a separate feature. P10 already covers: interactive profile wizard, workstation provisioning (TCC, SSH, gh), agent detection, Slack channel, `--non-interactive` mode, and `setup.ts` absorption. The registry clone and extension detection are **additions to P10's scope**.

[init.ts](file:///Users/gonzo/Code/gwrk/src/commands/init.ts) is currently a stub (`throw new Error("Not implemented")`). P10 tests were just generated via `gwrk define tests 001 10`.

### P10 Scope (Already Defined)
- Interactive profile wizard (detect project type, confirm with user)
- Workstation provisioning (TCC, SSH, gh) — absorbs `gwrk setup`
- Agent CLI detection and configuration
- Slack channel provisioning
- `--non-interactive` mode with pure auto-detection
- Writes `.gwrkrc.json`

### P10 Extensions (NEW — Registry + Extensions)
These additions fit naturally into the P10 init flow:

**Global home provisioning** (runs on first `gwrk init` before project init):
```bash
gwrk init
# P10 existing: workstation provisioning, agent detection
# NEW: Clone gforge-esc/gwrk-plugins to ~/.gwrk/registry/gwrk-plugins/
# NEW: Create ~/.gwrk/plugins/extensions/ directory
```

**Extension detection** (runs during project init):
```bash
gwrk init  # inside a project dir
# P10 existing: detect project type, scaffold specs/
# NEW: Check installed extensions for auto-config
#   e.g., obsidian-vault installed → detect vault → prompt to configure in .gwrkrc.json
```

**Init idempotency** (P10 already requires this):
- If `~/.gwrk/registry/gwrk-plugins/` exists → `git pull` instead of clone
- If `.gwrkrc.json` exists → merge/update, don't overwrite
- If project already initialized → report status, don't clobber
- If registry clone fails (offline) → continue, registry is optional enrichment

### Updated ~/.gwrk/ Directory Structure

```
~/.gwrk/                          ← Global home (P10 provisions this)
├── config.yaml                   ← User-level config (default agent, etc.)
├── plugins/                      ← Installed (active) plugins
│   ├── skills/
│   ├── workflows/
│   ├── extensions/               ← NEW
│   └── agents/
├── registry/                     ← Plugin catalog (NEW)
│   └── gwrk-plugins/             ← git clone of gforge-esc/gwrk-plugins
└── db/                           ← SQLite databases (runs, plan_features)
```

---

## Implementation Scope (Two Features + P10 Extension)

### Feature 1: Extension Plugin Type (NEW feature — needs spec)
- `ExtensionManifestSchema` in [manifest.ts](file:///Users/gonzo/Code/gwrk/src/plugins/manifest.ts)
- `ContextProvider` interface
- `resolveExtensionContext()` in skill-runtime.ts or new extension-runtime.ts
- Context injection hook in `WorkflowRuntime` or `processForAgent()`
- Obsidian vault adapter as first extension

### Feature 2: Plugin Registry (NEW feature — needs spec)
- `gwrk-plugins` repo (gforge-esc/gwrk-plugins) with initial plugins
- `gwrk plugin install <name>` searches registry
- `gwrk plugin update` — git pull on registry
- `gwrk plugin search <query>` — scan registry manifests
- Resolution order: project-local → global → builtins (registry is catalog, not runtime)

### 001-P10 Extension: Init + Registry
- Add registry clone to global home provisioning step
- Add extension detection to project init step
- These are additions to the existing P10 plan, not a separate phase


---

## Open Questions for Research Phase

> [!IMPORTANT]
> The primary concern is **how to build this as a plugin, not core gwrk functionality.**

1. **Extension plugin schema**: What does `ExtensionManifestSchema` need? `provides: context` is central. What other extension capabilities might exist? (`provides: metrics`, `provides: search`, `provides: notification`)

2. **Context provider interface**: What's the contract? Analogous to `resolveEnforcementSkills()`:
   - `resolveExtensionContext(projectRoot, workflow, keywords)` discovers active extensions, checks availability, queries each, merges and truncates results

3. **Extension lifecycle in WorkflowRuntime**: Where does context injection happen? The enforcement skill precedent injects via `processForAgent()` in [agent.ts](file:///Users/gonzo/Code/gwrk/src/utils/agent.ts). Extensions should follow the same path — not a separate injection point.

4. **Registry architecture**: What goes in `gwrk-plugins` initially? Language enforcement skills (python, rust, go) + obsidian-vault extension + any extracted builtins.

5. **gwrk init sequencing**: Global provisioning must happen before project init. First run: clone registry → provision home → then project init. Subsequent runs: pull registry → project-specific updates.

6. **Degradation**: When Obsidian isn't running, `isAvailable()` returns false, no context injected, no error. Same pattern as language filtering — silent skip, not hard fail.

7. **Privacy**: Vault content may be personal. The extension should log what it injects (for traceability) but the human controls scope via config (`excludePaths`, `contextLimit`).

8. **Init ↔ Registry dependency**: Should `gwrk init` require network access? If registry clone fails (offline, no git), init should still succeed for local-only use. Registry is optional enrichment.

---

## Research Brief (Ready for `gwrk define research`)

**Initiative**: `obsidian-vault-as-discovery-source`  
**Methodology**: `technical`  

**Scope**: This research covers three interconnected features:
1. Extension plugin type (schema, runtime, context provider interface)
2. Plugin registry (gwrk-plugins monorepo, install/update/search)
3. gwrk init changes (global home provisioning, registry clone)

**Questions**:
1. What does `ExtensionManifestSchema` need to support context-providing plugins?
2. How should `WorkflowRuntime` / `processForAgent()` discover and invoke extension plugins?
3. What is the `ContextProvider` interface contract (analogous to `resolveEnforcementSkills`)?
4. How does extension config map per-project in `.gwrkrc.json`?
5. What is the minimal Obsidian adapter surface (CLI calls → ContextFragment)?
6. What is the registry architecture for `gwrk-plugins` (directory layout, initial contents)?
7. What changes does `gwrk init` need for global home provisioning + registry clone?
8. How do these three features sequence against 001-P10 and 020?

**Grounding**:
- Obsidian CLI capabilities (search:context, read, tags, files, vaults — documented above)
- EnergyWork vault contents (6 files of deep domain thinking — explored above)
- Foxtrot Charlie P1 Discovery pillar contract
- gwrk plugin architecture: [manifest.ts](file:///Users/gonzo/Code/gwrk/src/plugins/manifest.ts), [loader.ts](file:///Users/gonzo/Code/gwrk/src/plugins/loader.ts), [workflow-runtime.ts](file:///Users/gonzo/Code/gwrk/src/plugins/workflow-runtime.ts)
- F014 Plugin System spec: [spec.md](file:///Users/gonzo/Code/gwrk/specs/014-plugin-system/spec.md)
- Enforcement skill precedent: [skill-runtime.ts:155-216](file:///Users/gonzo/Code/gwrk/src/plugins/skill-runtime.ts#L155-L216)
- Plugin install mechanism: [plugin.ts](file:///Users/gonzo/Code/gwrk/src/commands/plugin.ts)
- gwrk init stub: [init.ts](file:///Users/gonzo/Code/gwrk/src/commands/init.ts) (currently `throw new Error("Not implemented")`)
- Daily driver audit §V Obsidian, §D init gaps: [daily-driver-audit.md](file:///Users/gonzo/Code/gwrk/docs/daily-driver-audit.md)


