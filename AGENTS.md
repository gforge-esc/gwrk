# AGENTS Project Context

# Antigravity (Gemini IDE Extension) Rules
- **Git Commit Identity Leakage**: When executing `git commit` via terminal commands in the background, the IDE extension aggressively injects `GIT_AUTHOR_NAME="Gemini CLI"` and `GIT_AUTHOR_EMAIL="gemini@google.com"`. This breaks cryptographic signature verification on GitHub. 
- **Remediation**: NEVER run blind `git commit` from my terminal environment. ALWAYS explicitly assign the author variables or use `git commit --author="$(git config user.name) <$(git config user.email)>"` to prevent the AI identity from breaking the commit chain and stripping the "Verified" badge.
- **Pre-Commit Enforcement** (`.git/hooks/pre-commit`): Mechanically enforced, not trust-based.
  - **Feature branches**: `pnpm build` (~3s). Catches type errors without blocking velocity.
  - **develop / main**: `pnpm build` + `pnpm test` (~25s). Full gate. No broken code on protected branches.
  - **Lint**: Advisory until the 82 pre-existing errors are cleaned up. Then promoted to develop/main tier.
  - Escape hatch: `git commit --no-verify` (human-only, never used by agents).
- **`gwrk ship` is HUMAN-ONLY**: NEVER run `gwrk ship` from an agent session. It dispatches sub-agents that burn API tokens uncontrollably. The agent's role is to prepare code, fix issues, commit, and push — then tell the human to run `gwrk ship`. The ONLY exception is test scenarios where ship behavior is being validated. To confirm setup without running the loop, use `gwrk ship <feature> --dry-run`; it reports the backend it would build with and touches neither git nor the agent.

## Config layering

Three layers, merged project → local → global:
- `.gwrkrc.json` (tracked): project identity only. No agents, no secrets.
- `.gwrkrc.local.json` (gitignored): personal agent choice and registry. Agents never commit it.
- `~/.gwrk/config.json` (global): machine-wide secrets.

`.gwrkrc.local.json.example` is the tracked template. Copy it and drop the trailing `.example`: `cp .gwrkrc.local.json.example .gwrkrc.local.json`.

`gwrk init` is the setup and repair path, safe to re-run. It preserves project identity, migrates a legacy tracked `agents` block into the local layer, and writes the `~/.gwrk/setup.json` that `gwrk ship`'s pre-flight requires.

## 7. Writing standard

All prose in this repo — docs, memos, ADRs, PR descriptions, replies — follows these rules. The reader is your peer or you. Trust them.

**Say it once**

- One idea, one place. Never in a heading and its body, a comment and its field, a sentence and its neighbor.
- Bare headings ("Synopsis", "Why", "Quality gate"). No em-dash glosses restating the heading.
- Never set up a point and then restate it after the evidence. Pick the statement or the demonstration, not both.
- Don't tell the reader what a diagram, table, or code block they just read shows.

**Voice**

- Active voice. Passive only where conversation would use it.
- Strip adjectives and intensifiers unless they carry a fact ("immutable" stays; "genuinely", "deliberately", "exactly", "literally", "honestly", "strongest possible" go).
- No dramatic pre-frames: "worth noting", "to be honest", "the real question", "critically", "importantly".
- No over-explaining. State the thing; don't explain that you're about to state it, or why it matters, when the thing itself shows why.

**LLM tells (delete on sight)**

- Em-dashes as connective tissue. The loudest tell of all. Prefer a period, colon, comma, or parentheses; a clause that leans on an em-dash usually wants to be two sentences. (An em-dash inside a verbatim quote or reproduced file stays.)
- Setup-then-restate: "X is Y. That means X is Y."
- "That is what X means operationally —" constructions.
- Triple glosses: "stands alone (readable, verdict-safe)".
- Recapping what the reader just read.
- Bold used as emphasis seasoning. Bold marks the one load-bearing term per section, if that.

**Test**

Remove a word; if the point survives, the word was wrong. Per sentence, then per sentence again.

<!-- gwrk:begin -->
# GWRK Project Context

This project is managed by gwrk.

<!-- gwrk:end -->