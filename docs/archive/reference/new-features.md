# New Features - gwrk

## Obsidian Integration
**Status:** Exploratory — backlog, not spec. Needs architectural validation before commitment.

**Thesis:** gwrk features travel with the repo. GitHub separates wiki and projects from code because on a team, definitional work shouldn't track with the codebase — execution needs to be independent of documentation. But gwrk inverts this: agents execute *from* specs, so definitions are state, not just documentation. The repo IS the source of truth for both code and the work that produces it. Obsidian gives that definitional layer a human-native browsing and visualization surface without extracting it from git.

**Scope:** Definitional artifacts only — `spec.md`, `plan.md`, `build-plan.canvas`. Execution state (`tasks.json`, harvest, gwrk db) stays where it is. Task syncing is explicitly out of scope until we have rock-solid bidirectional reconciliation — `tasks.json` is a necessary artifact but not sufficient for execution, which is why harvest and the execution ledger exist as separate systems.

### 1. Vault Provisioning (`gwrk init` — Obsidian flow)

**Design decision:** Vault creation is a GUI-only operation — the Obsidian CLI can query vaults but cannot create them, and the `obsidian://` URI scheme rejects unregistered paths. This is the same class of problem as Slack: the user must complete a one-time setup step in the external tool, then gwrk detects and configures from there.

**Setup flow** (modeled after `gwrk init` Slack flow):
1. User opens their project folder as a vault in Obsidian ("Open folder as vault" — one-time GUI step).
2. `gwrk init` detects `.obsidian/` at the project root and enters the Obsidian configuration flow.
3. gwrk writes vault config: enables canvas, graph, search, and tag plugins via `core-plugins.json`.
4. gwrk adds `.obsidian/workspace.json`, `.obsidian/workspace`, `.obsidian/appearance.json`, and `.obsidian/plugins/` to `.gwrkignore` (user-local state).
5. gwrk commits shareable vault config (`.obsidian/app.json`, `.obsidian/core-plugins.json`, `.obsidian/community-plugins.json`) so team members get a consistent vault.
6. If `.obsidian/` is not present, gwrk skips the Obsidian flow entirely — no hard dependency.

**Key finding:** `.obsidian/` is **config-only** — it holds vault settings (plugins, themes, workspace layout), NOT content. Specs stay in `specs/` regardless of whether Obsidian is installed. The vault root is the project root, which makes all project Markdown (`docs/`, `specs/`, `README.md`) browsable in Obsidian's graph and search — but nothing moves.

### Reference Project Tree

**Without Obsidian** (current gwrk default):
```
<project-root>/
├── .gwrk/                    # gwrk config
├── specs/                    # feature definitions (source of truth)
│   └── 001-feature/
│       ├── spec.md
│       ├── plan.md
│       ├── tasks.json
│       └── tests/
├── docs/                     # architecture, ADRs, reference
│   └── architecture.md
├── src/                      # source code
└── README.md
```

**With Obsidian** (vault at project root):
```
<project-root>/                # ← this IS the vault root
├── .obsidian/                 # vault config ONLY (not content)
│   ├── app.json               # ✓ commit (shared vault settings)
│   ├── core-plugins.json      # ✓ commit (canvas, graph, search enabled)
│   ├── community-plugins.json # ✓ commit (shared plugin list)
│   ├── appearance.json        # ✗ .gwrkignore (personal preference)
│   ├── workspace.json         # ✗ .gwrkignore (personal layout)
│   └── plugins/               # ✗ .gwrkignore (installed plugin code)
├── .gwrk/                     # gwrk config
├── specs/                     # feature definitions (UNCHANGED location)
│   └── 001-feature/
│       ├── spec.md            # Obsidian-compatible: YAML frontmatter + tags
│       ├── plan.md            # Obsidian-compatible: YAML frontmatter + tags
│       ├── build-plan.canvas  # Obsidian Canvas: visual DAG of phases
│       ├── tasks.json         # execution state (NOT an Obsidian artifact)
│       └── tests/
├── docs/                      # also browsable in Obsidian graph
│   └── architecture.md
├── src/                       # source code (ignored by Obsidian graph)
└── README.md
```

**Critical:** Specs do NOT move into `.obsidian/`. The directory structure is identical with or without Obsidian — the only addition is `.obsidian/` for vault config. Users working in an IDE, terminal, or GitHub see the same `specs/` path either way. No symlinks needed.

### 2. Obsidian CLI as Plugin
gwrk registers `obsidian` as a plugin, exposing vault operations for definitional artifacts:
- **Search definitions**: `obsidian search query="<term>" path="specs/"` — full-text search across feature specs.
- **Read specs**: `obsidian read path="specs/<feature>/spec.md"` — pipe spec content to stdout for agent ingestion.
- **Vault health**: `obsidian vault` — verify vault registration and config.

> The CLI requires the Obsidian desktop app to be running. See [Obsidian CLI docs](https://obsidian.md/cli) for setup and [obsidian --help](obsidian --help) for full command reference.

### 3. Obsidian-Native Definitional Artifacts
All definitional artifacts emitted by `gwrk define` are valid Obsidian Markdown:
- **`spec.md` / `plan.md`**: Standard Markdown with YAML frontmatter. Tags (`#gwrk/spec`, `#gwrk/plan`) enable Obsidian graph filtering and search. Cross-references between related specs use `[[wikilinks]]` where possible.
- **`build-plan.canvas`**: The master build plan emits as an [Obsidian Canvas](https://obsidian.md/canvas) (JSON format). Features render as cards, phase dependencies as directional edges — a visual DAG of the entire pipeline that you can rearrange, annotate, and reason about spatially.

### Open Questions

These need answers before this moves from backlog to spec:

1. **Wikilinks vs standard Markdown**: Obsidian's `[[wikilinks]]` don't render on GitHub. Specs are read on GitHub (PRs, code review). Do we emit standard `[text](path)` links and rely on Obsidian's Markdown-link support? Or do we emit wikilinks and accept that GitHub renders them as plain text? Obsidian supports standard Markdown links natively — could gwrk just use those and get both worlds?

2. **Canvas authoring model**: Canvas is JSON, not Markdown — agents can generate it but can't easily *read* it back. Is the canvas a one-way projection (`plan.md` → `build-plan.canvas`) that regenerates on every `gwrk define plan`? Or do humans edit the canvas and gwrk reads it back as input? One-way is simpler and safer.

3. **`.obsidian/` git split**: Explored an existing vault — the config is: `app.json` (vault settings), `core-plugins.json` (enabled plugins), `community-plugins.json` (plugin list), `appearance.json` (theme), `workspace.json` (window layout), `plugins/` (plugin code). Proposed split: commit `app.json` + `core-plugins.json` + `community-plugins.json` (team consistency), `.gwrkignore` everything else (personal). Is this the right line?

4. **Obsidian Sync overlap**: gwrk is git-native. If a user enables Obsidian Sync on the same vault, content syncs via *two* channels (git + Obsidian Sync) and `.obsidian/` state drifts across machines. Do we detect and warn? Ignore? Is there a blessed pattern for "git owns content, Obsidian Sync owns config"?

5. **Agent consumption model**: Agents read `specs/` as plain files from disk — Obsidian doesn't change that. But if we add Canvas (`.canvas` is JSON), agents need to parse it. Do we provide a gwrk utility that reads Canvas JSON and extracts structured data? Or is Canvas human-only visualization and agents continue to read `plan.md` as the machine-facing source of truth?

6. **CLI requires running app**: The Obsidian CLI requires the Obsidian desktop app to be running — it communicates via IPC. This means CI/CD, headless servers, and SSH sessions can't use the CLI. gwrk must never depend on the CLI for core operations. The CLI integration is a convenience layer for developers with Obsidian running locally.

## Command Options
**Description:** Commands now support an optional `<phase>` argument and `--force` flag.

### `gwrk define tests <feature> [phase] [--force]`
- **`[phase]`**: Optional positional argument for the phase number (e.g., `10`).
- **`--force`**: Overwrite existing files.

**Example:**
```bash
gwrk define tests 001
gwrk define tests 001 10 --force
```

### `gwrk define tasks <feature> [phase] [--reconcile]`
- **`[phase]`**: Optional positional argument for the phase number (e.g., `10`).
- **`--reconcile`**: Reconcile tasks with plan.md (experimental).

**Example:**
```bash
gwrk define tasks 001
gwrk define tasks 001 10 --reconcile
```

## Google Stitch Integration
As a developer I want to be able to define ui and ux artifacts as part of the feature spec and have them persisted as part of the feature spec -- I want to leverage gwrks existing definitional infrastructure and posture to focus on written definitions but be able to work within a visual development environment that doesn't require me to leave my IDE or to move pixels on a screen. 

Google stitch references:

- [Google Stitch](https://stitch.withgoogle.com/)
- [Google Stitch MCP Setup](https://stitch.withgoogle.com/docs/mcp/setup/)
- [Google Stitch SDK Tutorial](https://stitch.withgoogle.com/docs/sdk/tutorial/)

See gwrk define spec and plan for more details and for where visual definitions would improve the spec or plan.




