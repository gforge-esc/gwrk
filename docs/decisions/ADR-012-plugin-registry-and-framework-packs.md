# ADR-012: Plugin Registry and Framework Packs

> **Status:** Decided
> **Date:** 2026-11-02
> **Decision:** `gwrk` core ships only foundational agent adapters and language baselines, while external CLI backends and framework enforcement skills live in `gforge-esc/gwrk-plugins`.
> **Constraint:** External agent backends MUST implement `AgentPort` via `adapter.js` and `manifest.yaml`, and framework enforcement skills MUST declare both `language` and `framework` in `manifest.yaml`.
> **Depends on:** ADR-006 (Plugin Agent Backends), ADR-007 (Single Dispatch Path), ADR-010 (Decision Records), ADR-011 (Hexagonal Layering)
> **Author:** David Gonzalez · **Decision Scope:** gwrk plugin registry and polyglot framework packs

---

## 1. Context

`ADR-006` defined `AgentBackend` for built-in CLIs and deferred external CLI adapters and framework packs. Meanwhile `src/engine/registry.ts` referenced `gwrk-org/gwrk-plugins.git` instead of `gforge-esc/gwrk-plugins.git`. In addition `src/plugins/skill-runtime.ts` skipped language and framework filtering for skills installed in `~/.gwrk/plugins/skills/`.

## 2. Decision

### 2.1 Core Builtins vs Registry Catalog

`gwrk` splits plugins between built-in defaults in `src/plugins/builtins/` and the installable registry in `gforge-esc/gwrk-plugins`:

| Plugin Layer | Core Builtins | Registry Catalog |
|---|---|---|
| Agent Backends (`type: agent`) | `agy`, `claude`, `codex` | `gemini`, `aider`, `cursor-agent`, `opencode`, `goose` |
| Language Skills (`tier: enforcement`) | `typescript-standards`, `python-standards`, `go-standards`, `rust-standards`, `gwrk-conventions` | Extended language and domain packs |
| Framework Skills (`tier: enforcement`) | None | `nextjs-standards`, `react-standards`, `fastify-standards`, `express-standards`, `fastapi-standards`, `django-standards`, `gin-standards`, `chi-standards`, `axum-standards`, `clap-standards` |
| Review Strategies (`type: review`) | `review-cli`, `review-webapp` | `review-api`, `review-library` |

### 2.2 External Agent Backend Contract

Every external agent plugin in `gwrk-plugins/agents/<name>/` provides two files:

1. `manifest.yaml` with `type: agent` and `adapter: ./adapter.js`.
2. `adapter.js` exporting an `AgentPort` class that delivers context via `stdin` pipe and normalizes exit codes to `0 | 1 | 2 | 127`.

### 2.3 Profile-Driven Framework Routing

1. `detectProfile` inspects project manifests to populate `profile.stack.language` and `profile.stack.framework`.
2. `resolveEnforcementSkills` filters built-in and global enforcement skills by `manifest.language` and `manifest.framework`. Project-local skills in `<projectRoot>/.gwrk/plugins/skills/` load unconditionally.

## 3. Consequences

| Area | Consequence |
|---|---|
| Extensibility | Adding a new CLI agent or framework pack requires zero changes to `gwrk` core. |
| Prompt Budget | Global installation of framework packs adds zero token overhead to unrelated projects. |
| Registry Sync | `syncRegistry` clones `gforge-esc/gwrk-plugins.git` and repairs legacy `gwrk-org/gwrk-plugins` remotes. |

## Amendments
