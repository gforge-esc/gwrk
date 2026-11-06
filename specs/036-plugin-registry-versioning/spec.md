# 036 Plugin Registry Versioning

Add SemVer plugin versioning and integrity verification to the gwrk plugin registry. Blocked: none.

## Requirements

| ID | Requirement | Target | Verdict |
|---|---|---|---|
| FR-036-01 | Parse plugin version specifiers and evaluate SemVer ranges | 100% pass | Required |
| FR-036-02 | Generate registry.json catalog with SHA-256 digests | 17 plugins | Required |
| FR-036-03 | Verify digest and write plugins-lock.json on install | SHA-256 | Required |
| FR-036-04 | Upgrade only when remote SemVer exceeds installed version | SemVer | Required |
| FR-036-05 | Support AGY-style enable state in config and plugins.json | All types | Required |
| FR-036-06 | Provide gwrk plugin index and gwrk plugin doctor commands | 2 commands | Required |
