# Phase Context

## Agent Persona

No persona specified.

## Governance Rules

### api-architecture.md

# API Architecture Governance

**Version**: 1.0  
**Status**: Active  
**Scope**: Project-agnostic principles

---

## Purpose

Establishes non-negotiable architectural standards for API design. These principles apply to any REST API project and prevent architectural drift.

**Project-Specific Reference**: See `route-reference.md` for this project's bounded contexts and route structure.

---

## Core Principles

### P1: Domain-Driven Boundaries

Routes MUST respect bounded context boundaries from Domain-Driven Design.

**Guidelines**:
- One API namespace per bounded context
- Aggregates root resources within their owning domain
- Cross-domain operations use explicit integration contracts
- Resources never span multiple domains

**See**: Route Reference for this project's domain map

---

### P2: Single Source of Truth

Each resource SHALL have **exactly one route handler file** owning all its operations.

**Enforcement**:
- Before creating new routes: `grep -r "resource_name" apps/api/src/routes`
- Check project route registry
- If resource handler exists → extend it
- If not → create and register

---

### P3: Resource-Oriented Design (RESTful)

Routes MUST be organized by **resource**, not by feature or journey.

**Correct**:
```
/api/{domain}/{resource}/:id/{sub-resource}
```

**Incorrect**:
```
/api/feature-name/action      # Feature-oriented
/api/journey-c/resource       # Journey-oriented
/api/do-something             # Action-oriented
```

---

### P4: File Size and Responsibility

Route files SHOULD be focused and maintainable.

**Guidelines**:
- Single responsibility per file
- Split files > 400 lines into focused handlers
- Group by operation type if splitting:
  - `resource.ts` → CRUD
  - `resource-operations.ts` → domain-specific actions

---

### P5: Response Schema Enforcement

**MANDATORY**: Every route MUST define Zod response schemas.

```typescript
{
    schema: {
        response: {
            200: ResourceContractSchema,
            404: ErrorResponseSchema,
            400: ErrorResponseSchema,
        }
    }
}
```

**Rationale**: Prevents serialization errors at runtime.

---

### P6: Consistent Error Responses

All error responses MUST follow a standard envelope:

```typescript
{
    error: string;          // Human-readable message
    code?: string;          // Machine-readable code (e.g., "NOT_FOUND")
    details?: unknown;      // Structured error details
}
```

---

## Architectural Review Gates

### Gate 1: Pre-Implementation (Spec Phase)

Before writing route code:
1. Search existing routes for duplicates
2. Check route registry
3. Verify resource belongs to intended domain
4. Document in spec/plan

**Blocker**: Duplicate handler → REJECT spec

### Gate 2: Code Review

Principal Engineer verifies:
1. [ ] Route follows domain boundaries (P1)
2. [ ] No duplicate handlers exist (P2)
3. [ ] RESTful conventions followed (P3)
4. [ ] File is focused (<400 lines) (P4)
5. [ ] Response schemas defined (P5)
6. [ ] Error format consistent (P6)
7. [ ] Tests exist

**Blocker**: Missing any item → REJECT PR

---

## Testing Standards

### Route Test Coverage

Every route file MUST have corresponding test:

**Route**: `routes/{resource}.ts`  
**Test**: `test/routes/{resource}.test.ts`

**Minimum Coverage**:
- Success cases (200/201/204)
- Not found (404)
- Validation errors (400)
- Authorization (401/403)

---

## Anti-Patterns

| Anti-Pattern | Why It's Wrong | Correct Approach |
|--------------|----------------|------------------|
| Scattered handlers | Violates P2 | Consolidate into single file |
| Feature namespaces | Violates P3 | Use resource namespaces |
| Missing schemas | Runtime errors | Define all response schemas |
| 800+ line files | Unmaintainable | Split by responsibility |
| Cross-domain routes | Violates P1 | Explicit integration |

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-14 | Initial principles-based version |


### coding-style.md

# Coding Style Guide

## Architecture Reference
See `docs/architecture.md` §8 for full coding standards with enforcement rules.

## General Principles
- **Strict TypeScript**: No `any`. Use correct types.
- **Functional Components**: Use React 19 Functional Components with Hooks.
- **Tailwind CSS v4.2**: Utility-first styling for all UI components.
- **Schema Validation**: Zod for all schemas (config, API contracts, domain types).

## TypeScript Linting & Hygiene (STRICT)
- **Tool**: Biome (extending `@gabbezeira/biome-airbnb`) for lint + format.
- **Resolution Over Suppression**: Fix the code, don't suppress the error.
- **ABSOLUTELY NO `any`**: The `any` type is strictly forbidden. Use `unknown` with Type Guards or Zod schema validation for untyped data. 
    - ❌ BAD: `// biome-ignore lint/suspicious/noExplicitAny: <reason>` is NOT allowed.
    - ❌ BAD: `@ts-ignore` is NOT allowed.
- **Audit Trails**: No "todo" or "fixme" without a tracking issue.
- **No Artifact Commits**: NEVER commit temporary files to the repository.

## Rust Linting & Hygiene (STRICT)
- **`cargo clippy`**: `--deny warnings` — zero warnings in CI.
- **`cargo fmt`**: `--check` — must be formatted.
- **`cargo test`**: All tests must pass.
- **No `unsafe`**: Without an adjacent comment justifying the block.
- **`#[must_use]`**: On all public functions returning values.

## Configuration
- **No Magic Values**: Never use hardcoded strings or numbers for config.
- **No Defaults**: No `|| 3000`. Missing env var = crash at boot.
- **Fail Fast**: `@codered/config` validates all required config at startup via Zod (no `.default()` calls).

## Monorepo
- **Packages**: Logic shared between apps goes in `packages/`.
- **Apps**: Application-specific code goes in `apps/`.
- **Crates**: Rust compute kernel in `crates/engine/`.
- **Dependencies**: Use `pnpm` workspace protocol for internal TS dependencies. Use Cargo workspace for Rust dependencies.

## Testing
- **Unit Tests (TS)**: Vitest (`pnpm test`).
- **Unit Tests (Rust)**: `cargo test` (`make test-engine`).
- **E2E**: Playwright for user-facing flows (`pnpm test:e2e`).
- **Golden-Hash**: Engine determinism verified via SHA256 fixture assertions in CI.

## Database
- **SQLite**: Local-first via `better-sqlite3`. WAL mode for crash safety.
- **No ORM**: Direct SQL queries in `packages/core/index/`.
- **Migrations**: Schema versioning managed in `packages/database/`.
- **Audit Trail**: Append-only `audit_events` table. No UPDATE, no DELETE.

## File Extensions
- **TypeScript Only**: All source files in `apps/*/src/` and `packages/*/src/` MUST be `.ts` or `.tsx`.
- **Rust Only**: All source files in `crates/*/src/` MUST be `.rs`.
- **No Transpiled JS**: NEVER create or commit `.js` or `.jsx` in `src/`.


### observability-governance.md

# Observability Governance

**Version**: 2.0  
**Status**: Active  
**Scope**: Local-Only Debug Interface & Support Instrumentation

---

## Purpose

CodeRed is **air-gapped by default**. Observability is a **debug and support instrument**, not a monitoring pipe. There is no "phone home."

---

## Core Principles

### O1: Local-Only Storage
All logs and metrics are stored locally in `%APPDATA%/CodeRed/logs` (Windows) or `~/Library/Application Support/CodeRed/logs` (macOS). NEVER transmit to external endpoints.

### O2: Domain-Aligned Naming
Metrics follow `{domain}_{entity}_{action}_{suffix}` convention:

| Domain | Metrics | Purpose |
|---|---|---|
| `engine` | `engine_parse_duration_ms`, `engine_diff_duration_ms` | Performance bottleneck identification |
| `pipeline` | `pipeline_stage_state`, `pipeline_files_processed_total` | Stage completion visualization |
| `audit` | `audit_events_total`, `audit_log_size_bytes` | Audit trail health monitoring |

### O3: Structured Logging
All logs are structured JSON with required fields:

```typescript
{
    level: 'info' | 'warn' | 'error',
    operation: string,
    domain: 'engine' | 'pipeline' | 'audit' | 'export',
    timestamp: string,  // ISO 8601
    ...contextFields
}
```

### O4: Support Bundle
`make support-bundle` (or `bd support-bundle`) generates a sanitized export:
- Aggregates logs and SQLite metadata.
- **Strips** source code filenames and content (keeps AST structure hashes only).
- Outputs `support-evidence.zip` for manual upload to a support ticket.

### O5: Internal Debug Dashboard
Hidden view activated by `Ctrl+Alt+D` (desktop only):
- Engine heartbeat and latency.
- Local CPU/RAM pressure.
- Pipeline queue depth and stage progress.
- Not visible to end users by default.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 2.0 | 2026-02-21 | Rewritten for CodeRed air-gapped model. Removed Prometheus/Grafana. |
| 1.0 | — | Initial GForge version (deprecated for CodeRed) |


### operating-model.md

# Operating Model: Foxtrot Charlie

> **Mantra**: Truth → Clarity → Throughput → Value

This repository operates under the **Foxtrot Charlie** model. This is not a suggestion; it is the execution standard.

## 1. The Four Pillars (Machinery)
All work must be categorized into one of these stages:

1.  **Discovery (Truth)**: Extracting insights. Output: Raw Signal.
2.  **Definition (Clarity)**: Making commitments. Output: `spec.md`, `requirements.md`.
3.  **Shipping (Throughput)**: Building & Learning. Output: Shipped Code (PRs).
4.  **Delivery (Value)**: Realizing outcomes. Output: Adoption Metrics.

## 2. RAGB (Reality at a Glance)
You must enforce these states. Do not accept ambiguous status updates.

*   🔴 **RED**: At risk of not shipping. (Stop and fix).
*   🟡 **AMBER**: Standard operating risk. (Proceed with management).
*   🟢 **GREEN**: **DONE DONE.** Shipped, verified, and in the hands of the customer. Terminal state.
*   ⚫ **BLACK**: Not doing / Stopped.

## 3. Command & Control
*   **Decide Fast**: If a path is blocked, propose a solution or escalate immediately. Do not "wait for consensus."
*   **Argue Well**: If a user request violates a Schema or Architecture principle, **object**. Use the "Bad Cop" persona.
*   **Enforce Clarity**: Reject vague specs. Reject "happy path" logic. Demand edge cases.
*   **Report Authority**: No agent shall edit a report (`code_review.md`, `uat_report.md`) unless they are currently assuming the specific persona (Principal Engineer or Product Manager) authorized to write that report.

## 4. Anti-Ceremony
*   If a process step does not create Truth, Clarity, Throughput, or Value -> **Skip it**.
*   Tools don't matter. Outcomes matter.
*   **Velocity** is the first derivative of Clarity.

## 5. Artifact Standards
*   **Specs**: Must exist before code. Must define Observability.
*   **Requirements**: Replace "Plans". A `requirements.md` is a contract. 100% of items must be checked off ([x]) before a PR can be merged.
*   **Verification**: "It runs on my machine" is unacceptable. You must verify in the target environment.

## 6. Test Accountability Invariant
*   The agent that writes code MUST NOT be the sole judge of whether its verification is adequate.
*   All verification gates MUST exist as committed artifacts BEFORE implementation begins.
*   `/review-code` verdicts MUST be based on pre-committed gate results, not agent self-reports.
*   Gate files (`gates/*.sh`) are contracts — the implementing agent MUST NOT edit or delete them.


### route-reference.md

# Route Reference: CodeRed

**Last Updated**: 2026-02-21  
**Governance**: See [api-architecture.md](file://./api-architecture.md)  
**Architecture**: See [docs/architecture.md](file:///Users/gonzo/Code/code-red/docs/architecture.md) §4

---

## Domain Map

CodeRed's API serves two contexts: the **Tauri desktop** (via in-process Rust commands) and the **Fastify web server** (via HTTP).

### Bounded Contexts

| Context | Namespace | Purpose |
|---|---|---|
| **Comparisons** | `/api/comparisons` | CRUD for comparison runs |
| **Exhibits** | `/api/exhibits` | Export and retrieval of Exhibit A/B/C artifacts |
| **Audit** | `/api/audit` | Read-only access to the investigation audit trail |
| **Engine** | `/api/engine` | Engine health, grammar listing, settings |

---

## Target Route Structure

### Comparisons Domain (`/api/comparisons/`)

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/comparisons` | Create new comparison run |
| `GET` | `/api/comparisons/:id` | Get comparison status/results |
| `GET` | `/api/comparisons/:id/manifest` | Get file manifest (hashes, sizes) |
| `GET` | `/api/comparisons/:id/matches` | Get match results |
| `GET` | `/api/comparisons/:id/diffs/:fileId` | Get diff for specific file pair |

### Exhibits Domain (`/api/exhibits/`)

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/exhibits/:comparisonId/generate` | Generate exhibit pack |
| `GET` | `/api/exhibits/:id` | Download exhibit (PDF/ZIP) |
| `GET` | `/api/exhibits/:id/manifest` | Get exhibit reproducibility manifest |

### Audit Domain (`/api/audit/`)

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/audit/events` | List audit events (filterable) |
| `GET` | `/api/audit/events/:id` | Get single audit event |

### Engine Domain (`/api/engine/`)

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/engine/health` | Engine heartbeat |
| `GET` | `/api/engine/grammars` | List supported Tree-sitter grammars |
| `GET` | `/api/engine/settings` | Get current engine settings |

---

## Registry

| Resource | Prefix | Owner File | Status |
|----------|--------|------------|--------|
| Comparison | `/api/comparisons` | `apps/web/src/routes/comparisons.ts` | Planned |
| Exhibit | `/api/exhibits` | `apps/web/src/routes/exhibits.ts` | Planned |
| Audit | `/api/audit` | `apps/web/src/routes/audit.ts` | Planned |
| Engine | `/api/engine` | `apps/web/src/routes/engine.ts` | Planned |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-02-21 | Initial CodeRed route reference created |


### seeding-governance.md

# Seeding Governance

## Architecture Reference
See `docs/architecture.md` §9 for the Golden-Hash Testing strategy.

## Source of Truth

The **Golden-Hash Fixture Corpus** is the source of truth for test data.
- **Location**: `fixtures/` (repo root)
- **Format**: Synthetic code file pairs with expected diff output hashes.
- **Prohibited**: Do NOT use real case files. All test data must be synthetic.

## Fixture Structure

```
fixtures/
├── java-pair-001/
│   ├── source/          # Known "original" Java files
│   ├── target/          # Known "copied/modified" Java files
│   ├── settings.json    # Engine settings for this comparison
│   └── expected.json    # Expected SHA256 of diff output
├── typescript-pair-001/
│   ├── source/
│   ├── target/
│   ├── settings.json
│   └── expected.json
└── README.md            # Corpus documentation
```

## Workflow

To update the fixture corpus:
1. **Create synthetic files**: Write code pairs that demonstrate specific patterns (copy, move, rename, modify).
2. **Run engine**: `@codered/engine` processes the pair with defined settings.
3. **Capture hash**: Record `SHA256(output)` in `expected.json`.
4. **Commit**: Commit the fixture and expected hash.

## Determinism Contract

Every CI run asserts:
```
SHA256(engine.compare(source, target, settings)) == expected.json.hash
```

If this assertion fails, the PR is **automatically rejected**. The engine is non-deterministic.

## Idempotency

Fixture processing MUST be idempotent. Same input + same settings = same output hash. Always.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 2.0 | 2026-02-21 | Rewritten for CodeRed golden-hash fixture model. |
| 1.0 | — | Initial GForge version (deprecated for CodeRed) |


### workspace.md

---
trigger: always_on
---

# Workspace Rules

## Architecture Reference
See `docs/architecture.md` for the authoritative CodeRed architecture specification.
**Stack**: Tauri v2 (Desktop) + React 19 + Tailwind v4.2 + Fastify (Web) + Rust Engine (napi-rs v3) + SQLite (better-sqlite3).

## NEVER EVER
- NEVER use magic values. All needed values flow `.env` → `docker-compose.*` → applications and services.
- NEVER use "graceful defaults" in code (e.g., `process.env.PORT || 3000`). If a config is missing, the app MUST crash immediately (Fail Fast).
- NEVER use one-off commands for fixing things. Code, configs, makefile — work somewhere repeatable.
- NEVER phone home. CodeRed is air-gapped by default. No runtime CDN fetches, no telemetry, no analytics.
- **Creds Access**: Never hallucinate credentials. Use `cat .env` (ignored by git but accessible via shell) or refer to `.env.example` for standard values.

## Operating Model
See `.agent/rules/operating-model.md` for Foxtrot Charlie principles and RAGB definitions.
See `.agent/rules/seeding-governance.md` for fixture and test corpus rules.

## Specification Workflow
- **Spec-First**: No implementation proceeds without an approved `spec.md` and `plan.md`.
- **Checklist Gating**: Implementation is BLOCKED until all checklists in `FEATURE_DIR/checklists/` pass.
- **Tasks (tasks.json)**: Execution state is tracked via `.gwrk/tasks.json`. Markdown task lists are the static design; `tasks.json` is the dynamic source of truth.
- **RAGB Governance**:
    - 🔴 RED: At risk. Stop and flag.
    - 🟡 AMBER: In progress. Standard operating risk.
    - 🟢 GREEN: Done done. Only PM can set after UAT pass.
    - ⚫ BLACK: Stopped/cancelled.

## Directory Structure
- `apps/desktop/`: Tauri v2 desktop shell.
- `apps/web/`: Fastify dev/test web server (future Matter Portal).
- `crates/engine/`: Rust forensic compute kernel (@codered/engine).
- `packages/config/`: 12-Factor fail-fast config validation (Zod).
- `packages/core/`: Pipeline orchestration, SQLite index, audit trail.
- `packages/domain/`: Shared TypeScript types and Zod schemas.
- `packages/ui/`: React component library (Exhibit A/B workspace).
- `specs/`: Feature specifications (Foxtrot Charlie).
- `.agent/`: Governance (rules, workflows, personas, scripts).
- `.specify/`: Specify CLI (scripts, templates).

## Commands
- **Start Dev**: `make up` (Runs EVERYTHING in Docker, including apps).
    - *Use Case*: **All Local Development**. Local one-off commands (`pnpm dev`, `cargo run` on host) are STRICTLY FORBIDDEN. Docker Compose mount points provide HMR.
- **Start Prod**: `make prod` (Runs everything with production config).
- **Engine**:
    - Build: `make engine` (compiles Rust crate).
    - Test: `make test-engine` (runs `cargo test`).
    - Cross-compile: `make build-windows` (napi-rs prebuild for Windows).
- **Database**: SQLite (embedded, local file). No external DB service.

## Development Standard
- "It works on my machine" is NOT a valid verification. EVERYTHING must run and be tested inside the Docker container via `make up`.

## Docker Strategy (Override Sandwich — I-008)
- `docker-compose.yml`: Neutral base (containers only, `target: runner`).
- `docker-compose.override.yml`: Dev logic (bind-mounts, HMR, `target: dev`).
- `docker-compose.production.yml`: Prod logic (sealed images, no source mounts).
- Use `Makefile` for all infrastructure operations.

## Safe Shell Inputs
- **Avoid complex inline quoting**: When using CLI tools (like `gh`, `aws`) that accept long text blobs, DO NOT try to escape quotes inline.
- **Preferred Method**: Use Heredoc (`<<EOF`) if the tool supports stdin. This is the ideal approach.
- **Fallback Method**: If using a file, write content to a temporary file in `/tmp/`. NEVER write temporary files to the repository root. We don't shit in our own yard; `/tmp/` exists for a reason.

## Source File Hygiene
- NEVER create `.js` or `.jsx` files in `src/` directories. TypeScript (`.ts`/`.tsx`) is the source of truth.
- NEVER create `.rs.bk` or other Rust backup files in `crates/`.


## Feature Specification

# Feature Specification: 002 Build Server

**Feature Branch**: `002-build-server`
**Created**: 2026-02-27
**Status**: Draft
**Input**: Local persistent Fastify daemon that serves as the control plane — dispatch queue, Docker sandbox manager, Git branch lifecycle, system resource monitoring, and `gwrk server start/stop/status` commands.

---

## 2. User Scenarios & Testing

### US-001 - Start Build Server (Priority: P0)
As a Principal Engineer, I want to run `gwrk server start` so that a persistent Fastify daemon starts on `localhost:18790` and is ready to accept dispatch requests and manage Docker sandboxes.

**Implements**: FR-001, FR-002

**Independent Test**: Run `gwrk server start` and verify the daemon responds to HTTP.

**Acceptance Scenarios**:
1. **Given** no daemon is running, **When** the user runs `gwrk server start`, **Then**:
   - `curl -s -o /dev/null -w '%{http_code}' http://localhost:18790/health` exits 0 and outputs `200`
   - `gwrk server start 2>&1 | grep -q 'gwrk server listening on'` exits 0
2. **Given** the daemon is already running, **When** the user runs `gwrk server start`, **Then**:
   - Command exits with code 1
   - `gwrk server start 2>&1 | grep -q 'Server already running'` exits 0

### US-002 - Stop Build Server (Priority: P0)
As a Principal Engineer, I want to run `gwrk server stop` so that the daemon shuts down gracefully, terminating any active sandboxes and releasing the port.

**Implements**: FR-003

**Independent Test**: Start the server, then stop it, verify the port is released.

**Acceptance Scenarios**:
1. **Given** the daemon is running, **When** the user runs `gwrk server stop`, **Then**:
   - Command exits with code 0
   - `curl -s http://localhost:18790/health 2>&1 | grep -qE 'Connection refused|Failed to connect'` exits 0
2. **Given** no daemon is running, **When** the user runs `gwrk server stop`, **Then**:
   - Command exits with code 1
   - `gwrk server stop 2>&1 | grep -q 'No server running'` exits 0

### US-003 - System Status (Priority: P0)
As a Principal Engineer, I want to run `gwrk status` so that I see active agents, active sandboxes, dispatch queue depth, and system resource usage (CPU, memory, disk).

**Implements**: FR-004

**Independent Test**: Start the server, run `gwrk status`, verify JSON output includes resource metrics.

**Acceptance Scenarios**:
1. **Given** the daemon is running, **When** the user runs `gwrk status --json`, **Then**:
   - `gwrk status --json | jq -r '.server.status'` outputs `running`
   - `gwrk status --json | jq -e '.system.cpuPercent'` exits 0
   - `gwrk status --json | jq -e '.system.memPercent'` exits 0
   - `gwrk status --json | jq -e '.system.diskFreeGb'` exits 0
   - `gwrk status --json | jq -e '.dispatch.queueDepth'` exits 0
   - `gwrk status --json | jq -e '.sandboxes'` exits 0
2. **Given** no daemon is running, **When** the user runs `gwrk status`, **Then**:
   - `gwrk status --json | jq -r '.server.status'` outputs `stopped`

### US-004 - Dispatch Phase to Sandbox (Priority: P0)
As Agent-ZFG, I want the build server to accept a phase dispatch request so that a Docker sandbox is created, the phase branch is mounted, the agent context is injected, and the WUD loop executes inside the container.

**Implements**: FR-005, FR-006, FR-007

**Independent Test**: POST a dispatch request and verify a Docker container is created with the correct branch mounted.

**Acceptance Scenarios**:
1. **Given** the daemon is running and Docker is available, **When** a dispatch request is sent via `curl -X POST http://localhost:18790/api/dispatch -H 'Content-Type: application/json' -d '{"featureId":"001-cli-core","phaseId":"phase-01","backend":"gemini"}'`, **Then**:
   - `curl -s http://localhost:18790/api/dispatch/001-cli-core/phase-01 | jq -r '.status'` outputs one of `queued`, `running`, `completed`, `failed`
   - `docker ps --filter label=gwrk.feature=001-cli-core --filter label=gwrk.phase=phase-01 --format '{{.ID}}' | wc -l | grep -q '^1$'` exits 0 (while running)

### US-005 - Dispatch Queue with Retry (Priority: P0)
As the build server orchestrator, I want a dispatch queue that manages phase assignments, respects system resource limits, and retries failed dispatches up to 3 times with backend escalation.

**Implements**: FR-008, FR-009

**Independent Test**: Submit multiple dispatches exceeding resource limits and verify queuing behavior.

**Acceptance Scenarios**:
1. **Given** the daemon is running with `parallelism.local.maxClones` set to 2, **When** 3 dispatch requests are submitted, **Then**:
   - `curl -s http://localhost:18790/api/dispatch/queue | jq '.active | length'` outputs at most `2`
   - `curl -s http://localhost:18790/api/dispatch/queue | jq '.queued | length'` outputs at least `1`
2. **Given** a dispatch fails 3 times on the primary backend, **When** `fallbackOrder` is configured, **Then**:
   - `curl -s http://localhost:18790/api/dispatch/001-cli-core/phase-01 | jq -r '.attempts[-1].backend'` differs from `.attempts[0].backend`

### US-006 - Git Branch Lifecycle (Priority: P0)
As Agent-ZFG, I want the build server to manage Git branches for each dispatched phase — creating the phase branch from the feature branch, and supporting merge-back with conflict detection.

**Implements**: FR-010

**Independent Test**: Dispatch a phase and verify the correct branch is created from the feature branch.

**Acceptance Scenarios**:
1. **Given** a feature `001-cli-core` with a feature branch `feature/001-cli-core-wip`, **When** phase-01 is dispatched, **Then**:
   - `git branch --list 'phase/001-cli-core-phase-01' | grep -q 'phase/001-cli-core-phase-01'` exits 0
2. **Given** phase-01 is completed, **When** a merge-back is triggered, **Then**:
   - `git log feature/001-cli-core-wip --oneline -1 | grep -q 'Merge phase/001-cli-core-phase-01'` exits 0

### US-007 - Daemon PID Management (Priority: P0)
As the CLI, I want the daemon to write a PID file on start and remove it on stop, so that `gwrk server start/stop` can detect whether the daemon is already running.

**Implements**: FR-011

**Independent Test**: Start the server, verify PID file exists, stop the server, verify PID file is removed.

**Acceptance Scenarios**:
1. **Given** no daemon is running, **When** `gwrk server start` is executed, **Then**:
   - `test -f .gwrk/server.pid` exits 0
   - `kill -0 $(cat .gwrk/server.pid) 2>/dev/null` exits 0
2. **Given** the daemon is running, **When** `gwrk server stop` is executed, **Then**:
   - `test -f .gwrk/server.pid` exits 1

### US-008 - Sandbox Docker Image (Priority: P1)
As a Platform Engineer, I want the build server to use a standard `gwrk-sandbox:bookworm-slim` Docker image with Node.js, Git, and `gh` pre-installed, so that agent sandboxes have a consistent execution environment.

**Implements**: FR-012

**Independent Test**: Build the sandbox image and verify required tools are available inside the container.

**Acceptance Scenarios**:
1. **Given** the sandbox Dockerfile exists, **When** `docker build -t gwrk-sandbox:bookworm-slim -f Dockerfile.sandbox .` runs, **Then**:
   - `docker run --rm gwrk-sandbox:bookworm-slim node --version` exits 0
   - `docker run --rm gwrk-sandbox:bookworm-slim git --version` exits 0
   - `docker run --rm gwrk-sandbox:bookworm-slim gh --version` exits 0

### US-009 - Context Compilation (Priority: P0)
As the dispatch engine, I want the build server to compile agent context from `.agent/rules/`, persona files, spec, plan, and tasks into a single context payload injected into the sandbox at `/workspace/.gwrk/phase-context.md`.

**Implements**: FR-013

**Independent Test**: Dispatch a phase and verify the context file exists and contains expected sections.

**Acceptance Scenarios**:
1. **Given** a dispatch for feature `001-cli-core` phase-01, **When** the sandbox is created, **Then**:
   - `docker exec <container_id> test -f /workspace/.gwrk/phase-context.md` exits 0
   - `docker exec <container_id> grep -q 'Governance Rules' /workspace/.gwrk/phase-context.md` exits 0
   - `docker exec <container_id> grep -q 'spec.md' /workspace/.gwrk/phase-context.md` exits 0

### US-010 - Resource Throttling (Priority: P1)
As the build server, I want to monitor CPU, memory, and disk usage and pause queued dispatches when limits are exceeded, so that the developer's machine stays responsive.

**Implements**: FR-014

**Independent Test**: Simulate high CPU usage and verify dispatch queue pauses.

**Acceptance Scenarios**:
1. **Given** `parallelism.local.maxCpu` is set to 80 and current CPU usage exceeds 80%, **When** a new dispatch request arrives, **Then**:
   - `curl -s http://localhost:18790/api/dispatch/queue | jq '.throttled'` outputs `true`
2. **Given** `parallelism.local.minDiskGb` is set to 10 and free disk is below 10 GB, **When** a clone is requested, **Then**:
   - `curl -s http://localhost:18790/api/dispatch -X POST -d '{}' 2>&1 | grep -q 'Insufficient disk space'` exits 0

---

## 3. Roles, Scopes & Permissions

_Leverages shared RBAC. No feature-specific roles. See RP-000._

---

## 4. Functional Requirements

- **FR-001**: System MUST provide a `gwrk server start` command that starts a Fastify daemon on `localhost:18790`, writes a PID file to `.gwrk/server.pid`, and responds to `/health` with HTTP 200. (Implements: US-001)
- **FR-002**: The Fastify daemon MUST bind to `localhost:18790` (port configurable via `server.port` in `.gwrkrc.json`) and expose REST endpoints for dispatch, status, and queue management. (Implements: US-001)
- **FR-003**: System MUST provide a `gwrk server stop` command that sends SIGTERM to the daemon process (via PID file), waits for graceful shutdown (active sandboxes terminated), removes the PID file, and confirms the port is released. (Implements: US-002)
- **FR-004**: System MUST provide a `gwrk status` command that queries the daemon's `/api/status` endpoint and returns server state, active agents, sandbox count, dispatch queue depth, and system resources (CPU%, MEM%, disk free GB). When no daemon is running, it MUST return `{"server":{"status":"stopped"}}`. (Implements: US-003)
- **FR-005**: The daemon MUST expose `POST /api/dispatch` accepting `{featureId, phaseId, backend}` to create a sandbox, mount the phase branch, inject context, and start the agent's WUD loop. (Implements: US-004)
- **FR-006**: The daemon MUST manage Docker container lifecycle for each dispatched phase: create container from `gwrk-sandbox:bookworm-slim`, mount phase branch at `/workspace`, label with `gwrk.feature` and `gwrk.phase`, destroy on completion or failure. (Implements: US-004)
- **FR-007**: The dispatch engine MUST compile agent context into `/workspace/.gwrk/phase-context.md` containing: governance rules (`.agent/rules/*.md`), persona definition, feature spec, plan, current tasks, and phase-specific gate scripts. (Implements: US-009)
- **FR-008**: The daemon MUST implement a dispatch queue that respects `parallelism.local.maxClones` and `parallelism.cloud.maxConcurrent` from `.gwrkrc.json`. Dispatches exceeding limits MUST be queued and processed FIFO as slots become available. (Implements: US-005)
- **FR-009**: The dispatch engine MUST retry failed dispatches up to 3 times on the same backend, then escalate to the next backend in `agents.fallbackOrder`. All retry attempts MUST be recorded with timestamps, backend, exit code, and stderr. (Implements: US-005)
- **FR-010**: The daemon MUST manage Git branch lifecycle: create `phase/<feature>-<phase>` branches from `feature/<feature>-wip`, and support merge-back to the feature branch with conflict detection. On conflict, the merge MUST fail and the dispatch MUST be flagged for human intervention. (Implements: US-006)
- **FR-011**: The daemon MUST write its process ID to `.gwrk/server.pid` on startup and remove the file on clean shutdown. `gwrk server start` MUST check for an existing PID file and verify the process is alive before declaring a conflict. (Implements: US-007)
- **FR-012**: The project MUST include a `Dockerfile.sandbox` that builds `gwrk-sandbox:bookworm-slim` with Node.js (LTS), Git, `gh` CLI, and the configured agent CLIs (gemini, claude, codex) pre-installed. (Implements: US-008)
- **FR-013**: The dispatch engine MUST compile agent context by reading `.agent/rules/*.md`, the persona file for the dispatch target, `specs/<feature>/spec.md`, `specs/<feature>/plan.md`, and `specs/<feature>/.gwrk/tasks.json`, concatenating them into a single Markdown document at `/workspace/.gwrk/phase-context.md`. (Implements: US-009)
- **FR-014**: The daemon MUST monitor system resources (CPU, memory, disk) at a configurable interval (default 10 seconds) and throttle queued dispatches when `parallelism.local.maxCpu`, `parallelism.local.maxMem`, or `parallelism.local.minDiskGb` thresholds are exceeded. (Implements: US-010)

#### FR-001 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Port already in use | `Port 18790 already in use` | 1 |
| Server already running (stale PID) | `Server already running (pid: <PID>)` | 1 |
| Docker not available | `Docker daemon not reachable` | 1 |

#### FR-003 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| No server running | `No server running` | 1 |
| PID file exists but process dead | Clean start allowed (stale PID removed) | 0 |

#### FR-005 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Invalid backend | `Unknown agent backend: <backend>` | 400 |
| Feature not found | `Feature <featureId> not found in specs/` | 404 |
| Docker not available | `Docker daemon not reachable` | 503 |
| Resource limits exceeded | `Dispatch queued: resource limits exceeded` | 202 |

#### FR-010 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Feature branch not found | `Branch feature/<feature>-wip not found` | 1 |
| Merge conflict | `Merge conflict in phase/<feature>-<phase>: <files>` | 1 |
| Dirty working tree | `Working tree has uncommitted changes` | 1 |

---

## 5. Data Model Requirements

### DM-001: Dispatch Record

Per-dispatch state recorded in the daemon's in-memory store and persisted to `.gwrk/dispatches.jsonl`:

```typescript
interface DispatchRecord {
  id: string;                    // UUID
  featureId: string;             // e.g. "001-cli-core"
  phaseId: string;               // e.g. "phase-01"
  backend: AgentBackend;         // "gemini" | "claude" | "codex" | "codex-cloud"
  status: DispatchStatus;        // "queued" | "running" | "completed" | "failed" | "retrying"
  containerId?: string;          // Docker container ID
  branchName: string;            // e.g. "phase/001-cli-core-phase-01"
  attempts: DispatchAttempt[];
  createdAt: string;             // ISO 8601
  completedAt?: string;          // ISO 8601
}

interface DispatchAttempt {
  attemptNumber: number;
  backend: AgentBackend;
  startedAt: string;             // ISO 8601
  completedAt?: string;          // ISO 8601
  exitCode?: number;
  stderr?: string;
}

type DispatchStatus = "queued" | "running" | "completed" | "failed" | "retrying";
```

### DM-002: Server Config Extension (`.gwrkrc.json`)

Extends the GwrkConfig defined in 001-cli-core DM-003:

```typescript
interface GwrkServerConfig {
  server: {
    port: number;                // Default: MUST be explicit, no default()
    host: string;                // Default: MUST be explicit, no default()
  };
  parallelism: {
    local: {
      maxClones: number;         // Max concurrent local repo clones
      maxCpu: number;            // CPU % threshold
      maxMem: number;            // Memory % threshold
      minDiskGb: number;         // Minimum free disk in GB
    };
    cloud: {
      maxConcurrent: number;     // Max concurrent cloud dispatches
    };
  };
}
```

### DM-003: System Status

```typescript
interface SystemStatus {
  server: {
    status: "running" | "stopped";
    pid?: number;
    uptime?: number;             // Seconds since start
    port?: number;
  };
  system: {
    cpuPercent: number;
    memPercent: number;
    diskFreeGb: number;
  };
  dispatch: {
    queueDepth: number;
    activeCount: number;
    completedCount: number;
    failedCount: number;
  };
  sandboxes: SandboxInfo[];
}

interface SandboxInfo {
  containerId: string;
  featureId: string;
  phaseId: string;
  backend: AgentBackend;
  status: "creating" | "running" | "stopping" | "destroyed";
  startedAt: string;
  cpuPercent?: number;
  memMb?: number;
}
```

---

## 6. Technical Constraints

- **TC-001**: Determinism — Dispatch IDs are UUIDs (crypto.randomUUID). Dispatch ordering is FIFO.
- **TC-002**: Air-Gapped — The daemon itself makes no external network calls. Agent backends inside sandboxes MAY access the network (for `gh` CLI, npm install, etc.) but the daemon does not.
- **TC-003**: Fail-Fast Config — Zod validation with no `.default()` calls. Missing `server.port` → `process.exit(1)`.
- **TC-004**: Localhost Only — The daemon MUST bind to `127.0.0.1` or `localhost`. No `0.0.0.0` binding. Remote access is handled by the Tunnel layer (Phase 11).
- **TC-005**: PID File Discipline — PID file at `.gwrk/server.pid`. Start checks for stale PIDs. Stop removes PID file after graceful shutdown.
- **TC-006**: Docker Label Convention — All gwrk sandboxes MUST be labeled with `gwrk.feature=<featureId>` and `gwrk.phase=<phaseId>` for lifecycle management.
- **TC-007**: Graceful Shutdown — On SIGTERM/SIGINT, the daemon MUST: stop accepting new dispatches, wait for running sandboxes to complete (with 30s timeout), destroy remaining containers, remove PID file, and exit.
- **TC-008**: No In-Process Agent Execution — Agents are ALWAYS invoked via Docker sandbox (`docker exec`) or `child_process.execFile`. Never import agent CLIs as libraries.

---

## 7. Testing Requirements

- **TR-001**: `src/commands/server.test.ts` — Verify `server start` creates PID file, binds to port, responds to `/health`. Verify `server stop` removes PID, releases port. Vitest. (FR-001, FR-003, FR-011)
- **TR-002**: `src/server/index.test.ts` — Verify Fastify bootstrap: `/health` returns 200, `/api/status` returns server info with system resources, `/api/dispatch` accepts POST. Vitest. (FR-002, FR-004)
- **TR-003**: `src/server/dispatch.test.ts` — Verify dispatch queue: FIFO ordering, `maxClones` throttling, retry logic (3× same backend then escalate), attempt recording. Mock Docker/Git operations. Vitest. (FR-008, FR-009)
- **TR-004**: `src/server/sandbox.test.ts` — Verify Docker container lifecycle: create with correct labels, mount phase branch at `/workspace`, destroy on completion. Mock `dockerode`. Vitest. (FR-006)
- **TR-005**: `src/server/git-manager.test.ts` — Verify branch creation from feature branch, merge-back with conflict detection, refuse on dirty working tree. Mock `child_process`. Vitest. (FR-010)
- **TR-006**: `src/server/context.test.ts` — Verify context compilation: reads rules, persona, spec, plan, tasks. Produces single Markdown file. Vitest. (FR-007, FR-013)
- **TR-007**: `src/server/monitor.test.ts` — Verify system resource monitoring: CPU, memory, disk. Verify throttle behavior when limits exceeded. Mock `os` module. Vitest. (FR-014)
- **TR-008**: Integration test — Start daemon in subprocess, POST dispatch, verify container created (requires Docker). Vitest integration suite. (FR-001, FR-005, FR-006)
- **TR-009**: `Dockerfile.sandbox` — Build sandbox image, verify `node`, `git`, `gh` are available. Shell test. (FR-012)

---

## 8. Success Criteria

- **SC-001**: `gwrk server start` launches a Fastify daemon that responds to `/health` within 2 seconds.
- **SC-002**: `gwrk server stop` gracefully shuts down the daemon, destroying all active sandboxes within 30 seconds.
- **SC-003**: A dispatch request creates a Docker sandbox with the correct branch mounted and agent context compiled.
- **SC-004**: The dispatch queue respects `parallelism.local.maxClones` — excess dispatches are queued, not rejected.
- **SC-005**: Failed dispatches are retried 3× then escalated to the next backend in `fallbackOrder`.

---

## 9. Verification Requirements

- **VR-001**: E2E lifecycle test: `gwrk server start` → `POST /api/dispatch` → verify Docker container running → verify phase branch created → verify context file in sandbox → container exits → verify dispatch record in `.gwrk/dispatches.jsonl` → `gwrk server stop` → verify port released.
- **VR-002**: Negative test: `gwrk server start` when port is already in use → verify error message and exit code 1.
- **VR-003**: Negative test: `gwrk server stop` when no server is running → verify error message and exit code 1.
- **VR-004**: Queue throttle test: Submit `maxClones + 1` dispatches → verify Nth+1 dispatch is queued → when one sandbox completes, verify queued dispatch starts.
- **VR-005**: Retry escalation test: Mock agent to fail 3× → verify dispatch attempt count is 4 → verify 4th attempt uses different backend from `.gwrkrc.json` `fallbackOrder`.

---

## 10. Coverage Matrix

| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|-------------|
| US-001 | FR-001, FR-002 | FR-001 | US-001 | TR-001, TR-002 |
| US-001 | FR-001, FR-002 | FR-002 | US-001 | TR-002 |
| US-002 | FR-003 | FR-003 | US-002 | TR-001 |
| US-003 | FR-004 | FR-004 | US-003 | TR-002 |
| US-004 | FR-005, FR-006, FR-007 | FR-005 | US-004 | TR-002, TR-008 |
| US-004 | FR-005, FR-006, FR-007 | FR-006 | US-004 | TR-004, TR-008 |
| US-004 | FR-005, FR-006, FR-007 | FR-007 | US-009 | TR-006 |
| US-005 | FR-008, FR-009 | FR-008 | US-005 | TR-003 |
| US-005 | FR-008, FR-009 | FR-009 | US-005 | TR-003 |
| US-006 | FR-010 | FR-010 | US-006 | TR-005 |
| US-007 | FR-011 | FR-011 | US-007 | TR-001 |
| US-008 | FR-012 | FR-012 | US-008 | TR-009 |
| US-009 | FR-013 | FR-013 | US-009 | TR-006 |
| US-010 | FR-014 | FR-014 | US-010 | TR-007 |


## Implementation Plan

# Implementation Plan: 002 Build Server

**Branch**: `002-build-server` | **Date**: 2026-02-27 | **Spec**: [spec.md](./spec.md)

## Summary

Build the gwrk Build Server — a persistent Fastify daemon on `localhost:18790` that serves as the control plane for multi-agent dispatch. The plan is structured in 5 phases:

1. **Daemon Bootstrap** — Fastify server, health endpoint, PID management, `gwrk server start/stop` commands.
2. **System Monitor & Status** — Resource monitoring (CPU/MEM/disk), `gwrk status` command, throttle logic.
3. **Git Manager & Context Compiler** — Branch lifecycle, context compilation from rules/spec/plan/tasks.
4. **Docker Sandbox Manager** — Container lifecycle, `Dockerfile.sandbox`, workspace mounting, label conventions.
5. **Dispatch Queue & Orchestrator** — Queue engine, `POST /api/dispatch`, retry + escalation, dispatches.jsonl persistence.

**Dependency**: Phase 1 of this plan (CLI commands) depends on 001-cli-core's Commander infrastructure, config loader (`loadConfig`), and agent dispatch contract (`dispatchAgent`).

**Cross-reference notes**:
- **004-wud-loop**: Complementary — WUD uses `feat/<feature>` branches locally; Build Server uses `phase/<feature>-<phase>` inside Docker sandboxes. No conflict.
- **001-cli-core**: Build Server extends `.gwrkrc.json` (DM-002) with `server.*` and `parallelism.*` sections.

---

## Phases and File Structure

### Phase 1: Daemon Bootstrap

Stand up the Fastify server with health endpoint, PID file management, and `gwrk server start/stop` CLI commands.

**Files (7):**
- `src/server/index.ts` (NEW: Fastify bootstrap, route registration, `/health` endpoint, graceful shutdown handler)
- `src/server/pid.ts` (NEW: PID file read/write/check/remove at `.gwrk/server.pid`)
- `src/commands/server.ts` (NEW: `gwrk server start` and `gwrk server stop` subcommands)
- `src/cli.ts` (MODIFY: Register `server` command group)
- `src/utils/config.ts` (MODIFY: Extend `GwrkConfigSchema` with `server.port`, `server.host`)
- `package.json` (MODIFY: Add `fastify` dependency)
- `tsconfig.json` (MODIFY: Ensure ESM output works with Fastify)

**Requirements Addressed:** FR-001, FR-002, FR-003, FR-011, US-001, US-002, US-007, TC-003, TC-004, TC-005, TC-007

**Dependencies:** 001-cli-core (Commander routing, config loader)

**Contract Mapping:**
- `contracts/server.md` → `startServer(config)` → `src/server/index.ts`
- `contracts/server.md` → `stopServer()` → `src/server/index.ts`
- `contracts/server.md` → `writePid() / readPid() / removePid()` → `src/server/pid.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| `workspace.md` | Config validation — no `.default()` calls |
| `coding-style.md` | TypeScript only, ESM modules |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-001 | Unit | `src/commands/server.test.ts` | `gwrk server start` creates PID, binds port; `server stop` releases |
| TR-002 | Unit | `src/server/index.test.ts` | `/health` returns 200; `/api/status` returns server info |

#### Done When
- `pnpm vitest run src/commands/server.test.ts` exits 0
- `pnpm vitest run src/server/index.test.ts` exits 0
- `test -f src/server/index.ts && test -f src/server/pid.ts && test -f src/commands/server.ts` exits 0
- `grep -q '"fastify"' package.json` exits 0

---

### Phase 2: System Monitor & Status

Add system resource monitoring (CPU, memory, disk) and the `gwrk status` command that queries the daemon.

**Files (5):**
- `src/server/monitor.ts` (NEW: System resource sampler using `os` module — CPU%, MEM%, disk free GB — on configurable interval)
- `src/server/routes/status.ts` (NEW: `GET /api/status` route returning `SystemStatus` JSON)
- `src/commands/status.ts` (NEW: `gwrk status` command — queries daemon `/api/status` or returns `{server:{status:"stopped"}}`)
- `src/cli.ts` (MODIFY: Register `status` command)
- `src/utils/config.ts` (MODIFY: Extend schema with `parallelism.local.maxCpu`, `maxMem`, `minDiskGb`, `maxClones`, `parallelism.cloud.maxConcurrent`)

**Requirements Addressed:** FR-004, FR-014, US-003, US-010, TC-003

**Dependencies:** Phase 1

**Contract Mapping:**
- `contracts/monitor.md` → `SystemMonitor.sample()` → `src/server/monitor.ts`
- `contracts/monitor.md` → `SystemMonitor.isThrottled()` → `src/server/monitor.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| `workspace.md` | Config validation — all parallelism fields required |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-007 | Unit | `src/server/monitor.test.ts` | CPU/MEM/disk sampling; throttle when limits exceeded |
| TR-002 | Unit | `src/server/routes/status.test.ts` | `/api/status` returns full `SystemStatus` shape |

#### Done When
- `pnpm vitest run src/server/monitor.test.ts` exits 0
- `pnpm vitest run src/server/routes/status.test.ts` exits 0
- `test -f src/server/monitor.ts && test -f src/server/routes/status.ts && test -f src/commands/status.ts` exits 0

---

### Phase 3: Git Manager & Context Compiler

Implement Git branch lifecycle (create phase branch, merge-back, conflict detection) and agent context compilation.

**Files (5):**
- `src/server/git-manager.ts` (NEW: `createPhaseBranch()`, `mergePhaseBack()`, `hasConflicts()`, `isClean()`)
- `src/server/context.ts` (NEW: `compileContext()` — reads rules, persona, spec, plan, tasks → single Markdown)
- `src/server/git-manager.test.ts` (NEW: Branch creation, merge-back, conflict detection tests)
- `src/server/context.test.ts` (NEW: Context compilation tests)
- `src/server/types.ts` (NEW: Shared types — `DispatchRecord`, `DispatchAttempt`, `DispatchStatus`, `SystemStatus`, `SandboxInfo`)

**Requirements Addressed:** FR-007, FR-010, FR-013, US-006, US-009, TC-006

**Dependencies:** Phase 1

**Contract Mapping:**
- `contracts/git-manager.md` → `createPhaseBranch(feature, phase)` → `src/server/git-manager.ts`
- `contracts/git-manager.md` → `mergePhaseBack(feature, phase)` → `src/server/git-manager.ts`
- `contracts/context.md` → `compileContext(featureDir, phaseId)` → `src/server/context.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| `workspace.md` | Git conventions, branch naming |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-005 | Unit | `src/server/git-manager.test.ts` | Branch create from feature, merge-back, conflict detection |
| TR-006 | Unit | `src/server/context.test.ts` | Context file contains rules, spec, plan, tasks sections |

#### Done When
- `pnpm vitest run src/server/git-manager.test.ts` exits 0
- `pnpm vitest run src/server/context.test.ts` exits 0
- `test -f src/server/git-manager.ts && test -f src/server/context.ts && test -f src/server/types.ts` exits 0

---

### Phase 4: Docker Sandbox Manager

Implement Docker container lifecycle and the sandbox Dockerfile.

**Files (5):**
- `src/server/sandbox.ts` (NEW: `createSandbox()`, `destroySandbox()`, `listSandboxes()` — Docker container create/label/mount/destroy via `dockerode`)
- `Dockerfile.sandbox` (NEW: `gwrk-sandbox:bookworm-slim` with Node.js LTS, Git, `gh` CLI)
- `src/server/sandbox.test.ts` (NEW: Container lifecycle tests with mocked `dockerode`)
- `package.json` (MODIFY: Add `dockerode` + `@types/dockerode` dependencies)
- `.dockerignore` (MODIFY: Ensure sandbox image builds cleanly)

**Requirements Addressed:** FR-005, FR-006, FR-012, US-004, US-008, TC-006, TC-008

**Dependencies:** Phase 3 (needs `compileContext()` to inject into sandbox)

**Contract Mapping:**
- `contracts/sandbox.md` → `createSandbox(opts)` → `src/server/sandbox.ts`
- `contracts/sandbox.md` → `destroySandbox(containerId)` → `src/server/sandbox.ts`
- `contracts/sandbox.md` → `listSandboxes()` → `src/server/sandbox.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| `workspace.md` | Docker label conventions |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-004 | Unit | `src/server/sandbox.test.ts` | Create with labels, mount at `/workspace`, destroy on completion |
| TR-009 | Shell | `Dockerfile.sandbox` | Build image, verify `node`, `git`, `gh` available |

#### Done When
- `pnpm vitest run src/server/sandbox.test.ts` exits 0
- `test -f Dockerfile.sandbox` exits 0
- `test -f src/server/sandbox.ts` exits 0

---

### Phase 5: Dispatch Queue & Orchestrator

Wire up the dispatch queue engine, `POST /api/dispatch` endpoint, retry + escalation logic, and `dispatches.jsonl` persistence.

**Files (7):**
- `src/server/dispatch.ts` (NEW: `DispatchQueue` class — FIFO queue, `enqueue()`, `dequeue()`, `processNext()`, retry logic, backend escalation)
- `src/server/routes/dispatch.ts` (NEW: `POST /api/dispatch`, `GET /api/dispatch/:feature/:phase`, `GET /api/dispatch/queue`)
- `src/server/persistence.ts` (NEW: Append-only `.gwrk/dispatches.jsonl` writer)
- `src/server/dispatch.test.ts` (NEW: Queue FIFO, throttle, retry × 3, escalation tests)
- `src/server/routes/dispatch.test.ts` (NEW: HTTP endpoint tests)
- `src/server/index.ts` (MODIFY: Register dispatch routes, wire Monitor → Queue throttle)
- `src/server/integration.test.ts` (NEW: E2E — start daemon subprocess, POST dispatch, verify container)

**Requirements Addressed:** FR-005, FR-008, FR-009, US-004, US-005, TC-001

**Dependencies:** Phase 2 (monitor for throttle), Phase 3 (git-manager, context), Phase 4 (sandbox)

**Contract Mapping:**
- `contracts/dispatch.md` → `DispatchQueue.enqueue(request)` → `src/server/dispatch.ts`
- `contracts/dispatch.md` → `DispatchQueue.processNext()` → `src/server/dispatch.ts`
- `contracts/dispatch.md` → `persistDispatch(record)` → `src/server/persistence.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| `workspace.md` | No magic values, config from `.gwrkrc.json` |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-003 | Unit | `src/server/dispatch.test.ts` | FIFO ordering, maxClones throttle, 3× retry + escalation |
| TR-008 | Integration | `src/server/integration.test.ts` | Daemon subprocess, POST dispatch, container created |

#### Done When
- `pnpm vitest run src/server/dispatch.test.ts` exits 0
- `pnpm vitest run src/server/routes/dispatch.test.ts` exits 0
- `pnpm vitest run src/server/integration.test.ts` exits 0
- `test -f src/server/dispatch.ts && test -f src/server/routes/dispatch.ts && test -f src/server/persistence.ts` exits 0

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| `GwrkConfig` (extended) | `src/utils/config.ts` | `src/server/index.ts`, `src/server/dispatch.ts`, `src/server/monitor.ts` |
| `DispatchRecord` | `src/server/types.ts` | `src/server/dispatch.ts`, `src/server/persistence.ts`, `src/server/routes/dispatch.ts` |
| `DispatchAttempt` | `src/server/types.ts` | `src/server/dispatch.ts` |
| `DispatchStatus` | `src/server/types.ts` | `src/server/dispatch.ts`, `src/server/routes/dispatch.ts` |
| `SystemStatus` | `src/server/types.ts` | `src/server/monitor.ts`, `src/server/routes/status.ts`, `src/commands/status.ts` |
| `SandboxInfo` | `src/server/types.ts` | `src/server/sandbox.ts`, `src/server/routes/status.ts` |
| `AgentBackend` | `src/utils/agent.ts` (from 001) | `src/server/dispatch.ts`, `src/server/types.ts` |
| `dispatchAgent()` | `src/utils/agent.ts` (from 001) | `src/server/dispatch.ts` |
| `loadConfig()` | `src/utils/config.ts` (from 001) | `src/server/index.ts` |

---

## Mockup-to-Selector Mapping

_No mockups exist for this feature._

---

## Deferred Items

| Spec Item | Title | Reason | Target |
|---|---|---|---|
| US-010 (partial) | Resource throttle: disk-free check on clone | Requires sandbox clone detection (Phase 5 parallel dispatch, spec 005) | 005-parallel-dispatch |

All other spec items are fully covered in Phases 1–5.

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| US-001 | Phase 1 | Planned |
| US-002 | Phase 1 | Planned |
| US-003 | Phase 2 | Planned |
| US-004 | Phase 4, 5 | Planned |
| US-005 | Phase 5 | Planned |
| US-006 | Phase 3 | Planned |
| US-007 | Phase 1 | Planned |
| US-008 | Phase 4 | Planned |
| US-009 | Phase 3 | Planned |
| US-010 | Phase 2 | Planned (disk-free clone deferred) |
| FR-001 | Phase 1 | Planned |
| FR-002 | Phase 1 | Planned |
| FR-003 | Phase 1 | Planned |
| FR-004 | Phase 2 | Planned |
| FR-005 | Phase 4, 5 | Planned |
| FR-006 | Phase 4 | Planned |
| FR-007 | Phase 3 | Planned |
| FR-008 | Phase 5 | Planned |
| FR-009 | Phase 5 | Planned |
| FR-010 | Phase 3 | Planned |
| FR-011 | Phase 1 | Planned |
| FR-012 | Phase 4 | Planned |
| FR-013 | Phase 3 | Planned |
| FR-014 | Phase 2 | Planned |
| DM-001 | Phase 3 (types), Phase 5 (persist) | Planned |
| DM-002 | Phase 1, 2 (config) | Planned |
| DM-003 | Phase 2 (status) | Planned |
| TC-001 | Phase 5 | Planned |
| TC-002 | Phase 1 | Planned |
| TC-003 | Phase 1, 2 | Planned |
| TC-004 | Phase 1 | Planned |
| TC-005 | Phase 1 | Planned |
| TC-006 | Phase 4 | Planned |
| TC-007 | Phase 1 | Planned |
| TC-008 | Phase 4 | Planned |
| TR-001 | Phase 1 | Planned |
| TR-002 | Phase 1, 2 | Planned |
| TR-003 | Phase 5 | Planned |
| TR-004 | Phase 4 | Planned |
| TR-005 | Phase 3 | Planned |
| TR-006 | Phase 3 | Planned |
| TR-007 | Phase 2 | Planned |
| TR-008 | Phase 5 | Planned |
| TR-009 | Phase 4 | Planned |
| SC-001 | Phase 1 | Planned |
| SC-002 | Phase 1 | Planned |
| SC-003 | Phase 5 | Planned |
| SC-004 | Phase 5 | Planned |
| SC-005 | Phase 5 | Planned |
| VR-001 | Phase 5 | Planned |
| VR-002 | Phase 1 | Planned |
| VR-003 | Phase 1 | Planned |
| VR-004 | Phase 5 | Planned |
| VR-005 | Phase 5 | Planned |


## Current Tasks

### Phase 1: Daemon Bootstrap

```json
[
  {
    "id": "T001",
    "title": "Extend GwrkConfigSchema with server config",
    "description": "In src/utils/config.ts, add server.port (number, 1024-65535) and server.host (string) fields to GwrkConfigSchema. No .default() calls. Export the extended type.",
    "status": "completed"
  },
  {
    "id": "T002",
    "title": "Add fastify dependency",
    "description": "Add 'fastify' to dependencies in package.json. Run pnpm install.",
    "status": "completed"
  },
  {
    "id": "T003",
    "title": "Create PID file manager",
    "description": "Create src/server/pid.ts with writePid(pidPath), readPid(pidPath), removePid(pidPath). writePid writes process.pid. readPid returns number|null, validates process is alive via kill(pid,0). removePid deletes the file (no-op if missing).",
    "status": "completed"
  },
  {
    "id": "T004",
    "title": "Create Fastify server bootstrap",
    "description": "Create src/server/index.ts with startServer(config: GwrkConfig) that: creates Fastify instance, registers GET /health (returns 200), writes PID file via writePid(), binds to config.server.host:config.server.port. Export stopServer(instance) that: waits 30s for active work, calls removePid(), closes Fastify. Register SIGTERM/SIGINT handlers.",
    "status": "completed"
  },
  {
    "id": "T005",
    "title": "Create server CLI commands",
    "description": "Create src/commands/server.ts with Commander subcommands: 'gwrk server start' (calls startServer, checks existing PID, checks Docker availability) and 'gwrk server stop' (reads PID, sends SIGTERM, waits for exit, verifies port released).",
    "status": "completed"
  },
  {
    "id": "T006",
    "title": "Register server command in CLI",
    "description": "In src/cli.ts, import serverCommand from ./commands/server.js and add program.addCommand(serverCommand). Exclude 'server start' from preAction config validation if server.* fields are missing (server start implicitly validates).",
    "status": "completed"
  },
  {
    "id": "T007",
    "title": "Unit tests for Phase 1",
    "description": "Create src/commands/server.test.ts: verify start creates PID, binds port, /health returns 200; verify stop removes PID, releases port; verify start when already running shows error. Create src/server/index.test.ts: verify Fastify bootstrap and /health endpoint. Create src/server/pid.test.ts: verify write/read/remove PID lifecycle.",
    "status": "completed"
  }
]
```

## Gate Scripts

### T001-gate.sh

```bash
#!/usr/bin/env bash
# Gate: T001 — Extend GwrkConfigSchema with server config
# Contract: src/utils/config.ts must contain server.port and server.host in GwrkConfigSchema
set -euo pipefail

FILE="src/utils/config.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE not found"; exit 1; }

# Verify server config fields exist in the schema
# Assertion #2
grep -q 'server:' "$FILE" || { echo "FAIL: 'server:' block missing from GwrkConfigSchema"; exit 1; }
# Assertion #3
grep -q 'port:' "$FILE" || { echo "FAIL: 'port:' field missing from server config"; exit 1; }
# Assertion #4
grep -q 'host:' "$FILE" || { echo "FAIL: 'host:' field missing from server config"; exit 1; }

# Verify no .default() calls on server fields
# Assertion #5
! grep -E 'server.*\.default\(' "$FILE" || { echo "FAIL: .default() found on server config fields"; exit 1; }

echo "PASS: T001"

```

### T002-gate.sh

```bash
#!/usr/bin/env bash
# Gate: T002 — Add fastify dependency
set -euo pipefail

# Assertion #1
grep -q '"fastify"' package.json || { echo "FAIL: fastify not in package.json dependencies"; exit 1; }
# Assertion #2
test -d node_modules/fastify || { echo "FAIL: fastify not installed in node_modules"; exit 1; }

echo "PASS: T002"

```

### T003-gate.sh

```bash
#!/usr/bin/env bash
# Gate: T003 — Create PID file manager
# Contract: src/server/pid.ts must export writePid, readPid, removePid
set -euo pipefail

FILE="src/server/pid.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE not found"; exit 1; }

# Assertion #2
grep -q 'export.*function writePid' "$FILE" || grep -q 'export function writePid' "$FILE" || { echo "FAIL: writePid not exported"; exit 1; }
# Assertion #3
grep -q 'export.*function readPid' "$FILE" || grep -q 'export function readPid' "$FILE" || { echo "FAIL: readPid not exported"; exit 1; }
# Assertion #4
grep -q 'export.*function removePid' "$FILE" || grep -q 'export function removePid' "$FILE" || { echo "FAIL: removePid not exported"; exit 1; }

# Verify readPid returns number | null
# Assertion #5
grep -q 'number | null\|number|null' "$FILE" || { echo "FAIL: readPid must return number | null"; exit 1; }

echo "PASS: T003"

```

### T004-gate.sh

```bash
#!/usr/bin/env bash
# Gate: T004 — Create Fastify server bootstrap
# Contract: src/server/index.ts must export startServer and stopServer
set -euo pipefail

FILE="src/server/index.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE not found"; exit 1; }

# Verify startServer export
# Assertion #2
grep -q 'export.*function startServer\|export async function startServer' "$FILE" || { echo "FAIL: startServer not exported"; exit 1; }

# Verify stopServer export
# Assertion #3
grep -q 'export.*function stopServer\|export async function stopServer' "$FILE" || { echo "FAIL: stopServer not exported"; exit 1; }

# Verify Fastify import
# Assertion #4
grep -q 'fastify\|Fastify' "$FILE" || { echo "FAIL: Fastify not imported"; exit 1; }

# Verify /health route
# Assertion #5
grep -q '/health' "$FILE" || { echo "FAIL: /health route not defined"; exit 1; }

# Verify PID file integration
# Assertion #6
grep -q 'writePid\|readPid\|removePid' "$FILE" || { echo "FAIL: PID file functions not referenced"; exit 1; }

# Verify SIGTERM/SIGINT handler
# Assertion #7
grep -q 'SIGTERM\|SIGINT' "$FILE" || { echo "FAIL: Signal handlers not registered"; exit 1; }

echo "PASS: T004"

```

### T005-gate.sh

```bash
#!/usr/bin/env bash
# Gate: T005 — Create server CLI commands
# Contract: src/commands/server.ts must export serverCommand with start and stop subcommands
set -euo pipefail

FILE="src/commands/server.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE not found"; exit 1; }

# Verify exports
# Assertion #2
grep -q 'export.*serverCommand\|export const serverCommand\|export function' "$FILE" || { echo "FAIL: serverCommand not exported"; exit 1; }

# Verify start and stop subcommands
# Assertion #3
grep -q "'start'\|\"start\"" "$FILE" || { echo "FAIL: 'start' subcommand not defined"; exit 1; }
# Assertion #4
grep -q "'stop'\|\"stop\"" "$FILE" || { echo "FAIL: 'stop' subcommand not defined"; exit 1; }

# Verify startServer import
# Assertion #5
grep -q 'startServer' "$FILE" || { echo "FAIL: startServer not imported"; exit 1; }

echo "PASS: T005"

```

### T006-gate.sh

```bash
#!/usr/bin/env bash
# Gate: T006 — Register server command in CLI
set -euo pipefail

FILE="src/cli.ts"
# Assertion #1
grep -q 'serverCommand\|server' "$FILE" || { echo "FAIL: serverCommand not imported in cli.ts"; exit 1; }
# Assertion #2
grep -q 'addCommand.*server\|addCommand(serverCommand' "$FILE" || { echo "FAIL: serverCommand not registered via addCommand"; exit 1; }

echo "PASS: T006"

```

### T007-gate.sh

```bash
#!/usr/bin/env bash
# Gate: T007 — Unit tests for Phase 1
set -euo pipefail

# Test files must exist
# Assertion #1
test -f src/commands/server.test.ts || { echo "FAIL: src/commands/server.test.ts not found"; exit 1; }
# Assertion #2
test -f src/server/index.test.ts || { echo "FAIL: src/server/index.test.ts not found"; exit 1; }

# Tests must contain meaningful assertions
# Assertion #3
grep -q 'describe\|test\|it(' src/commands/server.test.ts || { echo "FAIL: server.test.ts has no test cases"; exit 1; }
# Assertion #4
grep -q 'describe\|test\|it(' src/server/index.test.ts || { echo "FAIL: index.test.ts has no test cases"; exit 1; }

# Tests must pass
# Assertion #5
pnpm vitest run src/commands/server.test.ts src/server/index.test.ts --reporter=verbose || { echo "FAIL: Phase 1 tests failed"; exit 1; }

echo "PASS: T007"

```

### T008-gate.sh

```bash
#!/usr/bin/env bash
# Gate: T008 — Extend GwrkConfigSchema with parallelism config
set -euo pipefail

FILE="src/utils/config.ts"

# Assertion #1
grep -q 'parallelism' "$FILE" || { echo "FAIL: 'parallelism' block missing from schema"; exit 1; }
# Assertion #2
grep -q 'maxClones' "$FILE" || { echo "FAIL: 'maxClones' missing from parallelism config"; exit 1; }
# Assertion #3
grep -q 'maxCpu' "$FILE" || { echo "FAIL: 'maxCpu' missing from parallelism config"; exit 1; }
# Assertion #4
grep -q 'maxMem' "$FILE" || { echo "FAIL: 'maxMem' missing from parallelism config"; exit 1; }
# Assertion #5
grep -q 'minDiskGb' "$FILE" || { echo "FAIL: 'minDiskGb' missing from parallelism config"; exit 1; }
# Assertion #6
grep -q 'maxConcurrent' "$FILE" || { echo "FAIL: 'maxConcurrent' missing from cloud config"; exit 1; }

# Verify no .default() calls on parallelism fields
# Assertion #7
! grep -E 'parallelism.*\.default\(|maxClones.*\.default\(|maxCpu.*\.default\(' "$FILE" || { echo "FAIL: .default() found on parallelism fields"; exit 1; }

echo "PASS: T008"

```

### T009-gate.sh

```bash
#!/usr/bin/env bash
# Gate: T009 — Create SystemMonitor class
# Contract: src/server/monitor.ts must export SystemMonitor with sample, isThrottled, startPolling, stopPolling, getStatus
set -euo pipefail

FILE="src/server/monitor.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE not found"; exit 1; }

# Assertion #2
grep -q 'class SystemMonitor\|export class SystemMonitor' "$FILE" || { echo "FAIL: SystemMonitor class not found"; exit 1; }
# Assertion #3
grep -q 'sample\(\)' "$FILE" || { echo "FAIL: sample() method not found"; exit 1; }
# Assertion #4
grep -q 'isThrottled\(\)' "$FILE" || { echo "FAIL: isThrottled() method not found"; exit 1; }
# Assertion #5
grep -q 'startPolling' "$FILE" || { echo "FAIL: startPolling() method not found"; exit 1; }
# Assertion #6
grep -q 'stopPolling' "$FILE" || { echo "FAIL: stopPolling() method not found"; exit 1; }
# Assertion #7
grep -q 'getStatus' "$FILE" || { echo "FAIL: getStatus() method not found"; exit 1; }

echo "PASS: T009"

```

### T010-gate.sh

```bash
#!/usr/bin/env bash
# Gate: T010 — Create /api/status route
set -euo pipefail

FILE="src/server/routes/status.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE not found"; exit 1; }

# Assertion #2
grep -q '/api/status' "$FILE" || { echo "FAIL: /api/status route not defined"; exit 1; }
# Assertion #3
grep -q 'GET\|get' "$FILE" || { echo "FAIL: GET method not specified"; exit 1; }

echo "PASS: T010"

```

### T011-gate.sh

```bash
#!/usr/bin/env bash
# Gate: T011 — Create gwrk status CLI command
set -euo pipefail

FILE="src/commands/status.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE not found"; exit 1; }

# Assertion #2
grep -q 'statusCommand\|export' "$FILE" || { echo "FAIL: statusCommand not exported"; exit 1; }
# Assertion #3
grep -q "'status'\|\"status\"" "$FILE" || { echo "FAIL: 'status' command name not defined"; exit 1; }
# Assertion #4
grep -q 'localhost\|127\.0\.0\.1\|/api/status' "$FILE" || { echo "FAIL: daemon query URL not found"; exit 1; }

echo "PASS: T011"

```

### T012-gate.sh

```bash
#!/usr/bin/env bash
# Gate: T012 — Register status command in CLI
set -euo pipefail

FILE="src/cli.ts"
# Assertion #1
grep -q 'statusCommand\|status' "$FILE" || { echo "FAIL: statusCommand not imported in cli.ts"; exit 1; }
# Assertion #2
grep -q 'addCommand.*status\|addCommand(statusCommand' "$FILE" || { echo "FAIL: statusCommand not registered"; exit 1; }

echo "PASS: T012"

```

### T013-gate.sh

```bash
#!/usr/bin/env bash
# Gate: T013 — Unit tests for Phase 2
set -euo pipefail

# Assertion #1
test -f src/server/monitor.test.ts || { echo "FAIL: monitor.test.ts not found"; exit 1; }
# Assertion #2
test -f src/server/routes/status.test.ts || { echo "FAIL: routes/status.test.ts not found"; exit 1; }

# Assertion #3
grep -q 'describe\|test\|it(' src/server/monitor.test.ts || { echo "FAIL: monitor.test.ts has no test cases"; exit 1; }
# Assertion #4
grep -q 'describe\|test\|it(' src/server/routes/status.test.ts || { echo "FAIL: status.test.ts has no test cases"; exit 1; }

# Assertion #5
pnpm vitest run src/server/monitor.test.ts src/server/routes/status.test.ts --reporter=verbose || { echo "FAIL: Phase 2 tests failed"; exit 1; }

echo "PASS: T013"

```

### T014-gate.sh

```bash
#!/usr/bin/env bash
# Gate: T014 — Create shared server types
# Contract: src/server/types.ts must export DispatchRecord, DispatchAttempt, DispatchStatus, SystemStatus, SandboxInfo
set -euo pipefail

FILE="src/server/types.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE not found"; exit 1; }

# Assertion #2
grep -q 'DispatchRecord' "$FILE" || { echo "FAIL: DispatchRecord type not found"; exit 1; }
# Assertion #3
grep -q 'DispatchAttempt' "$FILE" || { echo "FAIL: DispatchAttempt type not found"; exit 1; }
# Assertion #4
grep -q 'DispatchStatus' "$FILE" || { echo "FAIL: DispatchStatus type not found"; exit 1; }
# Assertion #5
grep -q 'SystemStatus' "$FILE" || { echo "FAIL: SystemStatus type not found"; exit 1; }
# Assertion #6
grep -q 'SandboxInfo' "$FILE" || { echo "FAIL: SandboxInfo type not found"; exit 1; }

# Verify Zod schemas exist
# Assertion #7
grep -q 'z\.object\|z\.enum' "$FILE" || { echo "FAIL: No Zod schemas found"; exit 1; }

echo "PASS: T014"

```

### T015-gate.sh

```bash
#!/usr/bin/env bash
# Gate: T015 — Create Git branch manager
# Contract: src/server/git-manager.ts must export createPhaseBranch, mergePhaseBack, isClean, hasConflicts
set -euo pipefail

FILE="src/server/git-manager.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE not found"; exit 1; }

# Assertion #2
grep -q 'export.*function createPhaseBranch\|export async function createPhaseBranch' "$FILE" || { echo "FAIL: createPhaseBranch not exported"; exit 1; }
# Assertion #3
grep -q 'export.*function mergePhaseBack\|export async function mergePhaseBack' "$FILE" || { echo "FAIL: mergePhaseBack not exported"; exit 1; }
# Assertion #4
grep -q 'export.*function isClean\|export async function isClean' "$FILE" || { echo "FAIL: isClean not exported"; exit 1; }
# Assertion #5
grep -q 'export.*function hasConflicts\|export async function hasConflicts' "$FILE" || { echo "FAIL: hasConflicts not exported"; exit 1; }

# Verify git operations via child_process
# Assertion #6
grep -q 'execFile\|exec\|child_process' "$FILE" || { echo "FAIL: child_process not used for git operations"; exit 1; }

echo "PASS: T015"

```

### T016-gate.sh

```bash
#!/usr/bin/env bash
# Gate: T016 — Create context compiler
# Contract: src/server/context.ts must export compileContext and writeContextToSandbox
set -euo pipefail

FILE="src/server/context.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE not found"; exit 1; }

# Assertion #2
grep -q 'export.*function compileContext\|export async function compileContext' "$FILE" || { echo "FAIL: compileContext not exported"; exit 1; }
# Assertion #3
grep -q 'export.*function writeContextToSandbox\|export async function writeContextToSandbox' "$FILE" || { echo "FAIL: writeContextToSandbox not exported"; exit 1; }

# Verify it reads governance rules
# Assertion #4
grep -q '\.agent/rules\|rules' "$FILE" || { echo "FAIL: governance rules path not referenced"; exit 1; }

# Verify it reads spec.md  
# Assertion #5
grep -q 'spec\.md' "$FILE" || { echo "FAIL: spec.md not referenced"; exit 1; }

echo "PASS: T016"

```

### T017-gate.sh

```bash
#!/usr/bin/env bash
# Gate: T017 — Unit tests for Phase 3
set -euo pipefail

# Assertion #1
test -f src/server/git-manager.test.ts || { echo "FAIL: git-manager.test.ts not found"; exit 1; }
# Assertion #2
test -f src/server/context.test.ts || { echo "FAIL: context.test.ts not found"; exit 1; }

# Assertion #3
grep -q 'describe\|test\|it(' src/server/git-manager.test.ts || { echo "FAIL: git-manager.test.ts has no test cases"; exit 1; }
# Assertion #4
grep -q 'describe\|test\|it(' src/server/context.test.ts || { echo "FAIL: context.test.ts has no test cases"; exit 1; }

# Assertion #5
pnpm vitest run src/server/git-manager.test.ts src/server/context.test.ts --reporter=verbose || { echo "FAIL: Phase 3 tests failed"; exit 1; }

echo "PASS: T017"

```

### T018-gate.sh

```bash
#!/usr/bin/env bash
# Gate: T018 — Add dockerode dependency
set -euo pipefail

# Assertion #1
grep -q '"dockerode"' package.json || { echo "FAIL: dockerode not in package.json dependencies"; exit 1; }
# Assertion #2
grep -q '"@types/dockerode"' package.json || { echo "FAIL: @types/dockerode not in devDependencies"; exit 1; }
# Assertion #3
test -d node_modules/dockerode || { echo "FAIL: dockerode not installed"; exit 1; }

echo "PASS: T018"

```

### T019-gate.sh

```bash
#!/usr/bin/env bash
# Gate: T019 — Create sandbox Dockerfile
set -euo pipefail

# Assertion #1
test -f Dockerfile.sandbox || { echo "FAIL: Dockerfile.sandbox not found"; exit 1; }

# Verify base image
# Assertion #2
grep -q 'bookworm-slim\|debian' Dockerfile.sandbox || { echo "FAIL: bookworm-slim base not found"; exit 1; }

# Verify Node.js installation
# Assertion #3
grep -qi 'node\|nodejs' Dockerfile.sandbox || { echo "FAIL: Node.js installation not found"; exit 1; }

# Verify Git installation
# Assertion #4
grep -qi 'git' Dockerfile.sandbox || { echo "FAIL: Git installation not found"; exit 1; }

# Verify gh CLI installation
# Assertion #5
grep -qi 'gh\|github-cli' Dockerfile.sandbox || { echo "FAIL: gh CLI installation not found"; exit 1; }

# Verify WORKDIR
# Assertion #6
grep -q 'WORKDIR /workspace' Dockerfile.sandbox || { echo "FAIL: WORKDIR /workspace not set"; exit 1; }

echo "PASS: T019"

```

### T020-gate.sh

```bash
#!/usr/bin/env bash
# Gate: T020 — Create Docker sandbox manager
# Contract: src/server/sandbox.ts must export createSandbox, destroySandbox, destroyAllSandboxes, listSandboxes
set -euo pipefail

FILE="src/server/sandbox.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE not found"; exit 1; }

# Assertion #2
grep -q 'export.*function createSandbox\|export async function createSandbox' "$FILE" || { echo "FAIL: createSandbox not exported"; exit 1; }
# Assertion #3
grep -q 'export.*function destroySandbox\|export async function destroySandbox' "$FILE" || { echo "FAIL: destroySandbox not exported"; exit 1; }
# Assertion #4
grep -q 'export.*function destroyAllSandboxes\|export async function destroyAllSandboxes' "$FILE" || { echo "FAIL: destroyAllSandboxes not exported"; exit 1; }
# Assertion #5
grep -q 'export.*function listSandboxes\|export async function listSandboxes' "$FILE" || { echo "FAIL: listSandboxes not exported"; exit 1; }

# Verify Docker label convention
# Assertion #6
grep -q 'gwrk\.feature\|gwrk.feature' "$FILE" || { echo "FAIL: gwrk.feature label not referenced"; exit 1; }
# Assertion #7
grep -q 'gwrk\.phase\|gwrk.phase' "$FILE" || { echo "FAIL: gwrk.phase label not referenced"; exit 1; }

# Verify dockerode usage
# Assertion #8
grep -q 'dockerode\|Docker\|Dockerode' "$FILE" || { echo "FAIL: dockerode not imported"; exit 1; }

echo "PASS: T020"

```

### T021-gate.sh

```bash
#!/usr/bin/env bash
# Gate: T021 — Unit tests for Phase 4
set -euo pipefail

# Assertion #1
test -f src/server/sandbox.test.ts || { echo "FAIL: sandbox.test.ts not found"; exit 1; }

# Assertion #2
grep -q 'describe\|test\|it(' src/server/sandbox.test.ts || { echo "FAIL: sandbox.test.ts has no test cases"; exit 1; }

# Assertion #3
pnpm vitest run src/server/sandbox.test.ts --reporter=verbose || { echo "FAIL: Phase 4 tests failed"; exit 1; }

echo "PASS: T021"

```

### T022-gate.sh

```bash
#!/usr/bin/env bash
# Gate: T022 — Create JSONL persistence writer
# Contract: src/server/persistence.ts must export persistDispatch
set -euo pipefail

FILE="src/server/persistence.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE not found"; exit 1; }

# Assertion #2
grep -q 'export.*function persistDispatch\|export function persistDispatch' "$FILE" || { echo "FAIL: persistDispatch not exported"; exit 1; }

# Verify JSONL target
# Assertion #3
grep -q 'dispatches\.jsonl' "$FILE" || { echo "FAIL: dispatches.jsonl path not referenced"; exit 1; }

# Verify Zod validation
# Assertion #4
grep -q 'parse\|safeParse\|validate' "$FILE" || { echo "FAIL: Zod validation not found"; exit 1; }

echo "PASS: T022"

```

### T023-gate.sh

```bash
#!/usr/bin/env bash
# Gate: T023 — Create DispatchQueue class
# Contract: src/server/dispatch.ts must export DispatchQueue with enqueue, processNext, handleCompletion, getQueue, getDispatch
set -euo pipefail

FILE="src/server/dispatch.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE not found"; exit 1; }

# Assertion #2
grep -q 'class DispatchQueue\|export class DispatchQueue' "$FILE" || { echo "FAIL: DispatchQueue class not found"; exit 1; }
# Assertion #3
grep -q 'enqueue' "$FILE" || { echo "FAIL: enqueue method not found"; exit 1; }
# Assertion #4
grep -q 'processNext' "$FILE" || { echo "FAIL: processNext method not found"; exit 1; }
# Assertion #5
grep -q 'handleCompletion' "$FILE" || { echo "FAIL: handleCompletion method not found"; exit 1; }
# Assertion #6
grep -q 'getQueue' "$FILE" || { echo "FAIL: getQueue method not found"; exit 1; }
# Assertion #7
grep -q 'getDispatch' "$FILE" || { echo "FAIL: getDispatch method not found"; exit 1; }

# Verify retry logic (3 attempts)
# Assertion #8
grep -q '3\|MAX_RETRIES\|maxRetries' "$FILE" || { echo "FAIL: retry limit (3) not found"; exit 1; }

# Verify fallback order reference
# Assertion #9
grep -q 'fallbackOrder\|fallback' "$FILE" || { echo "FAIL: fallbackOrder not referenced"; exit 1; }

echo "PASS: T023"

```

### T024-gate.sh

```bash
#!/usr/bin/env bash
# Gate: T024 — Create dispatch API routes
set -euo pipefail

FILE="src/server/routes/dispatch.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE not found"; exit 1; }

# Verify POST /api/dispatch
# Assertion #2
grep -q 'POST\|post' "$FILE" || { echo "FAIL: POST method not found"; exit 1; }
# Assertion #3
grep -q '/api/dispatch' "$FILE" || { echo "FAIL: /api/dispatch route not defined"; exit 1; }

# Verify GET endpoints
# Assertion #4
grep -q 'GET\|get' "$FILE" || { echo "FAIL: GET method not found"; exit 1; }
# Assertion #5
grep -q 'queue' "$FILE" || { echo "FAIL: /queue endpoint not found"; exit 1; }

echo "PASS: T024"

```

### T025-gate.sh

```bash
#!/usr/bin/env bash
# Gate: T025 — Wire dispatch routes and monitor into server
set -euo pipefail

FILE="src/server/index.ts"

# Verify dispatch route registration
# Assertion #1
grep -q 'dispatch' "$FILE" || { echo "FAIL: dispatch routes not referenced in server index"; exit 1; }

# Verify monitor integration
# Assertion #2
grep -q 'monitor\|Monitor\|SystemMonitor' "$FILE" || { echo "FAIL: SystemMonitor not integrated"; exit 1; }

# Verify startPolling
# Assertion #3
grep -q 'startPolling\|polling' "$FILE" || { echo "FAIL: monitor polling not started"; exit 1; }

echo "PASS: T025"

```

### T026-gate.sh

```bash
#!/usr/bin/env bash
# Gate: T026 — Unit tests for dispatch queue
set -euo pipefail

# Assertion #1
test -f src/server/dispatch.test.ts || { echo "FAIL: dispatch.test.ts not found"; exit 1; }

# Assertion #2
grep -q 'describe\|test\|it(' src/server/dispatch.test.ts || { echo "FAIL: dispatch.test.ts has no test cases"; exit 1; }

# Verify retry test coverage
# Assertion #3
grep -q 'retry\|escalat\|fallback' src/server/dispatch.test.ts || { echo "FAIL: retry/escalation test cases missing"; exit 1; }

# Assertion #4
pnpm vitest run src/server/dispatch.test.ts --reporter=verbose || { echo "FAIL: dispatch queue tests failed"; exit 1; }

echo "PASS: T026"

```

### T027-gate.sh

```bash
#!/usr/bin/env bash
# Gate: T027 — Unit tests for dispatch routes
set -euo pipefail

# Assertion #1
test -f src/server/routes/dispatch.test.ts || { echo "FAIL: routes/dispatch.test.ts not found"; exit 1; }

# Assertion #2
grep -q 'describe\|test\|it(' src/server/routes/dispatch.test.ts || { echo "FAIL: dispatch.test.ts has no test cases"; exit 1; }

# Assertion #3
pnpm vitest run src/server/routes/dispatch.test.ts --reporter=verbose || { echo "FAIL: dispatch route tests failed"; exit 1; }

echo "PASS: T027"

```

### T028-gate.sh

```bash
#!/usr/bin/env bash
# Gate: T028 — Integration test for end-to-end dispatch
set -euo pipefail

# Assertion #1
test -f src/server/integration.test.ts || { echo "FAIL: integration.test.ts not found"; exit 1; }

# Assertion #2
grep -q 'describe\|test\|it(' src/server/integration.test.ts || { echo "FAIL: integration.test.ts has no test cases"; exit 1; }

# Verify integration test references the full lifecycle
# Assertion #3
grep -q 'dispatch\|POST\|/api/dispatch' src/server/integration.test.ts || { echo "FAIL: dispatch endpoint not tested in integration test"; exit 1; }

# Assertion #4
pnpm vitest run src/server/integration.test.ts --reporter=verbose || { echo "FAIL: integration test failed"; exit 1; }

echo "PASS: T028"

```

### run-all-gates.sh

```bash
#!/usr/bin/env bash
# Run all Hard Gates for 002-build-server
# Usage: ./run-all-gates.sh [phase_number]
#   No args = run all gates
#   With arg = run gates for that phase only
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PASS=0
FAIL=0
ERRORS=()

# Define phase → task ID ranges
declare -A PHASE_RANGES
PHASE_RANGES[1]="T001 T002 T003 T004 T005 T006 T007"
PHASE_RANGES[2]="T008 T009 T010 T011 T012 T013"
PHASE_RANGES[3]="T014 T015 T016 T017"
PHASE_RANGES[4]="T018 T019 T020 T021"
PHASE_RANGES[5]="T022 T023 T024 T025 T026 T027 T028"

# Determine which gates to run
if [ "${1:-}" != "" ]; then
  PHASE="$1"
  if [ -z "${PHASE_RANGES[$PHASE]+x}" ]; then
    echo "ERROR: Unknown phase $PHASE. Valid: 1-5"
    exit 1
  fi
  TASKS="${PHASE_RANGES[$PHASE]}"
  echo "═══════════════════════════════════════════════"
  echo " GATES · 002-build-server · Phase $PHASE"
  echo "═══════════════════════════════════════════════"
else
  TASKS=""
  for p in 1 2 3 4 5; do
    TASKS="$TASKS ${PHASE_RANGES[$p]}"
  done
  echo "═══════════════════════════════════════════════"
  echo " GATES · 002-build-server · All Phases"
  echo "═══════════════════════════════════════════════"
fi

for tid in $TASKS; do
  gate="$SCRIPT_DIR/${tid}-gate.sh"
  if [ ! -f "$gate" ]; then
    echo "  ⚠️  $tid: gate script not found"
    FAIL=$((FAIL + 1))
    ERRORS+=("$tid: gate script missing")
    continue
  fi

  if bash "$gate" > /dev/null 2>&1; then
    echo "  ✅ $tid: PASS"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $tid: FAIL"
    FAIL=$((FAIL + 1))
    ERRORS+=("$tid")
  fi
done

echo ""
echo "═══════════════════════════════════════════════"
echo " Results: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════════════"

if [ ${#ERRORS[@]} -gt 0 ]; then
  echo ""
  echo "Failed gates:"
  for e in "${ERRORS[@]}"; do
    echo "  - $e"
  done
  exit 1
fi

exit 0

```

