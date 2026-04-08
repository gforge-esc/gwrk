# AGENTS Project Context

# Antigravity (Gemini IDE Extension) Rules
- **Git Commit Identity Leakage**: When executing `git commit` via terminal commands in the background, the IDE extension aggressively injects `GIT_AUTHOR_NAME="Gemini CLI"` and `GIT_AUTHOR_EMAIL="gemini@google.com"`. This breaks cryptographic signature verification on GitHub. 
- **Remediation**: NEVER run blind `git commit` from my terminal environment. ALWAYS explicitly assign the author variables or use `git commit --author="$(git config user.name) <$(git config user.email)>"` to prevent the AI identity from breaking the commit chain and stripping the "Verified" badge.

<!-- gwrk:begin -->
# GWRK Project Context

This project is managed by gwrk.
Rules: .agents/rules/
Workflows: ~/.gwrk/plugins/workflows/
Skills: ~/.gwrk/plugins/skills/

<!-- gwrk:end -->