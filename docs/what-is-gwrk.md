# CodeX Lab Orchestration: Agent-ZFG & Agent-WUD Workflow Specification

## 1. Overview & Objectives
This specification defines a distributed, multi-agent orchestration model leveraging **CodeX Lab** (Cloud Agents) alongside a local orchestrator. The goal is to farm out feature development into parallelizable phases, managed automatically until completion.

*   **Agent-ZFG (Zero F*cks Given)**: The local orchestrator. It plans, delegates, resolves conflicts, and manages the Git tree.
*   **Agent-WUD (Work Until Done)**: The ephemeral cloud worker. It receives a specific phase, writes code, runs tests, opens a Pull Request, and terminates.

---

## 2. Roles and Personas

### 2.1 Agent-ZFG (Local Orchestrator)
*   **Environment**: Local machine (executes via `make`, `bash`, `gh` CLI, and `gemini` CLI).
*   **Personas Used**: `.agent/prompts/personas/principal-engineer.md`, `.agent/prompts/personas/product-manager.md`.
*   **Responsibilities**:
    *   Ingests the feature spec and breaks it into parallelizable phases (beads).
    *   Creates the feature Work-In-Progress (WIP) branch.
    *   Creates phase branches and dispatches them to Cloud Agents (CodeX Lab).
    *   Executes its own designated phase locally.
    *   Monitors GitHub for completed phase PRs.
    *   Resolves merge conflicts automatically using the Gemini CLI.
    *   Merges approved phase PRs into the WIP branch.
    *   Opens the final PR from the WIP branch to `develop`.

### 2.2 Agent-WUD (Cloud Worker)
*   **Environment**: CodeX Lab Cloud Sandbox.
*   **Personas Used**: `.agent/prompts/personas/senior-dev.md`.
*   **Responsibilities**:
    *   Checks out its assigned `phase/*` branch.
    *   Executes the `scripts/dev/work-until-done.sh` loop (Implement -> Test -> Analyze -> Fix).
    *   Runs verification gates (`specs/<feature>/gates/run-all-gates.sh`).
    *   Pushes code and opens a PR against the feature WIP branch.
    *   Terminates (expires) once the PR is successfully opened.

---

## 3. Git Branching Model
To support parallel agent execution without constant blocking, a strict hierarchical branching strategy is required:

1.  **`develop`**: The main integration branch.
2.  **`feature/<feature-name>-wip`**: Owned by Agent-ZFG. Branched from `develop`. Acts as the integration target for all phase branches.
3.  **`phase/<feature-name>-<phase-id>`**: Owned by Agent-WUD. Branched from the `wip` branch. Ephemeral workspace for a specific bead/phase.

---

## 4. Execution Workflow

### Step 1: Feature Initialization & Planning (Agent-ZFG)
1.  **Trigger**: User runs `make agent-zfg FEATURE=<feature_name>`.
2.  **Planning**: ZFG reads `specs/<feature>/spec.md` and uses `.agent/workflows/plan-to-beads.md`.
3.  **Output**: Generates atomic phase scripts in `specs/<feature>/beads/` (e.g., `01-phase-1-tasks.sh`) and records IDs in `.phase-ids.json`.
4.  **Scaffolding**: ZFG creates `feature/<feature_name>-wip` and pushes it to origin.

### Step 2: Delegation & Dispatch (Agent-ZFG -> Agent-WUD)
For each phase in `.phase-ids.json`:
1.  ZFG creates `phase/<feature_name>-<phase-id>` from the WIP branch and pushes it.
2.  ZFG compiles the context payload (Rules, Persona, Monorepo Context, Phase Tasks) using `.specify/scripts/bash/update-agent-context.sh`.
3.  ZFG dispatches the cloud agent (e.g., via `gh issue create` tagging CodeX, or CodeX API), providing the payload and instructing it to target the phase branch.

### Step 3: Work-Until-Done Loop (Agent-WUD)
1.  **Boot**: CodeX Lab initializes, reads the assigned phase script, and loads `.agent/rules/*.md`.
2.  **Implementation**: Executes `.agent/workflows/implement.md`.
3.  **Validation**: Runs `scripts/dev/work-until-done.sh`, which loops through tests and `.agent/workflows/analyze.md` on failures.
4.  **Delivery**: Once `scripts/dev/wud-verdict.sh` exits `0`, the agent commits, pushes, and executes `gh pr create --base feature/<feature_name>-wip`. The agent then terminates.

### Step 4: Monitoring & Resolution (Agent-ZFG)
ZFG runs a continuous polling loop (`scripts/dev/wud-ci-wait.sh` / custom monitor script):
1.  **Detect PR**: ZFG sees a new PR targeting the WIP branch.
2.  **Review**: ZFG pulls the diff and evaluates it using `.agent/workflows/review-code.md` via `gemini` CLI.
3.  **Conflict Resolution**: If the PR has merge conflicts (due to another phase merging first):
    *   ZFG checks out the PR branch locally.
    *   Merges `wip` into the phase branch to generate conflict markers.
    *   Passes the conflicted files to `gemini` CLI with the `principal-engineer` persona to resolve.
    *   Commits and pushes the resolution.
4.  **Merge**: Once approved and CI passes, ZFG merges the PR (`gh pr merge --squash --delete-branch`).

### Step 5: Finalization (Agent-ZFG)
1.  Once all phases from `.phase-ids.json` are merged, ZFG runs `.agent/workflows/review-uat.md` on the compiled WIP branch.
2.  ZFG runs `specs/<feature>/gates/run-all-gates.sh` locally.
3.  ZFG opens the final PR from `feature/<feature_name>-wip` to `develop`.

---

## 5. Implementation Roadmap (Tasks for LLM)

To actualize this specification in the repository, the following components must be created or modified by the LLM:

### 5.1. `scripts/dev/agent-zfg.sh` (NEW)
*   **Purpose**: The master orchestrator script for ZFG.
*   **Requirements**:
    *   Parse `.phase-ids.json` and manage git branch scaffolding.
    *   Compile context and dispatch CodeX Lab agents (using `gh`).
    *   Run a background polling loop using `gh pr list --base feature/*-wip`.
    *   Automate conflict resolution by piping `git diff` with conflict markers to the `gemini` CLI.

### 5.2. `scripts/dev/work-until-done.sh` (UPDATE)
*   **Purpose**: The core loop for Cloud Agents.
*   **Requirements**:
    *   Must run entirely headlessly (no user prompts).
    *   Integrate `.agent/workflows/define-tests.md` and `.agent/workflows/implement.md`.
    *   Automatically trigger `gh pr create` using `.specify/templates/review-code-comment-template.md` upon successful verification.

### 5.3. `Makefile` (UPDATE)
*   **Requirements**:
    *   Add `agent-zfg`: Triggers the end-to-end orchestration process.
    *   Add `zfg-monitor`: A standalone command to run the PR polling and conflict resolution loop.

### 5.4. Context Compaction (`.specify/scripts/bash/update-agent-context.sh`)
*   **Requirements**:
    *   Ensure the script can generate a single, concatenated Markdown string containing the Persona, Rules, Monorepo Context, and the specific Phase task. This payload is required to successfully boot a "blind" CodeX Lab instance.