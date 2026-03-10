# macOS Workstation Setup for Autonomous Agents

> **Status:** Reference · **Date:** 2026-03-10
> **Scope:** One-time configuration for `gwrk ship` to run unattended on macOS

---

## Problem

`gwrk ship` dispatches AI agents that run for minutes or hours. macOS blocks autonomous execution in two ways:

1. **TCC dialogs** — macOS prompts when a new app accesses protected filesystem locations
2. **1Password SSH Agent prompts** — 1Password requires per-application/session approval for SSH key use (git push/pull)

Both cause the ship loop to stall silently until a human clicks "Allow."

---

## Fix 1: macOS TCC Permissions (System Settings)

**One-time. Cannot be automated. Must be done manually.**

### Full Disk Access

`System Settings → Privacy & Security → Full Disk Access`

Add every app that spawns agents:
- Antigravity.app (or your terminal: iTerm2, Terminal.app, Warp, etc.)
- Any IDE with integrated terminal (VS Code, Cursor)

### Developer Tools

`System Settings → Privacy & Security → Developer Tools`

Add same apps. This allows attaching to processes, running unsigned binaries, etc.

### Automation

`System Settings → Privacy & Security → Automation`

If prompted, allow your terminal app to control other apps (Finder, System Events). These prompts only appear once per pair.

> **Note:** There is no CLI or programmatic way to grant these. Apple enforces the click-through.

---

## Fix 2: SSH Key Access (1Password)

Your current config routes all SSH through 1Password:
```
# ~/.ssh/config
Host *
  IdentityAgent "/Users/gonzo/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock"
```

### Option A: Relax 1Password settings (partial fix)

`1Password → Settings → Developer → SSH Agent → Advanced`

| Setting | Current | Recommended |
|---|---|---|
| Ask approval for each new | `application and terminal session` | `application` |
| Remember key approval | `until 1Password quits` | `until 1Password quits` (already optimal) |

**Effect:** Changing "Ask approval" to `application` means once you approve Antigravity.app (or Terminal.app) using the key, **all terminal sessions** within that app are approved until 1Password quits. No more per-tab/per-session prompts.

**Limitation:** First use after 1Password starts still requires one Touch ID / click. Not truly unattended across reboots.

### Option B: Dedicated agent SSH key (fully unattended)

Create a passphrase-less key for automated git operations only:

```bash
# Generate dedicated key
ssh-keygen -t ed25519 -f ~/.ssh/gwrk-agent -N "" -C "gwrk-agent@$(hostname)"

# Add to GitHub
gh ssh-key add ~/.ssh/gwrk-agent.pub --title "gwrk-agent-$(hostname)"
```

Add to `~/.ssh/config` **above** the 1Password wildcard:
```
# gwrk agent key — bypasses 1Password for GitHub
Host github.com
  IdentityFile ~/.ssh/gwrk-agent
  IdentityAgent none
```

**Effect:** All `git push/pull` to GitHub uses the dedicated key. No prompts, no 1Password dependency. 1Password still used for all other SSH hosts.

**Security tradeoff:** The key has no passphrase. It lives on disk. Acceptable for a development workstation; mitigated by GitHub's per-key permissions (can scope to specific repos).

---

## Fix 3: GitHub CLI (`gh`) Authentication

Verify `gh` is authenticated and won't prompt:
```bash
gh auth status
# Should show: Logged in to github.com account <user>
```

If not:
```bash
gh auth login --git-protocol ssh
```

---

## Verification

After setup, verify all three pass without prompts:

```bash
# 1. Filesystem access (no dialog)
ls ~/Desktop > /dev/null && echo "TCC: OK"

# 2. SSH key access (no prompt)
ssh -T git@github.com 2>&1 | grep -q "successfully authenticated" && echo "SSH: OK"

# 3. GitHub CLI (no prompt)
gh api user --jq .login && echo "GH: OK"
```

---

## gwrk setup Integration

This configuration should be part of `gwrk init` or a new `gwrk setup` interactive command:

1. **Detect** what's missing (TCC, SSH, gh auth)
2. **Guide** the user through manual steps (open System Settings links, etc.)
3. **Verify** each requirement passes
4. **Record** setup state so `gwrk ship` can pre-flight check before dispatching

Currently the build plan only has setup for Telegram (Phase 3). This workstation setup should be in **Phase 1 (CLI Core)** since `gwrk ship` depends on it.
