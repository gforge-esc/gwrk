# Consumer-Agent Guide (v1.6.0-beta.2)

Work only inside the assigned target project checkout. Verify context and decision records before you change code. Ship one bounded phase in a worktree, then stop at human merge authority. Blocked: none.

> Scope: this guide governs an AI agent that uses gwrk inside a consumer project. It does not govern contributors to gwrk itself. Never copy gwrk's own `AGENTS.md` into a target project.

## Required handoff inputs

Confirm these inputs before you start. If a required input is missing, report the gap and stop.

| Input | Local task | Hosted task |
|---|---|---|
| Target repository checkout and branch | Required | Required |
| Approved feature ID, phase and acceptance criteria | Required | Required |
| Target project instructions and architecture choice | Required | Required |
| Verification commands and merge authority owner | Required | Required |
| Enrolled project slug and server origin | Not needed | Required |
| Path to a protected `0600` API credential file | Not needed | Required |

Never accept a raw key in the prompt. Accept only the path to the credential file.

## Initialize a fresh or existing project

If the target repository has no `.gwrkrc.json`, run setup from the repository root:

```bash
# Full non-interactive initialization
gwrk init --non-interactive \
  --architecture hexagonal-functional \
  --principles functional-core,clean-code,tdd \
  --language TypeScript

# Context only, without machine registration or agent probing
gwrk init --context-only --architecture hexagonal-functional --language Python --framework FastAPI
```

Initialization and decision rules:

- `gwrk init` preserves project identity and authored ADRs on re-run. Never overwrite a user-edited decision record.
- `gwrk init` makes no model calls and does not certify conformance. `gwrk assess` compares code with the target and proposes feature specs.
- Preserve every ADR status. Follow `Decided` constraints. Never ratify a `Proposed` ADR without a human instruction.
- External agents, framework packs and review plugins come from [gwrk-plugins](https://github.com/gforge-esc/gwrk-plugins). Manifest model defaults are compatibility aliases, not qualified model promotions.

## Startup checks

Run these checks after initialization at the target project root. The generated `.gwrk/decisions/index.md` must now exist. Read it before you edit or ship code.

1. Read the target project's `AGENTS.md`, `.gwrk/architecture.md` and `.gwrk/decisions/index.md` when present.
2. Confirm the CLI and runtime versions:

```bash
gwrk --version
node --version
```

3. Check decision index freshness and citations:

```bash
gwrk define adr --check
```

4. Check enforcement skills and external plugin integrity:

```bash
gwrk plugin list --project
gwrk plugin doctor
```

5. Confirm that at least one supported agent CLI (`agy`, `claude` or `codex`) is installed and signed in. Do not select the retired `gemini` backend.

## Local and hosted boundaries

- Local execution: run every `gwrk` command inside the target checkout.
- Hosted execution: authenticate automation only with a scoped `gwrk_v1.<id>.<secret>` credential read from a `0600` file outside every checkout. Browser Google login is for people. It is neither an automation credential nor a role grant.
- Hosted readiness check, with the key read from the file:

```bash
gwrk status \
  --server-url https://gwrk.gforge.ai \
  --credential-file <path-to-0600-credential-file> \
  --credential-origin https://gwrk.gforge.ai \
  --project <slug>
```

- Operators enroll projects, prepare server checkouts and issue keys with local admin commands on the server host. Never invent HTTP enrollment routes. Never enroll a project or send Slack messages without explicit authorization.

## Safe execution rules

1. Check setup with a dry run before an autonomous ship loop:

```bash
gwrk ship <feature> --dry-run
```

2. Run one phase at a time in an isolated git worktree with an iteration cap. Start it as a background task and monitor it:

```bash
gwrk ship <feature> <phase> --worktree --max-iterations 2
```

3. Keep one writer per feature branch. Use separate worktrees for concurrent work.
4. Set `GIT_EDITOR=true` and `EDITOR=true`. Pass non-interactive flags. Never open a pager or an editor.
5. Never place API keys, cookies or provider tokens in prompts or command arguments. Never write them to committed files, logs or checkpoints.
6. Never use `git commit --no-verify`. Use the author and committer identity that the repository policy requires.

## Required evidence and merge authority

Report each item as a separate verified state before you hand work back.

| Evidence | Command or location |
|---|---|
| Gate results | `gwrk gate <feature> -p <phase>` or `gwrk gate <feature> -t <taskId>` |
| Task state | `gwrk tasks list <feature>` |
| Run manifests and review verdicts | `specs/<feature>/.gwrk/runs/` |
| Post-merge harvest (server role) | `gwrk harvest <feature> <phase> --project <slug>` |
| Notification delivery and readiness | `gwrk status --project <slug>` |
| Compression signal | `gwrk measure compression <feature>` |

Stop after you open the pull request and record evidence. The human owner decides merges and promotion to `main`. The owner also decides releases and deployments.
