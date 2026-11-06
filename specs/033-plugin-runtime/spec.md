# 033 — Usable Layer 1, Layer 2, and Layer 3 Plugin Runtime

> **Status:** Defined · **Anchored to:** ADR-006, ADR-011

## 1. Problem
`gwrk plugin seed` generates manifests missing `preferredModel`, `SkillRuntime` ignores `SKILL.md` for atomic and compound skills, `AgentBackendRegistry` has empty `if` blocks for dynamic agent plugins, `PluginRegistry` clones a nonexistent repo and strips `.git`, and Slack/Telegram channels bypass the plugin boundary.

## 2. Functional Requirements
- **FR-001:** `SkillRuntimeSchema` MUST default `preferredModel` to `"default"` when omitted, and `seed.ts` MUST emit valid manifests.
- **FR-002:** `SkillRuntime.assemblePrompt` MUST load `SKILL.md` when present for atomic and compound skills.
- **FR-003:** `AgentBackendRegistry` MUST dynamically import user-installed agent adapters from `~/.gwrk/plugins/agents/`.
- **FR-004:** `PluginRegistry.installPlugin` MUST accept direct Git URLs and local directory paths, copy recursively, and write `.gwrk-source.json` for `updatePlugin`.
- **FR-005:** `src/ports/notification-port.ts` MUST abstract Slack and Telegram notifications behind `NotificationPort`.
