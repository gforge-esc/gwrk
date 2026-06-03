# Data Model: 014 Plugin System

This document defines the schemas and data structures for the gwrk plugin system, including manifests, project-local overrides, and execution ledger additions.

## 1. Plugin Manifests (YAML)

All plugins MUST contain a `manifest.yaml` in their root directory.

### 1.1 Base Schema (Shared)

```typescript
const PluginBaseSchema = z.object({
  type: z.enum(['agent', 'skill', 'workflow', 'extension', 'channel']),
  name: z.string().min(1).regex(/^[a-z0-9-]+$/),    // kebab-case required
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().min(1),
});
```

### 1.2 Skill Manifest (Atomic)

```typescript
interface AtomicManifest extends PluginBase {
  type: 'skill';
  tier: 'atomic';
  category: 'reasoning' | 'evaluative' | 'creative' | 'persona' | 'communication' | 'operational' | 'meta';
  prompt: string;            // The mode's prompt injection
  interface: PluginInterface;
  runtime: SkillRuntime;
  tags?: string[];
}
```

### 1.3 Skill Manifest (Compound)

```typescript
interface CompoundManifest extends PluginBase {
  type: 'skill';
  tier: 'compound';
  composes: string[];        // Names of atomic skills
  passes: SkillPass[];
  interface: PluginInterface;
  context: SkillContext;
  outputContract?: string[];  // Quality assertions (LLM-enforced)
  runtime: SkillRuntime;
  tags?: string[];
}

interface SkillPass {
  name: string;              // e.g., "narrative"
  skill: string;             // Reference to atomic skill name
  summary: string;           // One-line description of this pass
}
```

### 1.4 Agent Manifest (ADR-006)

```typescript
interface AgentManifest extends PluginBase {
  type: 'agent';
  dispatchMode: 'local-cli' | 'github-integration';
  contextFileName: string;   // e.g., "GEMINI.md"
  invocation?: {
    command: string;
    args: string[];
    headlessFlag?: string;
    yoloFlag?: string;
  };
  capabilities: string[];
  models: Record<string, string>; // name -> exact model string
  exitCodeMap: Record<number, {
    exitCode: 0 | 1 | 2 | 127;
    errorType?: string;
  }>;
  managedConfig: Array<{
    path: string;
    keys: string[];
  }>;
}
```

### 1.5 Enforcement Skill Manifest (FR-014 / R007)

```typescript
interface EnforcementSkillManifest extends PluginBase {
  type: 'skill';
  tier: 'enforcement';
  scope: 'implementation' | 'review' | 'all';
  language?: string;     // R007 Profile Filtering
  framework?: string;    // R007 Profile Filtering
  toolchain?: {
    primary?: string;    // Convergence tool (e.g., "biome", "ruff")
    test?: string;       // Test framework (e.g., "vitest", "pytest")
  };
}
```

### 1.6 Workflow Manifest (Layer 2.5 - F014-R)

```typescript
interface WorkflowManifest extends PluginBase {
  type: 'workflow';
  outputSchema: Record<string, any>; // JSON Schema (Zod-backed)
  context?: string[];               // Required files/context
}
```

## 2. Shared Interfaces

### 2.1 Plugin Interface

```typescript
interface PluginInterface {
  input: 'stdin';
  output: 'stdout';
  flags?: Array<{
    name: string;
    values?: string[];
    required?: boolean;
    default?: string;
    description?: string;
  }>;
}
```

### 2.2 Skill Runtime

```typescript
interface SkillRuntime {
  preferredAgent: string;
  preferredModel: string;
  fallbackAgent?: string;
  maxInputTokens?: number;
}
```

## 2.3 JSON Intent (Layer 2.5)

```typescript
type IntentAction = 'WRITE_FILE' | 'CREATE_DIR' | 'RUN_COMMAND' | 'DELETE_FILE';

interface JsonIntent {
  action: IntentAction;
  path?: string;
  content?: string;
  command?: string;
  args?: string[];
}

interface WorkflowOutput {
  intents: JsonIntent[];
  summary: string;
}
```

## 3. Project Configuration

### 3.1 Project Profile (F013 / R007 Update)

```typescript
interface ProjectProfile {
  type: string;
  stack?: {
    language?: string;
    framework?: string;
    buildSystem?: string;
  };
  layout?: string;
  _isGwrk?: boolean;
  toolchain?: {
    primary?: string;   // e.g., "biome", "ruff", "eslint", "cargo"
    formatter?: string; // e.g., "prettier", "black"
    test?: string;      // e.g., "vitest", "jest", "pytest"
  };
}
```

### 3.2 Local Overrides (`.gwrk/plugins.yaml`)

```yaml
disable:
  - domains/writing
override:
  truth-extract: ./local-skills/truth-extract
```

## 4. SQLite Execution Ledger (Additions)

### 4.1 `routing_decisions` table

Tracks how the router selected a backend for a given task.

```sql
CREATE TABLE routing_decisions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  selected_backend TEXT NOT NULL,
  fallback_chain TEXT, -- JSON array of backends attempted
  decision_reason TEXT, -- e.g., "historical_success", "quota_limit"
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES runs(task_id)
);
```

### 4.2 `agent_context_sync` table

Tracks the synchronization state of CLI context files.

```sql
CREATE TABLE agent_context_sync (
  project_root TEXT NOT NULL,
  backend_name TEXT NOT NULL,
  last_sync_at DATETIME NOT NULL,
  context_hash TEXT NOT NULL, -- Hash of .gwrk/agent-context.md at time of sync
  PRIMARY KEY (project_root, backend_name)
);
```

## 5. Metadata

### 5.1 Git Source Tracking (`.gwrk-source.json`)

Stored in `~/.gwrk/plugins/<type>/<name>/.gwrk-source.json` for installed plugins.

```json
{
  "url": "https://github.com/user/my-skill.git",
  "ref": "main",
  "commitSha": "a1b2c3d4...",
  "installedAt": "2026-03-19T14:45:00Z"
}
```