# AGENTS Project Context

# Antigravity (Gemini IDE Extension) Rules
- **Git Commit Identity Leakage**: When executing `git commit` via terminal commands in the background, the IDE extension aggressively injects `GIT_AUTHOR_NAME="Gemini CLI"` and `GIT_AUTHOR_EMAIL="gemini@google.com"`. This breaks cryptographic signature verification on GitHub. 
- **Remediation**: NEVER run blind `git commit` from my terminal environment. ALWAYS explicitly assign the author variables or use `git commit --author="$(git config user.name) <$(git config user.email)>"` to prevent the AI identity from breaking the commit chain and stripping the "Verified" badge.
- **Pre-Commit Enforcement** (`.git/hooks/pre-commit`): Mechanically enforced, not trust-based.
  - **Feature branches**: `pnpm build` (~3s). Catches type errors without blocking velocity.
  - **develop / main**: `pnpm build` + `pnpm test` (~25s). Full gate. No broken code on protected branches.
  - **Lint**: Advisory until the 82 pre-existing errors are cleaned up. Then promoted to develop/main tier.
  - Escape hatch: `git commit --no-verify` (human-only, never used by agents).
- **`gwrk ship` is HUMAN-ONLY**: NEVER run `gwrk ship` from an agent session. It dispatches sub-agents that burn API tokens uncontrollably. The agent's role is to prepare code, fix issues, commit, and push — then tell the human to run `gwrk ship`. The ONLY exception is test scenarios where ship behavior is being validated.

<!-- gwrk:begin -->
# GWRK Project Context

This project is managed by gwrk.
Rules: .gwrk/rules/
Workflows: ~/.gwrk/plugins/workflows/
Skills: ~/.gwrk/plugins/skills/

<!-- gwrk:end -->