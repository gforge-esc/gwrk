# 038 Specification

Feature 038 persists token usage and USD cost in SQLite and compression reports. It also records workstation provenance. Blocked: none.

## Requirements

| ID | Requirement | Target | Verdict |
|---|---|---|---|
| FR-001 | Migration 012 adds telemetry columns to the runs table | 5 columns | Met |
| FR-002 | Run persistence stores device identity and token cost | 100% pass | Met |
| FR-003 | Harvest backfill hydrates telemetry from execution manifests | 100% pass | Met |
| FR-004 | Compression reports include token and cost per story point | 100% pass | Met |
