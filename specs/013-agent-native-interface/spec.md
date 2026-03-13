---
type: specification
feature: 013-agent-native-interface
last_modified: "2026-03-13T12:00:00Z"
revision: 1
---

# Feature Specification: 013 Agent-Native Interface

**Feature Branch**: `feat/013-agent-native-interface`
**Created**: 2026-03-13
**Status**: Draft
**Input**: Why-nix architecture research, agent-clip source audit, ADR-004 (Agent-Native Output Protocol)
**Decision**: [ADR-004](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-004-agent-native-output.md)
**Reference**: [agent-native-cli.md](file:///Users/gonzo/Code/gwrk/docs/reference/agent-native-cli.md)

> **Positioning:** This is a foundational infrastructure spec. Phase 4 (Ship Loop) and Phase 8 (Agent Router) depend on the contracts established here. Signal and discovery data makes those specs thinner because they stop re-inventing output parsing, project state assembly, and cost models.

---

## 1. Problem Statement

gwrk dispatches work to LLM agents (Codex Cloud, Gemini CLI, Claude CLI) that interact with the project through shell commands. These agents operate in three environments with different capabilities:

| Environment | Build Server Access | SQLite (`~/.gwrk/gwrk.db`) Access | Git Access |
|---|---|---|---|
| **Local CLI** (PE on macOS) | ✅ localhost:18790 | ✅ Direct | ✅ Direct |
| **Local Agent** (sandbox on macOS) | ✅ localhost:18790 | ❌ Not mounted | ✅ Via clone |
| **Cloud Agent** (Codex Cloud VM) | ❌ No network to macOS | ❌ Does not exist | ✅ Via clone |

Current agent interaction is unstructured:
- Agents receive raw terminal output with ANSI color codes that waste context tokens
- No signal about command cost — agents cannot distinguish a 5ms probe from a 60s dispatch
- Errors produce stack traces instead of corrective guidance ("run X instead")
- Gate scripts return exit codes but agents don't reliably interpret success/failure
- No command self-describes as safe (query) vs. destructive (mutator)
- Project state is not queryable — agents must improvise discovery via `ls`, `cat`, `grep`

The Why-nix research (Manus production, 500K+ agent sessions) and the agent-clip source audit prove that LLM agents work best with:
1. A stable, discoverable CLI surface (not arbitrary shell)
2. Plain text output (the LLM's native format from pre-training)
3. Operational signals on stderr (cost awareness, error guidance)
4. Progressive `--help` as the discovery protocol

---

## 2. User Scenarios & Testing

### US-001 - Operational Signal on Every Command (Priority: P0)
As a Principal Engineer, I want every gwrk command to emit `[exit:N | Xs]` on stderr when it completes, so that both humans and agents instantly know the result and cost of every invocation.

**Implements**: FR-001

**Independent Test**: Run `gwrk status 2>&1 >/dev/null` and verify output contains `[exit:`.

**Acceptance Scenarios**:
1. **Given** any gwrk command, **When** it completes successfully, **Then**:
   - `gwrk status 2>&1 >/dev/null | grep -q '\[exit:0'` exits 0
   - stderr contains duration: `[exit:0 | <N>ms]` or `[exit:0 | <N.N>s]`
   - stdout is not contaminated by the signal
2. **Given** any gwrk command, **When** it fails, **Then**:
   - `gwrk tasks list nonexistent 2>&1 >/dev/null | grep -q '\[exit:1'` exits 0
   - stderr contains error context: `[exit:1 | <N>ms] tasks list: <message>`
3. **Given** a pipe chain, **When** commands are piped, **Then**:
   - `gwrk project discover 2>/dev/null | head -5` produces clean stdout (signals on stderr, not in pipe)

---

### US-002 - JSON Output via --format Flag (Priority: P0)
As a Principal Engineer, I want `--format json` on any gwrk command that produces queryable output, so that I can pipe results through `jq` for scripting — and so agents can discover this flag via `--help` when they need structured data.

**Implements**: FR-002

**Independent Test**: Run `gwrk tasks list <feature> --format json | jq .` and verify valid JSON.

**Acceptance Scenarios**:
1. **Given** a queryable command, **When** `--format json` is passed, **Then**:
   - `gwrk tasks list 000-tdd-infrastructure --format json | jq . > /dev/null` exits 0
   - Output is valid JSON on stdout
   - `[exit:N | Xs]` is still on stderr (not in JSON)
2. **Given** any command, **When** `--help` is run, **Then**:
   - Help text mentions `--format json` where applicable
   - Agents discover this flag the same way humans do — via `--help`
3. **Given** `--format json` on a command with no structured output (e.g., `gwrk server start`), **Then**:
   - Command behaves normally (flag is ignored or produces `{"status": "ok"}`)

---

### US-003 - Agent Mode with Layer 2 Protections (Priority: P1)
As a Principal Engineer, I want `--agent` (or `GWRK_AGENT=1`) to activate output protections — ANSI stripping, binary guard, overflow truncation — so that LLM agents never receive context-corrupting output, without changing the output format from text.

**Implements**: FR-003

**Independent Test**: Run `GWRK_AGENT=1 gwrk status` and verify output contains no ANSI escape codes.

**Acceptance Scenarios**:
1. **Given** `--agent` flag, **When** command produces ANSI-colored output, **Then**:
   - `gwrk status --agent | cat -v | grep -c '\^\[' ` returns 0 (no escape chars)
2. **Given** `GWRK_AGENT=1`, **When** command output exceeds 8KB, **Then**:
   - Output is truncated to first 100 lines
   - Last line contains: `... (truncated, <N> total lines. Full output: /tmp/gwrk-output-<hash>.txt)`
   - Full output is readable at the referenced path
3. **Given** `--agent`, **When** command output contains binary data (null bytes), **Then**:
   - Output is replaced with: `[binary content, <N> bytes, use 'gwrk project files <path>' for metadata]`
4. **Given** `--agent --format json`, **When** command runs, **Then**:
   - Output is structured JSON AND Layer 2 protections are active
   - The two flags compose independently

---

### US-004 - Project Discovery Engine (Priority: P0)
As a Principal Engineer, I want `gwrk project discover` to return a structured summary of project state — git status, spec inventory, task counts, gate health — so that agents can understand the project without improvising file system exploration.

**Implements**: FR-004, FR-005

**Independent Test**: Run `gwrk project discover` in any gwrk-managed project and verify it returns project state.

**Acceptance Scenarios**:
1. **Given** a gwrk-managed project, **When** `gwrk project discover` is run, **Then**:
   - Output includes: project name, root path, current git branch, clean/dirty status
   - Output includes: list of specs with status (drafted/planned/tasked/shipped)
   - Output includes: aggregate gate status (total, passing, failing)
2. **Given** `--format json`, **When** `gwrk project discover --format json` is run, **Then**:
   - `gwrk project discover --format json | jq .project.name` returns project name
   - `gwrk project discover --format json | jq '.specs | length'` returns spec count
3. **Given** a project with NO specs, **When** `gwrk project discover` is run, **Then**:
   - Output still succeeds with empty specs array
   - No crash, no missing-field errors

> **DB Access Note**: `gwrk project discover` reads from the filesystem and git only — it does NOT query `~/.gwrk/gwrk.db`. This is critical because agents running in Codex Cloud clones have git access but no SQLite access. All discovery data MUST be derivable from the repository contents alone. Build-server-only data (execution history, compression ratios) is surfaced through separate commands that explicitly require server access and fail fast if unavailable.

---

### US-005 - Spec and Gate Subcommands (Priority: P1)
As a Principal Engineer, I want `gwrk project specs` and `gwrk project gates` for focused queries, so that agents (or scripts) can get exactly the data they need without parsing the full discover output.

**Implements**: FR-005

**Independent Test**: `gwrk project specs --format json | jq '.[0].id'` returns a spec ID.

**Acceptance Scenarios**:
1. **Given** specs exist, **When** `gwrk project specs` is run, **Then**:
   - Lists specs with: id, name, status, phase count, open task count
2. **Given** gate scripts exist, **When** `gwrk project gates` is run, **Then**:
   - Runs each gate script and reports: task id, result (PASS/FAIL), duration
3. **Given** `--format json`, **When** subcommands are run, **Then**:
   - Output is valid JSON arrays

---

### US-006 - First-Class Gate Checking (Priority: P0)
As a Principal Engineer, I want `gwrk gate-check <task_id>` to run a gate script and return structured results, so that agents have an authoritative command for verification instead of running bash scripts directly.

**Implements**: FR-006

**Independent Test**: `gwrk gate-check T001 -f specs/000-tdd-infrastructure` returns PASS or FAIL.

**Acceptance Scenarios**:
1. **Given** gate script exists, **When** `gwrk gate-check T001 -f specs/000-tdd-infrastructure` is run, **Then**:
   - stdout states: PASS or FAIL with assertion details
   - `[exit:0 | Xs]` on stderr if PASS, `[exit:1 | Xs]` if FAIL
2. **Given** `--format json`, **When** `gwrk gate-check T001 --format json` is run, **Then**:
   - `jq .result` returns `"PASS"` or `"FAIL"`
   - `jq .exitCode` returns gate script exit code
3. **Given** gate script does not exist, **When** `gwrk gate-check T099` is run, **Then**:
   - stderr: `gate script not found: ... Run 'gwrk project gates' to list available gates.`
   - Exit code: 1

---

### US-007 - Error-as-Navigation (Priority: P1)
As a Principal Engineer, I want every gwrk error message to include what to run instead, so that agents (and I) never hit a dead end — every error becomes a signpost to the correct command.

**Implements**: FR-007

**Independent Test**: `gwrk tasks list nonexistent 2>&1 | grep -c "Run '"` returns ≥ 1.

**Acceptance Scenarios**:
1. **Given** missing feature, **When** `gwrk tasks list nonexistent` fails, **Then**:
   - stderr contains: `Run 'gwrk project specs' to list available features.`
2. **Given** missing spec, **When** `gwrk define plan --spec nonexistent` fails, **Then**:
   - stderr contains: `Run 'gwrk define spec <feature>' to create a specification.`
3. **Given** unknown command, **When** `gwrk foo` is run, **Then**:
   - stderr contains: `Run 'gwrk --help' to see available commands.`
   - Exit code: 127

---

### US-008 - Enriched Help Text (Priority: P1)
As a Principal Engineer, I want `--help` on every command to include exit codes, command type (query/mutator), and available format flags, so that agents can learn the contract of any command through the standard `--help` mechanism.

**Implements**: FR-008

**Independent Test**: `gwrk gate-check --help | grep -c 'Exit codes'` returns ≥ 1.

**Acceptance Scenarios**:
1. **Given** any command, **When** `--help` is run, **Then**:
   - Help text includes command type (e.g., `Type: verifier (read-only)`)
   - Help text includes exit codes section
   - Help text mentions `--format json` if command supports structured output
2. **Given** a mutator command, **When** `--help` is run, **Then**:
   - Help text declares mutation scope (e.g., `Mutates: .gwrk/tasks.json`)

---

### US-009 - Exit Code Standardization (Priority: P0)
As a Principal Engineer, I want consistent exit codes across all gwrk commands, so that agents can reliably determine success/failure from the exit code alone.

**Implements**: FR-009

**Independent Test**: `gwrk nonexistent-command; echo $?` returns 127 or Commander's standard error code.

**Acceptance Scenarios**:
1. **Given** successful execution, **When** any command completes, **Then**: exit code is 0
2. **Given** expected failure, **When** a gate fails or feature not found, **Then**: exit code is 1
3. **Given** bad arguments, **When** usage is wrong, **Then**: exit code is 2
4. **Given** unknown command, **When** `gwrk foo` is run, **Then**: exit code is 127

---

## 3. Roles, Scopes & Permissions

_Leverages shared RBAC. No feature-specific roles. See RP-000._

No external service credentials required. All operations are local filesystem + git.

---

## 4. Functional Requirements

### Signal & Output

- **FR-001**: System MUST emit `[exit:<code> | <duration>]` on stderr for every command invocation. Format: `[exit:0 | 42ms]` for success, `[exit:1 | 3.2s] <command>: <message>` for failure. Duration measured via `performance.now()`. MUST NOT appear on stdout. (Implements: US-001)
- **FR-002**: System MUST provide a `--format json` global flag. When set, commands that produce queryable output MUST emit structured JSON to stdout. `--format json` and `--agent` are independent flags that compose when used together. `--format json` is documented in `--help` and discoverable by agents the same way humans discover it. (Implements: US-002)
- **FR-003**: System MUST provide a `--agent` flag (or `GWRK_AGENT=1` env) that activates Layer 2 protections: ANSI stripping, binary guard (replace output containing null bytes or >30% non-printable chars with `[binary content, <N> bytes]`), overflow truncation (>8KB → first 100 lines + file reference). `--agent` does NOT change the output format — it is protective only. (Implements: US-003)

### Discovery

- **FR-004**: System MUST provide `gwrk project discover` that returns project state assembled exclusively from the repository contents (git, `specs/`, `.gwrk/tasks.json`, `gates/`, `.gwrkrc.json`). This command MUST NOT require build server access or SQLite access. It MUST work in any environment with a git clone. (Implements: US-004)
- **FR-005**: System MUST provide `gwrk project specs` (spec inventory with status) and `gwrk project gates` (aggregate gate results). Both MUST support `--format json`. Both MUST derive data from the repository only, not from SQLite. (Implements: US-004, US-005)

### Verification

- **FR-006**: System MUST provide `gwrk gate-check <task_id>` that resolves the gate script path (`specs/<feature>/gates/<taskId>-gate.sh`), executes it, captures exit code + stdout + stderr, and returns a structured result. Supports `--format json`. On gate script not found, error message MUST suggest `gwrk project gates`. (Implements: US-006)

### Error Guidance

- **FR-007**: Every error message MUST include a corrective suggestion: the command to run instead, and a `--help` reference for more information. Pattern: `<what failed>. Run '<fix command>' to <resolution>. See '<related> --help'.` (Implements: US-007)
- **FR-008**: Every `--help` output MUST include: command type (query/generator/verifier/mutator), exit codes, and available format options. Mutator commands MUST declare what they modify. (Implements: US-008)

### Standards

- **FR-009**: Exit codes MUST be standardized: 0 (success), 1 (expected failure), 2 (usage error), 127 (unknown command). All existing commands MUST be audited and corrected. (Implements: US-009)

#### FR-001 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Command throws unhandled error | `[exit:1 \| Xs] <command>: <error message>` | 1 |
| Command succeeds | `[exit:0 \| Xs]` | 0 |

#### FR-002 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| `--format json` on non-queryable command | No error — command runs normally | 0 |
| Invalid format value (`--format xml`) | `Unknown format: xml. Supported: human, json` | 2 |

#### FR-003 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Overflow file write fails (/tmp full) | `Warning: could not write overflow to /tmp, output truncated without file reference` | 0 (non-fatal) |

#### FR-004 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Not in a gwrk project (no `.gwrkrc.json`) | `Not a gwrk project. Run 'gwrk init' to add gwrk to this project.` | 1 |
| Git not available | `git not found in PATH. gwrk requires git.` | 1 |
| No specs directory | Discovery succeeds with empty `specs: []` | 0 |

#### FR-006 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Gate script not found | `Gate script not found: ... Run 'gwrk project gates' to list available gates.` | 1 |
| Gate script fails (non-zero exit) | Gate result FAIL with captured output | 1 |
| Feature not specified and not inferrable | `Feature required. Run 'gwrk project specs' to list features.` | 2 |

---

## 5. Data Model Requirements

### DM-001: Project Discovery Schema

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

> **Critical Constraint**: All fields in `ProjectDiscovery` MUST be derivable from the repository clone. No field may require SQLite or build server access. This ensures `gwrk project discover` works in all three environments: local CLI, local agent sandbox, and Codex Cloud VM.

### DM-002: Gate Check Result

```typescript
interface GateCheckResult {
  taskId: string;           // e.g., "T001"
  feature: string;          // e.g., "000-tdd-infrastructure"
  gatePath: string;         // Relative path to gate script
  result: 'PASS' | 'FAIL';
  exitCode: number;         // Gate script exit code
  stdout: string;           // Captured stdout
  stderr: string;           // Captured stderr
  durationMs: number;       // Execution time
}
```

### DM-003: Command Metadata (for --help enrichment)

```typescript
interface CommandMeta {
  type: 'query' | 'generator' | 'verifier' | 'mutator';
  exitCodes: Record<number, string>;
  formats: ('human' | 'json')[];
  mutations?: string[];     // What this command writes to (e.g., ".gwrk/tasks.json")
}
```

Stored as static objects co-located with command definitions. Not persisted to any database.

---

## 6. Technical Constraints

- **TC-001**: Air-Gapped by Default — No external network calls. No CDN. No telemetry. All operations are local filesystem + git.
- **TC-002**: Fail-Fast Config — Missing `.gwrkrc.json` when required → fail immediately with corrective message. No graceful defaults.
- **TC-003**: TypeScript Only — No `.js` or `.jsx` in `src/`. ESM modules, ES2022 target.
- **TC-004**: Repository-Only Discovery — `gwrk project discover`, `gwrk project specs`, and `gwrk project gates` MUST NOT read from `~/.gwrk/gwrk.db` or call `localhost:18790`. They derive all data from the repository. Commands that DO require server/DB access (`gwrk db runs`, `gwrk measure compression`) MUST fail fast with `Build server not reachable. This command requires a running server (gwrk server start).` if server is unavailable.
- **TC-005**: stderr Covenant — `[exit:N | Xs]` MUST be the LAST line written to stderr by any command. No output after the signal. This makes it parseable by simple `tail -1` on stderr.
- **TC-006**: No Format Coupling — `--agent` and `--format json` are independent. `--agent` does NOT imply `--format json`. Text is the LLM's native format; JSON is opt-in via discoverable flag.
- **TC-007**: Pipe Safety — `[exit:N | Xs]` goes to stderr only. Pipes (`|`) carry stdout only. Layer 2 post-processing applies to stdout only. No cross-contamination.
- **TC-008**: Commander.js — Global flags (`--format`, `--agent`) registered on the program root. Per-command flags registered on individual commands. `withSignal()` HOF wraps all `.action()` callbacks.

---

## 7. Testing Requirements

- **TR-001**: `src/utils/signal.test.ts` — Unit test `withSignal()`: verify `[exit:0 | Nms]` on success, `[exit:1 | Ns] command: message` on error, duration formatting (<1s → ms, ≥1s → N.Ns), stderr-only output. Vitest. (FR-001)
- **TR-002**: `src/utils/output.test.ts` — Unit test `CommandOutput`: verify human mode writes text to stdout, json mode writes JSON to stdout, info() always writes to stderr. Vitest. (FR-002)
- **TR-003**: `src/utils/agent-layer.test.ts` — Unit test Layer 2: `stripAnsi()` removes escape codes, `guardBinary()` replaces binary content, `truncateOverflow()` truncates at limit and writes file reference. Vitest. (FR-003)
- **TR-004**: `src/engine/discover.test.ts` — Unit test discovery engine: mock filesystem with specs/tasks/gates, verify `ProjectDiscovery` schema matches expected output. Verify NO sqlite or http calls made. Vitest. (FR-004, TC-004)
- **TR-005**: `src/commands/gate-check.test.ts` — Unit test gate-check: mock gate script execution, verify PASS/FAIL result, JSON output, error-as-navigation on missing script. Vitest. (FR-006)
- **TR-006**: `src/commands/project.test.ts` — Unit test project commands: discover, specs, gates subcommands. Verify `--format json` produces valid JSON. Vitest. (FR-004, FR-005)
- **TR-007**: Exit code audit — Shell test: run each command with invalid args and verify exit 2, unknown command and verify exit 127, expected failure and verify exit 1. (FR-009)
- **TR-008**: Error navigation audit — Shell test: trigger each documented error state, verify stderr contains `Run '` (corrective suggestion). (FR-007)

---

## 8. Success Criteria

- **SC-001**: Every gwrk command emits `[exit:N | Xs]` on stderr. Human terminal experience unchanged.
- **SC-002**: `gwrk project discover --format json | jq .project.name` returns project name in any gwrk project.
- **SC-003**: `gwrk project discover` works in a bare git clone with no build server (Codex Cloud scenario).
- **SC-004**: `gwrk gate-check T001 --format json | jq .result` returns PASS or FAIL.
- **SC-005**: `GWRK_AGENT=1 gwrk status | cat -v` contains zero ANSI escape sequences.
- **SC-006**: Every error message in the codebase contains a corrective `Run '...'` suggestion.
- **SC-007**: Every `--help` includes command type, exit codes, and format options.
- **SC-008**: All exit codes across all commands are standardized per FR-009.

---

## 9. Verification Requirements

- **VR-001**: E2E: `gwrk status 2>&1 >/dev/null | grep '\[exit:0'` exits 0.
- **VR-002**: E2E: `gwrk project discover --format json | jq .` exits 0 with valid JSON.
- **VR-003**: Negative: `gwrk project discover` in a non-gwrk directory → exit 1 with `Run 'gwrk init'`.
- **VR-004**: E2E: `gwrk gate-check T001 -f specs/000-tdd-infrastructure --format json | jq .result` returns string.
- **VR-005**: E2E: `GWRK_AGENT=1 gwrk project discover | head -500 | wc -c` returns ≤ 8192 (overflow guard).
- **VR-006**: E2E: Pipe safety: `gwrk project discover 2>/dev/null | wc -l` has no `[exit:` in stdout.
- **VR-007**: Isolation: `gwrk project discover` in a directory with specs but no server running → succeeds (TC-004).
- **VR-008**: Unit: `pnpm test` passes all TR-001 through TR-008.

---

## 10. Coverage Matrix

| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|-------------|
| US-001 | FR-001 | FR-001 | US-001 | TR-001 |
| US-002 | FR-002 | FR-002 | US-002 | TR-002 |
| US-003 | FR-003 | FR-003 | US-003 | TR-003 |
| US-004 | FR-004, FR-005 | FR-004 | US-004 | TR-004, TR-006 |
| US-005 | FR-005 | FR-005 | US-005 | TR-006 |
| US-006 | FR-006 | FR-006 | US-006 | TR-005 |
| US-007 | FR-007 | FR-007 | US-007 | TR-008 |
| US-008 | FR-008 | FR-008 | US-008 | TR-008 |
| US-009 | FR-009 | FR-009 | US-009 | TR-007 |
