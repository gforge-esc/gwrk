# Codex Cloud Provisioning Guide

> **Status:** Reference · **Date:** 2026-03-08
> **Sources:** [Codex Cloud](https://developers.openai.com/codex/cloud), [Environments](https://developers.openai.com/codex/cloud/environments), [Internet Access](https://developers.openai.com/codex/cloud/internet-access)

---

## Overview

Codex Cloud runs tasks in isolated containers in OpenAI's infrastructure. Each task:
1. Creates a container and checks out the repo at the selected branch/commit
2. Runs setup script (with internet access)
3. Applies internet access settings (off by default for agent phase)
4. Agent executes in a loop: edit code → run checks → validate
5. Produces a diff and optionally opens a PR

---

## Per-Repo Setup Checklist

### 1. Connect GitHub

- Go to [Codex settings](https://chatgpt.com/codex/settings)
- Connect your GitHub account
- Grant access to target repos

### 2. Configure Environment

Navigate to [environment settings](https://chatgpt.com/codex/settings/environments).

**Package Versions:**
- Select "Set package versions" to pin Node.js, Python, etc.
- Default image: `codex-universal` ([openai/codex-universal](https://github.com/openai/codex-universal))

**Environment Variables:**
- Set for full task duration (setup + agent phases)
- Available to both setup scripts and agent

**Secrets:**
- Additional encryption layer
- Available to setup scripts ONLY (removed before agent phase)
- Use for: API keys, tokens, credentials needed during `npm install` etc.

### 3. Setup Script

For gwrk projects:
```bash
# Install dependencies
pnpm install

# Build the project (if needed for tests)
pnpm build

# Any project-specific setup
```

**Important:** Setup scripts run in a separate Bash session from the agent. `export` does not persist. Use `~/.bashrc` or environment settings for persistent env vars.

### 4. Maintenance Script (Optional)

Runs when a cached container is resumed on a different commit:
```bash
# Update deps for new branch
pnpm install
```

### 5. Configure Internet Access

Default: **OFF** (agent cannot reach the internet).

Options:
- **Off**: Completely blocked (most secure)
- **On with domain allowlist**: Only specified domains accessible
- **On unrestricted**: All domains (least secure)

**Recommended for gwrk**: Use "Common dependencies" preset allowlist, which includes:
- `github.com`, `npmjs.com`, `nodejs.org`, `pypi.org`
- Full list at [common dependencies](https://developers.openai.com/codex/cloud/internet-access#common-dependencies)

Additional HTTP method restrictions available: limit to `GET`, `HEAD`, `OPTIONS` only for extra protection.

### 6. Create `AGENTS.md`

Codex reads `AGENTS.md` for project instructions. For gwrk projects:

```markdown
# gwrk Project Instructions

## Project Structure
- See `docs/architecture.md` for system architecture
- See `.agents/rules/` for governance rules
- See `specs/` for feature specifications

## Commands
- `pnpm test` — Run tests
- `pnpm build` — Build project
- `pnpm lint` — Lint and format

## Conventions
- TypeScript only (no .js in src/)
- Vitest for tests
- Biome for lint/format
- Conventional commits
```

**Tip:** Nest `AGENTS.md` files in subdirectories to reduce context size for focused tasks.

---

## Container Caching

- Cached for up to **12 hours**
- Auto-invalidates on: setup script change, env var change, secret change
- Manual reset: "Reset cache" on environment page
- Business/Enterprise: caches shared across workspace users

---

## Invocation Methods

### From GitHub
```
@codex Fix the failing test in src/server/dispatch.test.ts
```

### From CLI
```bash
codex cloud  # Browse and apply Codex Cloud tasks
```

### From IDE Extension
Kick off cloud tasks from VS Code, monitor progress, apply diffs locally.

---

## Rate Limits

| Plan | Cloud Tasks / 5h | Code Reviews / week |
|---|---|---|
| Plus | ~10–60 | ~20–50 |
| Pro | ~50–400 | ~200–500 |
| Business/Enterprise | Credit-based (no fixed limits) | Credit-based |

Cloud tasks share the 5h rolling window with local CLI messages.

---

## Security Considerations

- Secrets removed before agent phase (prevents exfiltration)
- Internet access off by default (prevents prompt injection from web content)
- Domain allowlist recommended over unrestricted access
- Review agent output and work log before merging
- `AGENTS.md` nesting reduces context exposure
