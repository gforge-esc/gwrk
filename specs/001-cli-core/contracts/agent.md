---
type: contract
feature: 001-cli-core
last_modified: "2026-02-27T00:04:35Z"
---

# Contract: Agent Dispatch

**Feature**: 001-cli-core
**Scope**: Agent backend invocation abstraction

---

## `dispatchAgent(opts: DispatchOptions): Promise<{ exitCode: number; stdout: string; stderr: string }>`

**Source**: `src/utils/agent.ts`
**Consumed by**: `src/commands/specify.ts`, `plan.ts`, `analyze.ts`, `effort.ts`

Resolves the agent backend from config, builds CLI arguments, and invokes the agent process. All agent backends are invoked in non-interactive, headless mode.

```typescript
interface DispatchOptions {
  backend: AgentBackend;
  workflowPath: string;     // e.g. ".agent/workflows/specify.md"
  featureDir?: string;      // e.g. "specs/001-cli-core"
  prompt?: string;          // For specify: the feature description
  approvalMode?: string;    // "yolo" | "auto" | "plan"
}

type AgentBackend = 'gemini' | 'claude' | 'codex' | 'codex-cloud';

function dispatchAgent(opts: DispatchOptions): Promise<{ exitCode: number; stdout: string; stderr: string }>
```

### Backend Resolution

| Backend | CLI Binary | Headless Flag |
|---|---|---|
| `gemini` | `gemini` | `-p` (prompt mode) |
| `claude` | `claude` | `-p --output-format json` |
| `codex` | `codex` | `exec --full-auto` |
| `codex-cloud` | `codex` | `run --cloud --non-interactive --full-auto` |

### Argument Construction

```bash
# gemini example:
gemini -p .agent/workflows/specify.md "specs/001-cli-core" --approve-mode=yolo

# claude example:
claude -p --output-format json .agent/workflows/plan.md "specs/001-cli-core"
```

**Returns**: Process exit code, stdout, stderr
**Does NOT throw** on non-zero exit — caller decides what to do.
