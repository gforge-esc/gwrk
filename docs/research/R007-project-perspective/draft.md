# R007 Draft — Project Perspective & Enforcement Skills

> **Status:** Draft — Awaiting Review
> **Initiative:** [R007 brief](brief.md)
> **Consumer:** F014 Plugin System
> **Related:** [R006 draft](../R006-pluginable-research/draft.md) — shared plugin resolution chain

---

## Executive Summary

Project perspective is how gwrk understands "how we build" for any given project. Today this only works for gwrk itself. R007 proposes extending F014's existing enforcement skill infrastructure to support non-gwrk projects.

This draft separates what **already exists** (cited to spec/code) from what **is proposed** (new design requiring spec amendment). The user's direction adds domain ontology as a concern — this is explicitly **new architecture** with no existing spec or code basis.

---

## What Exists Today (Grounded)

### Enforcement Skills — FR-014, US-016 (Implemented)

**Spec**: [F014 spec.md FR-014](../../specs/014-plugin-system/spec.md#L367):

> System MUST ship builtin enforcement skills in `src/plugins/builtins/skills/`. Enforcement skills (`tier: enforcement`) define coding standards, quality constraints, and project conventions that are automatically loaded by write workflows. Enforcement skills follow the same resolution order as workflows: project-local `.gwrk/plugins/skills/` overrides global `~/.gwrk/plugins/skills/` overrides builtins.

**Code**: [skill-runtime.ts L154-199](../../src/plugins/skill-runtime.ts#L154-L199) — `resolveEnforcementSkills(projectRoot, scope)` loads all enforcement skills. Resolution order: project-local → global → builtins. Precedence: project-local overrides builtins of the same name.

**Manifest schema**: [manifest.ts L119](../../src/plugins/manifest.ts#L119) — Enforcement skills have `scope: "implementation" | "review" | "all"`. No `language` or `framework` fields exist.

### Project-Local Override — US-016 AC3 (Spec'd)

**Spec**: [F014 spec.md US-016 AC3](../../specs/014-plugin-system/spec.md#L333-L334):

> Given a project needs custom standards, When a user installs a project-local skill at `.gwrk/plugins/skills/typescript-standards/`, Then the local override takes precedence over the builtin.

**Code**: `PluginLoader` in [loader.ts](../../src/plugins/loader.ts) scans project-local, then global, then builtins. Already works.

### Profile Detection (Implemented, Not Connected)

**Code**: [profile-detector.ts](../../src/engine/profile-detector.ts) — auto-detects `ProjectProfile` with `type`, `stack.language`, `stack.framework`, `stack.buildSystem`, `layout`. Output used by prompt conditioner for `[type:]` guards.

**Gap**: Profile detection and enforcement skill resolution don't talk to each other. `resolveEnforcementSkills()` takes no profile parameter and loads all enforcement skills unconditionally.

### Prompt Conditioner (Implemented, gwrk-Only)

**Code**: [prompt-conditioner.ts](../../src/engine/prompt-conditioner.ts) — resolves `[type: gwrk-native]` / `[type: generic]` guards, injects `<project_profile>` XML. The only custom type is `gwrk-native`. Every other project gets `generic` fallback.

---

## What R007 Proposes (New Design — Requires Spec Amendment)

### Proposal 1: Profile → Enforcement Routing

**Problem**: A Python project currently receives `typescript-standards` because `resolveEnforcementSkills()` doesn't filter by profile. [skill-runtime.ts L159](../../src/plugins/skill-runtime.ts#L159) calls `loader.listPlugins({ tier: "enforcement" })` — no language filter.

**Proposed change**: Add `language`, `framework`, and `toolchain` to the enforcement manifest schema. The `# --- NEW FIELDS ---` are not cosmetic — they encode the complete quality posture of a project.

#### Profile Dimensions

A complete project profile is the intersection of three concerns:

| Dimension | What it governs | Detection signal |
|---|---|---|
| **Language** | Which enforcement skills load | `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `*.swift`, etc. |
| **Toolchain** | Quality posture — formatting, linting, style enforcement | Config files and dependencies (see below) |
| **Test Harness** | Test framework conventions, file patterns | `vitest.config.*`, `pytest.ini`, built-in (`cargo test`, `go test`), etc. |

#### Convergence Insight

The traditional taxonomy of "style guide + formatter + linter" as separate concerns is collapsing. **Convergence tools** unify formatting, linting, and style enforcement into a single tool:

| Tool | Replaces | Language | Detection |
|---|---|---|---|
| **Biome** | Prettier + ESLint + config-airbnb/google | TypeScript/JS | `biome.json` or `@biomejs/biome` in deps |
| **Ruff** | Black + flake8 + isort + pyupgrade + pylint | Python | `ruff.toml` or `pyproject.toml [tool.ruff]` |
| **rustfmt + clippy** | Bundled in toolchain from day one | Rust | `Cargo.toml` (always) |
| **gofmt + go vet** | Bundled in toolchain from day one | Go | `go.mod` (always) |

> Rust and Go solved this at the language level — the toolchain *is* the standard. Biome and Ruff are the JS/Python ecosystems catching up to that model.

This means the manifest should model **toolchain** rather than individual formatter/linter/styleGuide fields. A project using Biome doesn't have a "formatter" and a "linter" — it has one tool that does both.

#### Boundary: Toolchain vs. Infrastructure

Package managers (`pnpm`, `npm`, `uv`, `pip`, `poetry`), runtime version managers (`pyenv`, `nvm`, `fnm`, `mise`), and build tools (`bun`, `cargo`, `go`) are **infrastructure** — they govern how code is installed and run. These belong in `stack.buildSystem`, which [profile-detector.ts](../../src/engine/profile-detector.ts) already detects today.

`toolchain` is strictly about **quality posture** — how code is validated. The question it answers: "what tool gates this code?"

| Axis | Field | Examples | Question |
|---|---|---|---|
| Infrastructure | `stack.buildSystem` | `pnpm`, `uv`, `cargo`, `bun` | "How do I install and run this?" |
| Runtime version | `stack.runtimeManager` (future) | `pyenv`, `nvm`, `mise` | "Which runtime version?" |
| Quality | `toolchain.primary` | `biome`, `ruff`, `eslint`, `clippy` | "What validates this code?" |

> **bun** is an exception worth noting — it converges runtime + package manager + test runner + bundler. But even bun projects still use ESLint or Biome for quality. So bun is `stack.buildSystem: "bun"`, not `toolchain`.

#### Style Guide Landscape by Language

Each language ecosystem has competing standards. The enforcement skill must know which one the project follows — shipping Airbnb rules to a Google-style project creates noise.

##### TypeScript / JavaScript

| Style Guide | Philosophy | Formatter | Linter Config | Detection Signal |
|---|---|---|---|---|
| **Airbnb** | Highly opinionated, comprehensive. De facto community standard. Covers React/JSX. Requires semicolons, trailing commas. | Prettier | `eslint-config-airbnb` | `devDependencies` contains `eslint-config-airbnb` |
| **Google** | Conservative, enterprise-focused. Separate "style" vs "language" rules. Migrating toward TypeScript-first. | Prettier / `clang-format` | `eslint-config-google` | `devDependencies` contains `eslint-config-google` |
| **StandardJS** | Zero-config, no semicolons, no trailing commas. Anti-configuration. | Built-in `standard --fix` | `standard` package | `devDependencies` contains `standard` |
| **Biome** | Rust-powered. All-in-one formatter + linter. Replaces both Prettier and ESLint. | Built-in | Built-in | `biome.json` exists OR `devDependencies` contains `@biomejs/biome` |
| **None (custom)** | Project-specific `.eslintrc` without a known base config. | Varies | Custom | `.eslintrc*` exists but no known config-* dependency |

##### Python

| Style Guide | Philosophy | Formatter | Linter | Detection Signal |
|---|---|---|---|---|
| **PEP 8** | Official Python standard. Flexible — guidelines, not rules. | `autopep8` | `pycodestyle`, `flake8` | `setup.cfg [flake8]` or `.flake8` exists |
| **Google Python** | Stricter than PEP 8. Prescriptive on docstrings (Google-style), type annotations. | `yapf` (Google-maintained) | `pylint` with Google config | `pylintrc` with Google patterns OR `.style.yapf` |
| **Black** | "Uncompromising" auto-formatter. Eliminates all style debates. PEP 8 superset. | `black` (itself) | Paired with `ruff` or `flake8` | `pyproject.toml [tool.black]` OR `devDependencies` |
| **Ruff** | Rust-powered. Replaces flake8 + isort + pyupgrade + black. Fastest linter/formatter. | Built-in `ruff format` | Built-in | `ruff.toml` or `pyproject.toml [tool.ruff]` |

##### Rust

| Style Guide | Philosophy | Formatter | Linter | Detection Signal |
|---|---|---|---|---|
| **Rust Style Guide** | Official, edition-aware. Single standard — no competing guides. | `rustfmt` | `clippy` | `Cargo.toml` exists (always) |
| **Clippy Strictness** | `warn` (default) vs `deny` vs `pedantic` — project chooses severity. | N/A | `clippy` with `-D warnings` | `clippy.toml` or `#![deny(clippy::pedantic)]` in `lib.rs` |

> Rust is unique: one style guide, one formatter, one linter. The only knob is clippy severity level.

##### Go

| Style Guide | Philosophy | Formatter | Linter | Detection Signal |
|---|---|---|---|---|
| **Effective Go** | Foundational idioms document. Not prescriptive on tooling. | `gofmt` / `goimports` | `go vet` | `go.mod` exists (always) |
| **Google Go** | Industry standard for production Go. Extends Effective Go with team conventions. | `gofmt` | `golangci-lint` | `.golangci.yml` exists |

> Go is similar to Rust: `gofmt` is non-negotiable (zero config). The linter meta-tool (`golangci-lint`) aggregates dozens of individual linters.

##### Java

| Style Guide | Philosophy | Formatter | Linter | Detection Signal |
|---|---|---|---|---|
| **Google Java** | Industry standard. Covers formatting, naming, Javadoc. | `google-java-format` | `Checkstyle` with `google_checks.xml` | `checkstyle.xml` contains google ref |
| **Sun/Oracle** | Legacy standard. Still used in older enterprise codebases. | IDE-based | `Checkstyle` with `sun_checks.xml` | `checkstyle.xml` contains sun ref |
| **Spring** | Framework-specific conventions atop Google Java. | `spring-javaformat` | `Checkstyle` + `spring-javaformat` | `spring-javaformat-maven-plugin` in `pom.xml` |

##### Kotlin

| Style Guide | Philosophy | Formatter | Linter | Detection Signal |
|---|---|---|---|---|
| **Kotlin Official** | JetBrains-maintained. IDE-integrated formatting. | IntelliJ / `ktlint` | `ktlint` (formatting) + `detekt` (analysis) | `.editorconfig` with Kotlin sections OR `detekt.yml` |
| **Android Kotlin** | Extends official with Android-specific patterns. | `ktlint` | `detekt` + Android Lint | `build.gradle` contains `detekt` plugin |

##### Swift

| Style Guide | Philosophy | Formatter | Linter | Detection Signal |
|---|---|---|---|---|
| **Google Swift** | Comprehensive, opinionated. Covers API design, naming. | `swift-format` (Google) | SwiftLint | `.swift-format` config exists |
| **Airbnb Swift** | Community standard for iOS teams. | `SwiftFormat` (nicklockwood) | SwiftLint | `.swiftformat` config exists |
| **Apple API Design** | Official naming and API conventions. Less about formatting. | Xcode built-in | N/A | Default when no config files detected |

#### Test Harness Taxonomy

| Language | Default/Canonical | Popular Alternatives | Detection Signal |
|---|---|---|---|
| **TypeScript** | `vitest` (modern), `jest` (established) | `mocha`, `ava`, `node:test` | `vitest.config.*`, `jest.config.*`, `package.json scripts.test` |
| **Python** | `pytest` | `unittest`, `nose2` | `pytest.ini`, `pyproject.toml [tool.pytest]`, `conftest.py` |
| **Rust** | `cargo test` (built-in `#[test]`) | `proptest`, `criterion` (bench) | Always present — built into toolchain |
| **Go** | `go test` (built-in) | `testify`, `gomock` | Always present — built into toolchain |
| **Java** | `JUnit 5` | `TestNG`, `Spock` | `pom.xml` / `build.gradle` dependency |
| **Kotlin** | `JUnit 5` + `kotlin.test` | `Kotest`, `MockK` | `build.gradle` dependency |
| **Swift** | `XCTest` | `Quick`/`Nimble`, `swift-testing` | `.xcodeproj` / `Package.swift` dependency |

#### Proposed Manifest Schema

```yaml
# Example: django-conventions enforcement skill
type: skill
name: django-conventions
tier: enforcement
scope: implementation
# --- Profile-Aware Fields ---
language: Python                  # Filter: only load for Python projects
framework: Django                 # Filter: only load for Django projects (optional)
toolchain:
  primary: ruff                   # Convergence tool — formatting + linting + style
  test: pytest                    # Test framework conventions
```

```yaml
# Example: react-typescript-standards (legacy separate tools)
type: skill
name: react-typescript-standards
tier: enforcement
scope: all
language: TypeScript
framework: React
toolchain:
  primary: eslint                 # Linter (with config-airbnb)
  formatter: prettier             # Separate formatter — not converged
  test: vitest
```

```yaml
# Example: biome-conventions (convergence tool)
type: skill
name: biome-conventions
tier: enforcement
scope: all
language: TypeScript
toolchain:
  primary: biome                  # Single convergence tool — formatter + linter + style
  test: vitest
```

```yaml
# Example: rust-conventions (toolchain-native)
type: skill
name: rust-conventions
tier: enforcement
scope: all
language: Rust
toolchain:
  primary: cargo                  # rustfmt + clippy are cargo subcommands
  test: cargo-test                # Built-in
```

All new fields are **optional**. Existing manifests without them continue to load for all projects (backwards compatible).

The `toolchain.primary` field is the key routing discriminant — it tells gwrk which quality tool the enforcement skill is designed to complement. When a project uses Biome, only skills with `toolchain.primary: biome` (or no toolchain field) load. The optional `toolchain.formatter` field exists only for ecosystems where formatting hasn't converged yet (e.g., Prettier + ESLint).

**Routing algorithm**:

```
1. Load all enforcement skills (existing listPlugins call)
2. If project has local enforcement skills → inject all (user chose these)
3. If falling back to builtins → filter by:
   a. profile.stack.language match (required if skill has language field)
   b. profile.stack.framework match (if skill has framework field)
   c. profile.styleGuide match (if detectable and skill declares one)
4. Skills with no language field → always match (backwards compatible)
```

**Impact**: Requires amending FR-014 and the `EnforcementSkillManifestSchema` in [manifest.ts](../../src/plugins/manifest.ts). Backwards compatible — existing manifests without `language` continue to load for all projects.

#### Enhanced Profile Detection

The current `ProjectProfile` type needs to grow to support routing. Proposed additions to [profile-detector.ts](../../src/engine/profile-detector.ts):

```typescript
export interface ProjectProfile {
  type: string;
  stack?: {
    language?: string;
    framework?: string;
    buildSystem?: string;
  };
  layout?: string;
  _isGwrk?: boolean;
  // --- NEW ---
  toolchain?: {
    primary?: string;      // Convergence tool or primary linter
                           // "biome" | "ruff" | "cargo" | "golangci-lint" | "eslint" | ...
    formatter?: string;    // Only when not converged: "prettier" | "black" | ...
    test?: string;         // "vitest" | "jest" | "pytest" | "cargo-test" | "go-test" | ...
  };
}
```

Detection priority (first match wins):

```
1. Convergence tools: biome.json → primary=biome, ruff.toml → primary=ruff
2. Separate tools: .eslintrc* → primary=eslint, then check for prettier
3. Toolchain-native: Cargo.toml → primary=cargo, go.mod → primary=go
4. Test harness: vitest.config → test=vitest, conftest.py → test=pytest
```

All detection is filesystem-based — config files and `devDependencies` lookups. No network calls, no user prompts.

### Proposal 2: Domain Ontology, Information Hierarchy, and UX Posture

**Status: Implemented.** Decided in [ADR-009](../../docs/decisions/ADR-009-domain-ontology-information-hierarchy-ux.md) and shipped via F014 Phase 13.

- **F014 spec** references it: FR-L25-008, US-019, TC-013, TR-012, SC-016 ([spec.md L251](../../specs/014-plugin-system/spec.md#L251))
- **Code**: [agent.ts](../../src/utils/agent.ts) — `dispatchToAgent()` injects `<domain_ontology>`, `<information_hierarchy>`, `<ux_posture>` from `.gwrk/` if files exist
- **Init**: [init.ts](../../src/commands/init.ts) — `gwrk init` scaffolds `.gwrk/ontology/` and `.gwrk/perspective/`
- **Tests**: [agent.test.ts](../../src/engine/agent.test.ts) — 3 tests: injection, ordering, negative path
- **Hardened**: Per-file try/catch on readFileSync — unreadable file warns, doesn't crash dispatch

Three project knowledge layers, all optional, file-based, injected at dispatch:
- `.gwrk/ontology/domain.md` — what things mean (classes, properties, relations, axioms, glossary)
- `.gwrk/perspective/hierarchy.md` — what matters first (L0 Decision → L4 Recovery)
- `.gwrk/perspective/ux-posture.md` — how actors experience the system (entry → closure)

Grounded in the [Gonzo Feature Research Brief v2](../R006-pluginable-research/references/gonzo-feature-research-brief-v2.md) (Sections 4-5, Pack C) and the [ontology-construction-prompt](references/ontology-construction-prompt.hbs).

---

## Q2: Profile → Enforcement Routing (Detailed)

### Current code

```typescript
// skill-runtime.ts L154-159 — no profile awareness
export async function resolveEnforcementSkills(
  projectRoot: string,
  scope: "implementation" | "review" | "all" = "all",
): Promise<string> {
  const loader = new PluginLoader({ projectDir: projectRoot });
  const allPlugins = await loader.listPlugins({ tier: "enforcement" });
```

### Proposed change

```typescript
// Add profile parameter — optional, backwards compatible
export async function resolveEnforcementSkills(
  projectRoot: string,
  scope: "implementation" | "review" | "all" = "all",
  profile?: ProjectProfile,  // NEW
): Promise<string> {
```

Then in the loop at [L170-196](../../src/plugins/skill-runtime.ts#L170-L196), add filtering:

```typescript
// After loading the manifest:
const manifest = loaded.manifest as EnforcementSkillManifest;

// NEW: Profile-based filtering (only for builtins — project-local always loads)
if (profile && summary.source === "builtin" && manifest.language) {
  if (manifest.language.toLowerCase() !== profile.stack?.language?.toLowerCase()) {
    continue;
  }
}
```

### Builtin split

| Builtin | Current behavior | Proposed |
|---|---|---|
| `gwrk-conventions` | Loads for all projects | Add `language: null` (all projects) — split gwrk-specific rules to `_isGwrk` guard |
| `typescript-standards` | Loads for all projects | Add `language: TypeScript` — only loads for TS projects |
| NEW: `generic-conventions` | N/A | Generic commit format, PR hygiene. `language: null`. |

---

## Q5: Escape from gwrk-Specific Builtins

**Current builtins** (`gwrk-conventions`, `typescript-standards`) are gwrk-specific. For non-gwrk projects this is wrong — Python projects get TypeScript standards.

**Proposed split** (backwards compatible):

1. Extract generic rules from `gwrk-conventions` into `generic-conventions` (commit messages, task management — project-agnostic)
2. Keep `gwrk-conventions` for gwrk-specific rules (flamingo branding, spec conventions). Gate with `_isGwrk` check or `language: gwrk-native`.
3. Add `language: TypeScript` to `typescript-standards` manifest so it only loads for TS projects (requires Proposal 1).

---

## Init Scaffolding

**What exists**: `gwrk init` creates `specs/`, `.gwrk/rules/`, `.gitattributes`. See [init.ts L231-285](../../src/commands/init.ts#L231-L285).

**Proposed addition** (minimal — just directories):

```diff
  const dirs = ["specs", ".gwrk/rules"];
+ // Only if we proceed with ontology/grounding proposals:
+ // ".gwrk/ontology"
+ // ".gwrk/grounding"
```

**Not proposed**: scaffolding enforcement skill templates. Users create those via `gwrk plugin create` (already exists per FR-L1-009) or manually.

---

## Summary: What's Grounded vs. What's New

| Item | Status | Spec/Code basis |
|---|---|---|
| Enforcement skills | **Implemented** | FR-014, US-016, skill-runtime.ts |
| Project-local override | **Implemented** | US-016 AC3, PluginLoader |
| Profile detection (type/language/layout) | **Implemented** | profile-detector.ts — detects TS, Python, Rust, JS, React, Next.js, Express |
| Profile detection (quality posture) | **Proposed** | No code. Extends `ProjectProfile` with `quality.{styleGuide, formatter, linter, testHarness}`. |
| Profile → enforcement routing | **Spec'd, not coded** | F014 spec L284-285 adds `language`/`framework` to manifest schema. manifest.ts has no language field yet. `resolveEnforcementSkills()` has no profile parameter. |
| `toolchain` model | **Researched** | Not in spec, not in code. R007 research material. Convergence insight (Biome, Ruff) documented. |
| Style guide landscape (7 languages) | **Researched** | Proposal 1 tables. Detection signals documented per ecosystem. |
| Domain ontology injection | **Implemented** | ADR-009. agent.ts. F014 P13 shipped. Hardened with per-file try/catch. |
| Init scaffolding (ontology/perspective) | **Implemented** | init.ts — `gwrk init` scaffolds `.gwrk/ontology/` and `.gwrk/perspective/` |
| Architecture grounding | **Proposed** | No spec basis. gwrk uses it informally. |
| Builtin split (generic/gwrk/ts) | **Proposed** | Backwards compatible. No spec change needed. |

---

## Open Items

| Item | Status | Decision needed |
|---|---|---|
| `language`/`framework` manifest fields | Spec'd but not coded | Implement in manifest.ts + skill-runtime.ts. Small change — wires profile to routing. |
| `toolchain` model (convergence, style guides) | Research complete | Ship `language` filter first? Toolchain informational-only? Or defer entirely? |
| Builtin split (generic-conventions) | Proposed | Extract project-agnostic rules from gwrk-conventions. Requires `language` filter. |
| Ontology: enforcement skill vs. just-a-file? | **Resolved** | Just-a-file won. ADR-009 implemented. Zero manifest changes. |
| Profile quality detection: how deep? | Open | Detect style guide from config files (shallow) vs. parse ESLint extends chains (deep)? |
| Architecture grounding: worth the new concept or premature? | Open | May be deferred indefinitely. |
