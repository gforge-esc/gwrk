# R002 — Agent Backend & Workflow Plugin Design

> **Status:** Draft — Awaiting Review
> **Initiative:** [R002 brief](file:///Users/gonzo/Code/gwrk/docs/research/R002-agent-backend-plugin/brief.md)
> **Consumer:** F014 spec expansion, architecture.md v5.0

---

## Executive Summary

The initial F014 Plugin System focused solely on Layer 2 (Skills) and omitted execution mechanics for Layer 1 (Agent Backends) and Layer 2.5 (Workflows). 

This research establishes the comprehensive execution design across all plugin layers. Crucially, it redefines the boundary for Workflows (`gwrk define` operations) from "unstructured markdowns invoking IDE-like filesystem edits" to "strict JSON intent generators" natively orchestrated by TypeScript code.

**Key Findings:**
1. **Agent manifests are distinct from skill manifests.** They handle CLI flags, `dispatchMode`, exit map normalization, and config boundary definitions.
2. **Workflows are NOT skills.** Skills return text to the user. Workflows return structural JSON intents to `gwrk` core, which securely mutates the filesystem.
3. **Orchestration bash scripts must die.** To move to a true plugin architecture, `define-until-solid.sh` and `agent-run.sh` must be refactored into native TS router infrastructure (`DispatchOrchestrator`).

---

## Q1: Agent Manifest Schema

Agent manifests declare how gwrk interfaces with underlying tools like Claude Code, Codex, or Gemini.

```yaml
# Example: ~/.gwrk/plugins/agents/claude/manifest.yaml
type: agent
name: claude
dispatchMode: local-cli
contextFileName: CLAUDE.md

invocation:
  command: claude
  headless: ["-p"]
  yolo: ["--dangerously-skip-permissions"]

capabilities:
  supportsStdin: true
  supportsStructuredOutput: true

models:
  default: claude-sonnet-4-6
  define: claude-opus-4-6

exitCodeMap:
  0: { exitCode: 0, errorType: null }
  # Claude uses dynamic non-0 for errors. Mapped to gwrk's 1.

managedConfig:
  - path: ".claude/settings.json"
    keys: ["permissions", "hooks"]
```

**Skill vs Agent Manifest Comparison:**
- **Identities**: Both share `name`, `version`, `description`.
- **Runtimes**: Skill manifests dictate *prompt compilation and execution logic*. Agent manifests dictate *process invocation and flag interpolation*.

---

## Q2: Adapter Lifecycle

**local-cli Dispatch Mode:**
1. **Install/Register**: `manifest.yaml` cached, mapped to `AgentBackend` instances.
2. **syncGovernance**: `gwrk` copies core rules to CLI-specific file (`CLAUDE.md`).
3. **Dispatch**: gwrk spawns process natively, pipes STDIN, waits.
4. **ParseResult**: Adapter translates native text + exit code into a standardized `TaskResult`.

**github-integration Mode** (e.g., Codex Cloud):
- Phase 1 of F014 defers this entirely to a future feature. 
- Phase 2 will implement `CloudAgentBackend`.

---

## Q3: Config Conflict Detection

Installed plugins declare configuration keys they "own" (e.g., `.gemini/settings.json` `tools.sandbox`).
1. **Install-Time**: `gwrk plugin install` prevents installation of an agent claiming keys owned by another agent.
2. **Dispatch-Time**: Agent backend reads user configuration dynamically before dispatch. If a user manually violated a requirement, the agent exits with error `2` (usage error).

---

## Q4: Governance Sync Mechanics

`.gwrk/agent-context.md` serves as the authoritative source of project governance. It contains a generic `Architecture/Conventions` header, and specific sections keyed to agents (e.g., `### [claude]`).

When `syncGovernance` runs, the backend reads this file, isolates general rules + its specific sub-rules, and overwrites the block located between markers (e.g., `<!-- gwrk:begin -->` and `<!-- gwrk:end -->`) inside the specific file (`CLAUDE.md`), leaving the user's manual annotations intact.

---

## Q5: Migration Path from Current Facade

The current `src/utils/agent.ts` is surgically bisected:
- `buildCommand()` and `EXIT_CODE_MAP` are deprecated.
- `dispatchToAgent(task)` persists as the internal router:
  ```typescript
  const backend = pluginRegistry.getAgentBackend(task.agent);
  const invocation = backend.dispatch(task); // Pulls command + args
  const raw = await spawnAndCollect(invocation); // gwrk code running process
  return backend.parseResult(raw.stdout, raw.stderr, raw.exitCode);
  ```

---

## Q6: Workflow Execution Runtime (Layer 2.5)

Workflows have been dangerously conflated with Skills. They require distinct runtime handling.

**Boundary Rule:**
- **Skill:** Consumes STDIN, outputs unstructured text to STDOUT.
- **Workflow:** Consumes STDIN + Codebase, outputs strict JSON Object to STDOUT.

A `WorkflowPlugin` defines exactly what JSON schema it expects the underlying agent to return.

```yaml
# ~/.gwrk/plugins/workflows/plan/manifest.yaml
type: workflow
name: plan
description: "Generates phase-structured plan.md"
outputSchema:
  type: object
  properties:
    action: { enum: ["WRITE_FILE"] }
    filePath: { type: "string" }
    content: { type: "string" }  # The markdown to write
```

When `gwrk define plan` is invoked, the `WorkflowRuntime`:
1. Compiles the brief/spec.
2. Invokes an `AgentBackend` instructing it specifically to return JSON matching the schema.
3. Captures output into an internal object.

---

## Q7: Filesystem Decoupling & LLM Isolation

**The core paradigm shift**: The LLM running the workflow **never directly writes to the filesystem**. 

Currently, `plan.md` broke because the prompt instructed the agent (Antigravity/Gemini) to overwrite files. Under F014, the LLM constructs an "intent."

When the AgentBackend returns stdout containing:
```json
{
  "action": "WRITE_FILE",
  "filePath": "specs/005-parallel-dispatch/plan.md",
  "content": "## Phase 1..." 
}
```
The `WorkflowRuntime` in `gwrk` core detects the intent, executes `fs.writeFileSync(path, payload)`, and updates the UI execution logger. The execution environment is completely decoupled from the reasoning engine.

---

## Q8: Orchestration Subsystem Migration

The current multi-step pipelines rely on Bash state machines (`scripts/dev/define-until-solid.sh` and `work-until-done.sh`). These must be eradicated.

A new native TypeScript construct `DispatchOrchestrator` is required.
1. `DispatchOrchestrator` wraps the sequence: it calls the `WorkflowRuntime`, checks the JSON payload, executes edits, tests conditions, maps exit codes, and repeats via native recursion.
2. Bash scripts are fully retired.
3. This creates a true, self-contained `gwrk` IDE without any external runner dependencies.
