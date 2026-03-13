# Observability Governance

**Version**: 2.0  
**Status**: Active  
**Scope**: Local-Only Debug Interface & Support Instrumentation

---

## Purpose

CodeRed is **air-gapped by default**. Observability is a **debug and support instrument**, not a monitoring pipe. There is no "phone home."

---

## Core Principles

### O1: Local-Only Storage
All logs and metrics are stored locally in `%APPDATA%/CodeRed/logs` (Windows) or `~/Library/Application Support/CodeRed/logs` (macOS). NEVER transmit to external endpoints.

### O2: Domain-Aligned Naming
Metrics follow `{domain}_{entity}_{action}_{suffix}` convention:

| Domain | Metrics | Purpose |
|---|---|---|
| `engine` | `engine_parse_duration_ms`, `engine_diff_duration_ms` | Performance bottleneck identification |
| `pipeline` | `pipeline_stage_state`, `pipeline_files_processed_total` | Stage completion visualization |
| `audit` | `audit_events_total`, `audit_log_size_bytes` | Audit trail health monitoring |

### O3: Structured Logging
All logs are structured JSON with required fields:

```typescript
{
    level: 'info' | 'warn' | 'error',
    operation: string,
    domain: 'engine' | 'pipeline' | 'audit' | 'export',
    timestamp: string,  // ISO 8601
    ...contextFields
}
```

### O4: Support Bundle
`make support-bundle` (or `bd support-bundle`) generates a sanitized export:
- Aggregates logs and SQLite metadata.
- **Strips** source code filenames and content (keeps AST structure hashes only).
- Outputs `support-evidence.zip` for manual upload to a support ticket.

### O5: Internal Debug Dashboard
Hidden view activated by `Ctrl+Alt+D` (desktop only):
- Engine heartbeat and latency.
- Local CPU/RAM pressure.
- Pipeline queue depth and stage progress.
- Not visible to end users by default.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 2.0 | 2026-02-21 | Rewritten for CodeRed air-gapped model. Removed Prometheus/Grafana. |
| 1.0 | — | Initial GForge version (deprecated for CodeRed) |
