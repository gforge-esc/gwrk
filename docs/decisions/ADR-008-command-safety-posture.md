# ADR-008: Command Safety Posture for Agent-Executed Sub-Processes

> **Status:** Decided · **Date:** 2026-06-02
> **Decision:** All agent-dispatched workflows MUST operate under a command safety posture: no interactive commands, no unbounded processes, explicit conflict detection, and deterministic recovery from hung sub-commands. This is an architectural constraint, not a prompt fix.
> **Depends on:** ADR-007 (Single Dispatch Path), F004 (Ship Loop), F014 (Plugin System)
> **Author:** David Gonzalez · **Decision Scope:** Agent execution model, prompt architecture, workflow safety

---

## 1. Context

### The Failure Pattern

Agents dispatched by `gwrk ship` and `gwrk define` execute bash commands as part of their workflow. The failure mode that repeatedly surfaces is not "the agent hangs" — it is "a sub-command the agent called hangs, and the agent doesn't know how to recover."

Real-world examples observed in daily-driver use:

| Sub-command | Why it hangs | Agent behavior |
|-------------|-------------|----------------|
| `git merge develop` | Merge conflict opens `$EDITOR` | Agent waits forever for editor to close |
| `pnpm build` | TypeScript plugin prompts for stdin | Agent waits for input it can't provide |
| `pnpm dev` / `npm start` | Long-running dev server | Agent waits for a process that never exits |
| `npx` without `-y` | Interactive "install?" prompt | Agent waits for Y/N confirmation |
| `git commit` without `-m` | Opens `$EDITOR` for commit message | Agent waits for editor |
| `pkill -f 'pattern'` | Matches zombie in uninterruptible state | Signal delivery blocks |

### Why This Is a Posture, Not a Fix

Adding `timeout` wrappers to specific commands is whack-a-mole. The problem is structural:

1. **No contract exists** between gwrk and agent-executed commands. The agent has no guidance on which commands are safe (non-interactive, bounded) vs. dangerous (interactive, unbounded).
2. **No recovery protocol exists.** When a command hangs, the agent has no instruction to kill it, retry with different flags, or escalate. It just waits.
3. **No enforcement exists.** Even with prompt guidance, nothing mechanically prevents an agent from running `pnpm dev` or `vim`.
4. **The problem is project-agnostic.** Every project has commands that can hang. This is not a gwrk-specific concern — it's a property of agent-executed sub-processes.

### Forces

- **Agents are not interactive users.** They cannot respond to prompts, resolve merge conflicts, or close editors. Commands that assume a human operator are lethal to agent workflows.
- **Prompt guidance is necessary but insufficient.** Agents follow instructions, but they also improvise. A `<command_safety>` block in every prompt reduces risk but doesn't eliminate it.
- **Mechanical enforcement is the only reliable posture.** If the agent adapter or workflow runtime can detect and kill hung processes, the system recovers regardless of prompt quality.
- **Different backends have different capabilities.** Some agent backends (agy, Codex) have built-in command timeouts. Others (gemini CLI, claude CLI) do not. The safety posture must work regardless of backend.

---

## 2. Decision

### 2.1 Three-Layer Command Safety

Command safety is enforced at three layers. Each layer is independent — defense in depth.

#### Layer 1: Prompt Posture (`<command_safety>` block)

Every workflow prompt (`PROMPT.md`) that dispatches to an agent with shell access MUST include a `<command_safety>` block:

```xml
<command_safety>
RULES FOR EVERY COMMAND YOU RUN:
1. NEVER run interactive commands. All commands must complete without human input.
2. NEVER start long-running servers (pnpm dev, npm start, python -m http.server).
3. ALWAYS use non-interactive flags: --no-edit, --non-interactive, -y, --yes.
4. ALWAYS set GIT_EDITOR=true and EDITOR=true to prevent editor invocations.
5. If a command produces no output for 60 seconds, kill it (Ctrl-C) and retry
   with --non-interactive or equivalent flags.
6. If `git merge` output contains "CONFLICT", abort with `git merge --abort`
   and report the conflict. Do NOT attempt manual resolution.
7. Prefer `timeout 120 <command>` for any build or test command.
8. NEVER run: vim, nano, less, more, man, top, htop, watch, tail -f.

SAFE PATTERNS:
  git merge develop --no-edit
  GIT_EDITOR=true git commit -m "message"
  timeout 120 pnpm build
  npx -y <package>
  pnpm test --reporter=verbose 2>&1 | head -100

UNSAFE PATTERNS:
  git merge develop          ← may open editor
  git commit                 ← opens editor
  pnpm dev                   ← never exits
  npx <package>              ← interactive install prompt
  cat                        ← waits for stdin
</command_safety>
```

This block is **not optional**. It is injected by the workflow runtime into every agent-dispatched prompt, the same way `{{enforcement}}` skills are injected today.

#### Layer 2: Environment Hardening (Dispatch-Level)

`dispatchToAgent()` MUST set environment variables that mechanically prevent interactive behaviors:

```typescript
const safeEnv = {
  ...process.env,
  GIT_EDITOR: "true",           // git commit without -m → no-op editor
  EDITOR: "true",               // any $EDITOR invocation → no-op
  VISUAL: "true",               // fallback editor variable
  GIT_MERGE_AUTOEDIT: "no",     // git merge → no editor
  DEBIAN_FRONTEND: "noninteractive",  // apt-get → no prompts
  CI: "true",                   // many tools detect CI and disable interactivity
  npm_config_yes: "true",       // npm/npx → auto-yes
};
```

This layer works regardless of prompt quality. Even if the agent runs `git commit` without `-m`, the editor opens as `true` (a shell built-in that exits 0), so the commit proceeds with a default message rather than hanging.

#### Layer 3: Process Watchdog (Future — Mechanical Kill)

> [!NOTE]
> Layer 3 is the mechanical backstop. It is not required for the initial implementation but is the architectural target.

The agent adapter monitors sub-process stdout/stderr. If no output is produced for a configurable threshold (default: 120 seconds), the sub-process is killed via `SIGTERM`, and the agent receives a notification:

```
[WATCHDOG] Process killed after 120s of no output.
Command: git merge develop
Recommendation: Retry with --no-edit flag or abort merge.
```

This layer is backend-dependent. Some agent backends (agy) already have command timeout capabilities. For backends that don't (raw CLI dispatch), `dispatchToAgent()` wraps the child process with a watchdog timer.

### 2.2 Scope of Application

| Workflow | Layer 1 (Prompt) | Layer 2 (Env) | Layer 3 (Watchdog) |
|----------|-----------------|---------------|-------------------|
| `gwrk-implement` | ✅ Required | ✅ Required | Future |
| `gwrk-review-*` | ✅ Required | ✅ Required | Future |
| `gwrk-research` | ✅ Required | ✅ Required | Future |
| `gwrk define spec` | ✅ Required | ✅ Required | Future |
| Custom plugins | ✅ Injected by runtime | ✅ Inherited from dispatch | Future |

### 2.3 Relationship to Project Perspective (R007)

Some command safety rules are project-specific:
- A Python project should never run `python manage.py runserver` in an agent session
- A Go project should `timeout` its `go build` differently than TypeScript's `pnpm build`
- A Docker project should set `DOCKER_CLI_HINTS=false` to suppress interactive prompts

These project-specific rules belong in **enforcement skills** (R007), not in the base `<command_safety>` block. The base block covers universal anti-patterns (editors, servers, stdin waits). Project enforcement skills extend it.

---

## 3. Impact Analysis

### 3.1 `dispatchToAgent()` in `agent.ts`

Add `safeEnv` construction at dispatch time. Currently (line 284):

```typescript
// No overall timeout — agents can run as long as needed.
```

After:

```typescript
// Layer 2: Environment hardening — prevent interactive sub-processes
const safeEnv = {
  ...env,
  GIT_EDITOR: "true",
  EDITOR: "true",
  VISUAL: "true",
  GIT_MERGE_AUTOEDIT: "no",
  CI: "true",
  npm_config_yes: "true",
};
```

### 3.2 Workflow PROMPT.md Files

Add `<command_safety>` block to:
- `src/plugins/builtins/workflows/gwrk-implement/PROMPT.md`
- `src/plugins/builtins/workflows/gwrk-review-code/PROMPT.md` (when wired via ADR-007)
- `src/plugins/builtins/workflows/gwrk-research/PROMPT.md`
- `src/plugins/builtins/workflows/gwrk-define-spec/PROMPT.md`

### 3.3 Existing Safe Patterns in Implement Prompt

The implement prompt already has some safe patterns that align with this ADR:
- `pkill -f 'pnpm.*dev' || true` (line 49) — kills dev servers
- `git merge develop --no-edit` (line 80) — uses `--no-edit`

These validate the posture. The ADR formalizes and extends them.

---

## 4. Decision Record

**Position:** Command safety is a three-layer architectural posture (prompt guidance, environment hardening, process watchdog), not a per-command fix. Layer 2 (environment hardening) is the highest-ROI immediate change — it mechanically prevents the most common hang patterns regardless of agent behavior.

**Confidence:** 9/10

**Key rationale:** The failure pattern is structural, not incidental. Agents will always run commands. Some commands will always be interactive. The only reliable defense is to make the execution environment non-interactive by default, then layer prompt guidance and mechanical enforcement on top.

**Reversibility:** Full. Environment variables are additive — removing them restores default behavior. The `<command_safety>` prompt block is a content addition. Neither requires architectural changes to reverse.

**Risk:** Setting `CI=true` may cause some tools to behave differently (e.g., skipping interactive setup wizards, changing output formatting). This is generally desirable in an agent context but could cause unexpected behavior if a tool uses `CI` to gate functionality rather than just interactivity.

---

## 5. References

- [Daily-Driver Audit: Section N, FM-5](../daily-driver-audit.md) — Corrected diagnosis of hung sub-commands.
- [R007: Project Perspective](../research/R007-project-perspective/brief.md) — Project-specific command safety via enforcement skills.
- ADR-007: Single Dispatch Path — Establishes `WorkflowRuntime` as the injection point for prompt blocks.
- F004 spec: Ship loop execution model.
