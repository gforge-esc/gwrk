# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in gwrk, please report it responsibly.

**Do NOT open a public issue.**

Instead, email **gonzodbg@gmail.com** with:

- A description of the vulnerability
- Steps to reproduce
- Potential impact assessment
- Any suggested fix (if you have one)

### Response Timeline

| Action | Timeline |
|--------|----------|
| Acknowledgment | Within 48 hours |
| Initial assessment | Within 1 week |
| Fix or mitigation | Best effort, depends on severity |

### What Counts as a Security Issue

- Credential leakage (API keys, tokens in logs or output)
- Command injection via untrusted input
- Path traversal in file operations
- Agent dispatch to unintended targets
- SQLite injection in the execution ledger

### What Does NOT Count

- Theoretical attacks requiring local machine access (gwrk runs locally)
- Issues in upstream dependencies (report to the upstream project)
- Feature requests disguised as security issues

## Security Model

gwrk is a **local CLI tool** that orchestrates AI agent CLIs on your machine. It:

- Runs with your user permissions
- Stores data in `~/.gwrk/` and `.gwrk/` (project-local)
- Dispatches to agent CLIs (`claude`, `gemini`, `codex`, `agy`) already installed on your system
- Uses SQLite for the execution ledger (local, no network)
- Optionally integrates with Slack and GitHub via configured tokens

Secrets (Slack tokens, webhook URLs) should be stored in `~/.gwrk/config.json` (machine-wide, never in any repository).
