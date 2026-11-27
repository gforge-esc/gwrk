# CLI Command Grammar and Reference

Every command below matches `gwrk <command> --help` in `1.6.0-beta.3`. Run `gwrk <command> --help` for all options. Blocked: none.

```text
gwrk <verb> [subverb] <feature> [phase] [--options]
```

Feature arguments accept a numeric prefix. For example, `001` resolves to `specs/001-my-feature`. Phase arguments accept `1`, `01` or `phase-01`.

## Discovery and definition

| Command | Scope | Description |
|---|---|---|
| `gwrk init [--non-interactive] [--context-only] [--architecture <target>]` | Target project | Initialize project config, agent config and architecture context |
| `gwrk assess [--print] [--output <dir>]` | Target project | Assess code against `.gwrk/architecture.md` and propose feature specs |
| `gwrk define research <initiative> [--methodology <type>] [--run]` | Target project | Scaffold or run a technical, JTBD or ontology research initiative |
| `gwrk define ontology [--run] [--refs <path>]` | Target project | Scaffold or construct `.gwrk/ontology/domain.md` |
| `gwrk define spec [feature-name-or-id] [description]` | Target project | Create a new spec or refine an existing one |
| `gwrk define plan <feature> [prompt]` | Target project | Create or amend `plan.md` |
| `gwrk define tests <feature> [phase]` | Target project | Generate RED test files |
| `gwrk define tasks <feature> [phase]` | Target project | Produce `tasks.json` and gate scripts |
| `gwrk define adr [title] [--reindex] [--check]` | Target project | Scaffold ADRs, rebuild the decision index and verify citations |

## Shipping, verification and metrics

| Command | Scope | Description |
|---|---|---|
| `gwrk ship <feature> --dry-run` | Target project | Check pre-flight setup without agent execution |
| `gwrk ship <feature> <phase> --worktree --max-iterations 2` | Target project | Run one bounded phase in an isolated git worktree |
| `gwrk test <feature> [phase]` | Target project | Run the test suite scoped to feature test files |
| `gwrk gate <feature> [-p <phase>] [-t <taskId>]` | Target project | Run phase or task gate scripts |
| `gwrk tasks list <feature>` | Target project | List task statuses |
| `gwrk tasks next <feature> <phase>` | Target project | Show the next open task in a phase |
| `gwrk tasks done <feature> <taskId>` | Target project | Mark a task complete only if its gate passes |
| `gwrk harvest <feature> [phase] [--project <slug>] [--pr <number>]` | Server role | Reconcile post-merge harvest state and local gates |
| `gwrk measure pulse` | Target project | Show the productivity dashboard |
| `gwrk measure compression [feature] [--all]` | Target project | Compute compression ratios |

## Plugins, models and diagnostics

| Command | Scope | Description |
|---|---|---|
| `gwrk plugin search <query>` | Global | Search the plugin registry |
| `gwrk plugin install <id-or-url-or-path>` | Global | Install a plugin from [gwrk-plugins](https://github.com/gforge-esc/gwrk-plugins), a URL or a local path |
| `gwrk plugin list [--project]` | Project or global | List built-in and installed plugins |
| `gwrk plugin remove <name>` | Global | Remove an installed plugin |
| `gwrk plugin doctor` | Global | Verify plugin manifests and SHA-256 lockfile digests |
| `gwrk models discover` | Target project | Discover model catalogs across enabled adapters |
| `gwrk status [--project <slug>]` | Local or hosted | Show server, project and agent readiness |
| `gwrk status --server-url <url> --credential-file <path> --credential-origin <origin>` | Hosted | Check hosted readiness with a protected credential file |
| `gwrk device` | Local machine | Show the machine role |

## Operator-only server administration

Operators run these commands on the hosted server host against its local SQLite database. They are not HTTP endpoints. On a Linux runner, run them as the service account with `runuser -u gwrk -- env GWRK_HOME=/var/lib/gwrk GWRK_RUNTIME_DIR=/run/gwrk node /opt/gwrk/current/dist/cli.js <command>`.

| Command | Audience | Description |
|---|---|---|
| `gwrk project enroll --path <dir> --repo <owner/name> --slug <slug> --runners hosted --role <binding>` | Operator-only | Enroll a server checkout with runner policy and role bindings |
| `gwrk project list` | Operator-only | List enrolled projects and readiness |
| `gwrk project show <project>` | Operator-only | Show one enrolled project and its role bindings |
| `gwrk auth key create --label <text> --grant <project>=<role> --expires-at <iso8601> --origin <url> --secret-out <path>` | Operator-only | Issue a `gwrk_v1.<id>.<secret>` credential into a new `0600` file |
| `gwrk auth key list` | Operator-only | List credential public metadata |
| `gwrk auth key rotate <credentialId> --expires-at <iso8601> --secret-out <path>` | Operator-only | Rotate a credential and revoke the old key |
| `gwrk auth key revoke <credentialId> [--reason <text>]` | Operator-only | Revoke a credential by public ID |
| `gwrk server start --foreground` | Operator-only | Start the control-plane origin in the foreground |
| `gwrk db backup --out <dir>` | Operator-only | Create a verified ledger backup |
| `gwrk db restore --from <dir> --state-dir <dir> [--force]` | Operator-only | Verify a backup and restore an offline Linux ledger |
| `gwrk db rollback-check --current <dir> --target <dir>` | Operator-only | Check migration compatibility before a release rollback |

Role bindings use `<principalType>:<principalId>=<role>`. A Google principal looks like `google_sub:https://accounts.google.com:<google-sub>=operator`.
