---
type: contract
feature: 008-agent-router
last_modified: "2026-03-10T22:30:00Z"
---

# Contract: Quota Prober

**Feature**: 008-agent-router
**Scope**: Per-backend quota remaining detection via interactive CLI scraping

---

## Probe Methods by Backend

| Backend | Method | CLI | Send Keys | Parse Regex | Notes |
|---|---|---|---|---|---|
| `codex` | interactive-scrape | `codex` | `/status` | `5h limit:\s+\[.*\]\s+(\d+)% left` | Percentage is "remaining" |
| `gemini` | interactive-scrape | `gemini` | `/stats session` | `Usage remaining\s+(\d+\.?\d*)%` | Per-model; use lowest |
| `claude` | interactive-scrape | `claude` | `/usage` | `(\d+)% used` | Inverted: remaining = 100 - used |
| `codex-cloud` | optimistic | — | — | — | Always returns 100% |

## Shell Helper: `scripts/dev/quota-probe.sh`

```bash
quota-probe.sh <cli_command> <send_keys> <parse_regex> [--invert] [--timeout 5]
```

Uses `tmux` to:
1. Create detached session
2. Launch CLI command
3. Wait for prompt (2s)
4. Send keys + Enter
5. Wait for output (3s)
6. Capture pane output
7. Parse with regex
8. Kill session
9. Return JSON: `{ "percent": N, "resetsIn": "..." }`

### Exit Codes
| Code | Meaning |
|---|---|
| `0` | Parsed successfully |
| `1` | Parse failed (output didn't match regex) |
| `2` | Timeout (CLI didn't respond in time) |
| `3` | tmux not available |
