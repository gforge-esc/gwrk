# CLI Command Grammar & Reference

All commands follow the Foxtrot Charlie grammar:

```text
gwrk <verb> [subverb] <feature> [phase] [--options]
```

Feature arguments support prefix aliasing (`051` resolves to `specs/051-hosted-aws-pilot`).

## Pillar 1 & 2: Discovery & Definition (`define`)

| Command | Description |
|---|---|
| `gwrk define research <topic>` | Scaffold a Discovery initiative using JTBD, ontology, or technical methodology |
| `gwrk define spec <feature>` | Create or refine `spec.md` with binary acceptance criteria |
| `gwrk define plan <feature>` | Generate `plan.md` with phased architecture and test coverage matrix |
| `gwrk define tests <feature>` | Author RED tests and verify coverage alignment |
| `gwrk define tasks <feature>` | Produce `.gwrk/tasks.json` and executable `gates/phase-XX.sh` scripts |
| `gwrk define adr --check` | Validate Architecture Decision Record headers, approvals, and index |

## Pillar 3: Shipping (`ship`, `tasks`, `gate`)

| Command | Description |
|---|---|
| `gwrk ship <feature> [phase]` | Run autonomous implement -> build -> test -> review loop |
| `gwrk ship <feature> --dry-run` | Verify pre-flight setup and worktree readiness without launching agents |
| `gwrk gate <feature> <taskId>` | Execute a single task gate script directly |
| `gwrk tasks list <feature>` | Inspect phase and task RAGB statuses from `.gwrk/tasks.json` |
| `gwrk tasks next <feature> <phase>` | Print the next actionable task in a phase |

## Execution Compression & Velocity Signals (`measure`)

| Command | Description |
|---|---|
| `gwrk measure pulse` | Inspect daily repository shipping velocity and commit activity |
| `gwrk measure compression <feature>` | Inspect execution compression (LOC-derived effort forecast vs. actual shipping time) |

## Hosted Reference Architecture Operations (`auth`, `db`, `server`)

| Command | Description |
|---|---|
| `gwrk server start --foreground` | Start the Fastify control-plane daemon on loopback `127.0.0.1:18790` |
| `gwrk auth key create --label <name> --grant <slug>=<role> --expires-at <iso> --out <file>` | Provision a scoped `gwrk_ak_v1_` operator API credential into a `0600` file |
| `gwrk auth key list` | List active and revoked operator API credentials without exposing secrets |
| `gwrk auth key rotate <credentialId> --expires-at <iso> --out <file>` | Atomically rotate an operator API key and revoke the predecessor |
| `gwrk auth key revoke <credentialId>` | Immediately revoke an operator API credential |
| `gwrk db backup --out <dir>` | Create a verified SQLite snapshot with SHA-256 manifest |
| `gwrk db restore --from <dir> --force` | Restore SQLite state fail-closed from a verified backup directory |
| `gwrk db rollback-check --target-release <path>` | Verify migration compatibility before rolling back a release symlink |
