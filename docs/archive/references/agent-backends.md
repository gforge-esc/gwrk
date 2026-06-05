# Agent Backend Constraints Reference

> **Status:** Living document · **Date:** 2026-03-08
> **Purpose:** Authoritative reference for gwrk agent registry configuration. All values sourced from CLI help, live `/status` output, and official docs.

---

## Codex — Local CLI (`codex`)

| Constraint | Value | Source |
|---|---|---|
| **Invocation** | `codex exec --full-auto` (non-interactive) or `codex` (interactive) | `codex --help` |
| **Version** | v0.111.0 (as of 2026-03-08) | `codex /status` |
| **Models** | `gpt-5.3-codex` (default), `gpt-5.4`, `gpt-5.2-codex`, `gpt-5.1-codex-max`, `gpt-5.2`, `gpt-5.1-codex-mini`. Legacy models via `codex -m <name>`. | `codex /models` (live) |
| **Reasoning levels** | `low` (fast), `medium` (default), `high` (complex), `extra high` (maximum depth). Per-model configurable. | `codex /models` (live) |
| **Context window** | GPT-5.3-Codex: **1,000,000 tokens**; GPT-5.1-Codex-Mini: ~400K tokens | Model docs |
| **Rate limit (Plus)** | ~30–150 local messages / 5h rolling window; weekly limit also applies. `/status` shows `5h limit: [████] N% left (resets HH:MM)` and `Weekly limit` | Codex pricing FAQ + `/status` |
| **Rate limit (Pro)** | ~300–1,500 local messages / 5h rolling window; weekly cap applies | Codex pricing FAQ |
| **Local resource cost** | Full CPU/RAM consumption. Subject to macOS sleep/resource limits. | Direct observation |
| **Sandbox modes** | `read-only`, `workspace-write`, `danger-full-access` | `codex --help` |
| **Auth** | Shared 5h window with cloud tasks and web usage. Limit resets at absolute clock time. | Codex pricing FAQ + `/status` |
| **Efficiency tip** | Switch to `gpt-5.1-codex-mini` for routine tasks (~4× limit extension) | Codex pricing FAQ |
| **API key mode** | Pay-per-token at standard API rates. No cloud features. Delayed model access. | Codex pricing page |

### Codex CLI Key Subcommands

```
codex exec       # Run non-interactively (aliases: e)
codex review     # Code review non-interactively
codex cloud      # Browse/apply Codex Cloud tasks
codex apply      # Apply latest diff as git apply
codex resume     # Resume previous session
codex sandbox    # Run commands in sandbox
```

---

## Codex — Cloud (`@codex` on GitHub)

| Constraint | Value | Source |
|---|---|---|
| **Invocation** | Tag `@codex` on GitHub issues/PRs | [Codex Cloud docs](https://developers.openai.com/codex/cloud) |
| **Provisioning** | Per-repo: connect GitHub → configure environment → set internet access policy | [environments](https://developers.openai.com/codex/cloud/environments) |
| **Rate limit (Plus)** | ~10–60 cloud tasks / 5h (shared window with local) | Codex pricing FAQ |
| **Rate limit (Pro)** | ~50–400 cloud tasks / 5h (shared window with local) | Codex pricing FAQ |
| **Code reviews** | Separate weekly limit (Plus: ~20–50/week, Pro: ~200–500/week) | Codex pricing FAQ |
| **Container image** | `codex-universal`; auto-installs npm/yarn/pnpm/pip/poetry. Custom setup scripts supported. | [environments](https://developers.openai.com/codex/cloud/environments) |
| **Container cache** | Up to 12h. Auto-invalidates on setup script/env var changes. | Codex Cloud docs |
| **Internet access** | Off by default. Configurable per-environment: domain allowlist + HTTP method restrictions. | [internet-access](https://developers.openai.com/codex/cloud/internet-access) |
| **Project context** | Reads `AGENTS.md` for project instructions. Nested `AGENTS.md` reduces context size. | Codex docs |
| **Credits** | Business/Enterprise: no fixed limits, scales with purchased credits. | Codex pricing page |

### Codex Cloud Setup Requirements (per-repo)

1. Connect GitHub account at [codex settings](https://chatgpt.com/codex/settings)
2. Configure environment: setup script, env vars, secrets
3. Configure internet access: off (default), domain allowlist, or unrestricted
4. Create `AGENTS.md` with project-specific instructions
5. Secrets available to setup scripts only (removed before agent phase)

See [codex-cloud-provisioning.md](./codex-cloud-provisioning.md) for detailed setup guide.

---

## Gemini — Local CLI (`gemini`)

| Constraint | Value | Source |
|---|---|---|
| **Invocation** | `gemini -p --output-format json` (headless) or `gemini` (interactive) | `gemini --help` |
| **Model modes** | **Auto (Gemini 3)**: CLI picks `gemini-3.1-pro-preview`, `gemini-3-flash-preview`. **Auto (Gemini 2.5)**: picks `gemini-2.5-pro`, `gemini-2.5-flash`. **Manual**: `-m <model>`. | `gemini /model` (live) |
| **Available models** | `gemini-3.1-pro-preview`, `gemini-3-flash-preview`, `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite` | `gemini /stats` (live) |
| **Context window** | **1,000,000 tokens** (Pro variants) | Google model docs |
| **Output limit** | 65,536 tokens (default 8,192; configurable) | Google model docs |
| **User's tier** | Gemini Code Assist in **Google One AI Ultra** | `gemini /stats` (live) |
| **Rate limit (free/personal)** | 60 RPM, 1,000 RPD | Google rate limit docs |
| **Rate limit (free/API key)** | 10 RPM, 250 RPD (Flash only) | geminicli.com |
| **Rate limit (Code Assist Standard)** | 120 RPM, 1,500 RPD per user | Google rate limit docs |
| **Rate limit (Code Assist Enterprise)** | 120 RPM, 2,000 RPD per user | Google rate limit docs |
| **Usage reporting** | `/stats` shows per-model `Usage remaining` with percentage and reset timer | `gemini /stats` (live) |
| **Approval modes** | `default`, `auto_edit`, `yolo`, `plan` | `gemini --help` |
| **Limits scope** | Per Google Cloud project, not per API key | Google rate limit docs |

---

## Claude — Local CLI (`claude`)

| Constraint | Value | Source |
|---|---|---|
| **Invocation** | `claude -p --output-format json` (headless) or `claude` (interactive) | `claude --help` |
| **Version** | v2.1.71 (as of 2026-03-08) | `claude --version` (live) |
| **Models** | Claude Sonnet 4.6 (default), Claude Opus 4.6, Claude Haiku 4.5; via `--model` or aliases (`sonnet`, `opus`) | `claude --help` + `/model` (live) |
| **Context window** | Opus 4.6: **200K tokens** (1M beta at API Tier 4); Sonnet 4.6: **200K** (1M at Tier 4) | Anthropic docs |
| **Budget control** | `--max-budget-usd <amount>` (print mode only) | `claude --help` |
| **Rate limit (Pro)** | ~44,000 tokens / 5h rolling window (~10–40 prompts) | Pricing research |
| **Rate limit (Max5)** | ~88,000 tokens / 5h | Pricing research |
| **Rate limit (Max20)** | ~220,000 tokens / 5h | Pricing research |
| **Weekly cap** | ~40–80h Code usage/week (Pro); Max: 140–280h Sonnet, 15–35h Opus | Anthropic docs |
| **API Tier 4** | 4,000 RPM, 2M ITPM (Sonnet), 400K OTPM. $400 cumulative deposit. | Anthropic docs |
| **200K token trap** | Exceeding 200K input tokens → premium long-context pricing (~2× cost) | Anthropic docs |
| **Shared pool** | CLI and web share the same 5h usage pool | Anthropic docs |
| **Effort** | `--effort low\|medium\|high` controls depth/token usage | `claude --help` |
| **Fallback** | `--fallback-model` auto-switches when primary overloaded (print mode) | `claude --help` |
| **Worktree** | `--worktree` creates git worktree per session (useful for parallel dispatch) | `claude --help` |

---

## Default Agent Registry Config

```json
{
  "agents": {
    "registry": {
      "codex-local": {
        "command": "codex exec --full-auto",
        "models": ["gpt-5.3-codex", "gpt-5.4", "gpt-5.1-codex-mini"],
        "reasoning": "high",
        "contextWindow": 1000000,
        "maxConcurrent": 1,
        "rateLimit": { "messagesPerWindow": 150, "windowMinutes": 300 }
      },
      "codex-cloud": {
        "command": "@codex",
        "models": ["gpt-5.3-codex"],
        "contextWindow": 1000000,
        "maxConcurrent": 3,
        "rateLimit": { "messagesPerWindow": 60, "windowMinutes": 300 }
      },
      "gemini": {
        "command": "gemini -p --output-format json",
        "models": ["gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-2.5-pro"],
        "contextWindow": 1000000,
        "maxConcurrent": 2,
        "rateLimit": { "requestsPerMin": 60, "requestsPerDay": 1000 }
      },
      "claude": {
        "command": "claude -p --output-format json --effort high",
        "models": ["claude-sonnet-4.6", "claude-opus-4.6"],
        "contextWindow": 200000,
        "maxConcurrent": 2,
        "rateLimit": { "tokensPerWindow": 44000, "windowMinutes": 300 }
      }
    },
    "fallbackOrder": ["codex-cloud", "gemini", "claude", "codex-local"]
  }
}
```

---

## External References

| Doc | URL |
|---|---|
| Codex Cloud | https://developers.openai.com/codex/cloud |
| Codex Environments | https://developers.openai.com/codex/cloud/environments |
| Codex Internet Access | https://developers.openai.com/codex/cloud/internet-access |
| Codex Pricing | https://developers.openai.com/codex/pricing |
| Codex Auth | https://developers.openai.com/codex/auth |
| Google Gemini Rate Limits | https://ai.google.dev/gemini-api/docs/rate-limits |
| Anthropic Rate Limits | https://docs.anthropic.com/en/api/rate-limits |
| Anthropic Pricing | https://www.anthropic.com/pricing |
