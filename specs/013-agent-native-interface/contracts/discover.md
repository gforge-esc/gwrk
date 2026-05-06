# Contract: Discover — Project Discovery Engine

**Source**: `src/engine/discover.ts`
**Spec**: FR-004, FR-005, DM-001, TC-004

## Method

```typescript
export async function discoverProject(root: string): Promise<ProjectDiscovery>;
```

## Schema (DM-001)

```typescript
interface ProjectDiscovery {
  project: {
    name: string;           // From .gwrkrc.json or directory name
    root: string;           // Absolute path
    git: {
      branch: string;       // Current branch
      clean: boolean;       // Working tree clean?
      lastCommit: string;   // Short hash + subject
    };
  };
  specs: SpecSummary[];
  gates: {
    total: number;
    passing: number;
    failing: number;
  };
  config: {
    hasSlack: boolean;       // .gwrkrc.json has slack config
    hasServer: boolean;      // Server config present
    agents: string[];        // Detected agent CLIs (gemini, claude, codex)
  };
}

interface SpecSummary {
  id: string;               // e.g., "004"
  name: string;             // e.g., "ship-loop"
  dirPath: string;          // Relative path from project root
  status: 'drafted' | 'planned' | 'tasked' | 'shipped';
  hasPlan: boolean;
  hasTasks: boolean;
  phases: number;           // Count of phases in tasks.json (0 if no tasks)
  tasksOpen: number;
  tasksComplete: number;
}
```

## Data Sources

| Field | Source | Method |
|---|---|---|
| `project.name` | `.gwrkrc.json` or `path.basename(root)` | `loadConfig()` fallback to dirname |
| `project.git` | `.git/` | `git status --porcelain`, `git branch --show-current`, `git log -1 --format="%h %s"` |
| `specs` | `specs/*/spec.md` | Glob, check for plan.md, tasks.json to determine status |
| `gates` | `specs/*/gates/T*-gate.sh` | Execute each, collect exit codes |
| `config.agents` | `PATH` | `which gemini`, `which claude`, `which codex` |
| `config.hasSlack` | `.gwrkrc.json` | Check for `slack` key |
| `config.hasServer` | `.gwrkrc.json` | Check for `server` key |

## Status Derivation

| Condition | Status |
|---|---|
| Only `spec.md` exists | `drafted` |
| `spec.md` + `plan.md` exist | `planned` |
| `spec.md` + `plan.md` + `.gwrk/tasks.json` exist | `tasked` |
| All tasks in `.gwrk/tasks.json` are `completed` | `shipped` |

## Invariants

- **TC-004**: MUST NOT read from `~/.gwrk/gwrk.db` or call `localhost:18790`
- All data MUST be derivable from the repository clone alone
- MUST work in: local CLI, local agent sandbox, Codex Cloud VM
- On missing `.gwrkrc.json`: exit 1 with `Not a gwrk project. Run 'gwrk init' to add gwrk.`
- On missing `specs/`: succeed with `specs: []`

## Error States

| Condition | stderr Contains | Exit Code |
|---|---|---|
| Not a gwrk project (no `.gwrkrc.json`) | `Not a gwrk project. Run 'gwrk init' to add gwrk to this project.` | 1 |
| Git not available | `git not found in PATH. gwrk requires git.` | 1 |
| No specs directory | Succeeds with `specs: []` | 0 |
