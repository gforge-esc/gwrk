# Codex Web Integration & Agent Orchestration Specification

This document serves as the comprehensive architectural blueprint for integrating **Codex Web/Lab** into the repository's execution workflows. It combines the required manual setup procedures for Codex Web with the architectural specification for the `agent-zfg` (Local Orchestrator) and `agent-wud` (Cloud Worker) multi-agent workflow.

## Part 1: Codex Web & Codex Lab Reference Documentation

Codex Web (Codex Lab) provides an isolated, ephemeral cloud microVM for autonomous AI coding agents. To successfully offload tasks to these cloud agents, the environment must be properly configured and invoked.

### 1.1 Manual Project Setup Requirements
Before an orchestrator script can dispatch tasks to Codex Web, the project must be manually configured in the Codex Web UI to handle your specific monorepo setup:

1.  **Repository Linking**: The target GitHub repository must be connected to the Codex workspace. The Codex GitHub App requires Read/Write access to code, commit statuses, and pull requests.
2.  **Environment Setup**: 
    *   The base Docker image or environment must be selected (e.g., Node/Ubuntu).
    *   **Setup Commands**: You must explicitly define the setup commands in the project settings. For this monorepo, the agent must run these upon booting the microVM to link workspaces properly:
        ```bash
        npm install -g pnpm@latest
        pnpm install --frozen-lockfile
        pnpm turbo run build
        ```
3.  **Environment Variables**: Any required secrets (e.g., LLM API keys, test database URLs) must be added manually to the Codex Web project settings. These are injected securely into the cloud agent's environment. The agent cannot read your local `.env.local` file.
4.  **Global Directives (`AGENTS.md`)**: Codex automatically reads `AGENTS.md` at the root of the repo. This file should contain global rules (e.g., "Always use pnpm", "Never use interactive prompts").

### 1.2 Execution Environment Capabilities & Constraints
*   **Ephemerality**: The cloud sandbox is stateless. If the agent finishes a turn without pushing code to a remote branch, the work is lost.
*   **Headless Terminal**: The agent executes bash commands natively. However, it cannot interact with TTY prompts (e.g., it will hang if a script asks `[y/N]`). All commands executed in the cloud *must* use non-interactive flags (like `CI=true`).
*   **Context Compaction**: Codex manages its own context window. During long `work-until-done` test loops, it will automatically summarize older terminal outputs.
*   **Authentication**: The GitHub CLI (`gh`) is pre-authenticated in the sandbox if the workspace is properly linked, allowing the agent to open PRs seamlessly.

### 1.3 CLI Invocation for Cloud Execution
To dispatch a cloud agent programmatically from a local script, the Codex CLI is used. The orchestrator must pass the compiled context and specify the target branch.

```bash
# Example invocation used by the orchestrator to trigger a cloud worker
codex run --cloud \
  --repo "<org>/<repo>" \
  --branch "phase/<feature-name>-<phase-id>" \
  --prompt-file ".specify/memory/compiled-context.md" \
  --non-interactive \
  --full-auto

```

---

## Part 2: Orchestration Architecture (`agent-zfg` & `agent-wud`)

The objective is to farm out feature development into parallelizable phases. This requires two distinct agent personas operating in different environments.

### 2.1 Agent-ZFG (Zero F*cks Given) - The Local Orchestrator

* **Environment**: Runs strictly on the local machine via `bash`, `make`, `gh` (GitHub CLI), and the `gemini` CLI.
* **Personas**: Uses `.agent/prompts/personas/principal-engineer.md` and `product-manager.md`.
* **Role**: The mastermind. It does not write standard feature code. It plans, delegates, manages Git branches, monitors GitHub, and forcefully resolves merge conflicts to drive the feature to completion.

### 2.2 Agent-WUD (Work Until Done) - The Cloud Worker

* **Environment**: Runs in the Codex Web Cloud Sandbox.
* **Personas**: Uses `.agent/prompts/personas/senior-dev.md`.
* **Role**: The ephemeral worker. It boots up, reads its specific phase instructions, writes code, runs local tests via `scripts/dev/work-until-done.sh`, loops until tests pass, opens a Pull Request, and terminates.

### 2.3 Git Branching Model

To support parallel cloud execution without blocking, ZFG enforces a strict hierarchical branching strategy:

1. **`develop`**: The main repository integration branch.
2. **`feature/<feature-name>-wip`**: Owned by ZFG. Created from `develop`. This is the integration target for all WUD phase PRs. ZFG also commits its own local work here.
3. **`phase/<feature-name>-<phase-id>`**: Owned by WUD. Created from the `wip` branch. This is the isolated workspace where a cloud agent works on a specific bead/phase.

---

## Part 3: Execution Workflow

### Step 1: Feature Initialization & Planning (Local / ZFG)

1. **Trigger**: User runs `make agent-zfg FEATURE=<feature_name>`.
2. **Scaffolding**: ZFG creates `feature/<feature_name>-wip` from `develop` and pushes it to `origin`.
3. **Planning**: ZFG analyzes `specs/<feature>/spec.md` using `.agent/workflows/plan-to-beads.md`.
4. **Output**: ZFG generates atomic phase scripts (e.g., `specs/<feature>/beads/01-phase-1-tasks.sh`) and records the phase IDs in `.phase-ids.json`.

### Step 2: Delegation & Dispatch (Local -> Cloud)

For each phase listed in `.phase-ids.json` designated for a cloud agent:

1. ZFG creates `phase/<feature_name>-<phase-id>` from the WIP branch and pushes it to `origin`.
2. ZFG uses `.specify/scripts/bash/update-agent-context.sh` to compile a single prompt payload containing the Persona, Rules, Monorepo Context, and the specific phase task.
3. ZFG dispatches the cloud agent using the `codex run --cloud` CLI command (or by creating a GitHub issue that triggers a Codex webhook, depending on integration preference).

### Step 3: Work-Until-Done Loop (Cloud / WUD)

1. **Boot**: Codex Lab initializes the environment (running manual setup commands like `pnpm install`).
2. **Implementation**: WUD executes `.agent/workflows/implement.md` based on its injected payload.
3. **Verification**: WUD runs `scripts/dev/work-until-done.sh` headlessly. If tests fail, it uses `.agent/workflows/analyze.md` to diagnose and fix. It loops until the exit code is `0`.
4. **Delivery**: Once passing, WUD commits the code, pushes to `origin`, and uses the pre-authenticated `gh` CLI to open a PR against `feature/<feature_name>-wip`. WUD then terminates.

### Step 4: Monitoring & Conflict Resolution (Local / ZFG)

ZFG runs a local polling loop (e.g., `gh pr list --base feature/<feature_name>-wip`):

1. **Detect**: ZFG detects an open PR targeting the WIP branch.
2. **Review**: ZFG evaluates the code using `.agent/workflows/review-code.md` via the local `gemini` CLI.
3. **Conflict Resolution (The "ZFG" mechanism)**: If GitHub reports merge conflicts:
* ZFG checks out the `phase` branch locally.
* ZFG runs `git merge origin/feature/<feature_name>-wip` to intentionally generate Git conflict markers in the files.
* ZFG pipes the conflicted files into the `gemini` CLI, instructing the `principal-engineer` persona to resolve the markers.
* ZFG commits the resolved files and pushes them back to the phase branch.


4. **Merge**: Once CI passes and conflicts are clear, ZFG executes `gh pr merge --squash --delete-branch`.

### Step 5: Finalization (Local / ZFG)

1. Once all phases in `.phase-ids.json` are merged into the WIP branch, ZFG checks out the WIP branch locally.
2. ZFG runs `.agent/workflows/review-uat.md` and `specs/<feature>/gates/run-all-gates.sh` to ensure holistic feature integrity.
3. ZFG opens the final PR from `feature/<feature_name>-wip` to `develop`.

---

## Part 4: Implementation Blueprint (For LLM / Script Generation)

To implement this specification, the following files must be created or updated within the repository:

### 4.1. Create `scripts/dev/agent-zfg.sh`

* **Purpose**: The master orchestrator script.
* **Requirements**:
* Parse `specs/<feature>/beads/.phase-ids.json`.
* Handle Git branch creation (`wip` and `phase` branches) and push to origin.
* Invoke `.specify/scripts/bash/update-agent-context.sh` to build payloads.
* Dispatch cloud workers via `codex run --cloud`.
* Contain a background `while` loop that queries `gh pr list --json mergeStateStatus,headRefName`.
* Implement the automated Git merge conflict resolution flow using `git diff` and the `gemini` CLI.



### 4.2. Update `scripts/dev/work-until-done.sh`

* **Purpose**: The cloud execution loop for Agent-WUD.
* **Requirements**:
* Ensure strict non-interactive execution (e.g., `CI=true`).
* Tie directly into `.agent/workflows/implement.md` and `.agent/workflows/analyze.md`.
* Add a final step that automatically executes `git push` and `gh pr create --base feature/<feature>-wip --body-file .specify/templates/review-code-comment-template.md` on success.



### 4.3. Update `Makefile`

* **Requirements**:
* Add `agent-zfg FEATURE=<name>`: Triggers the end-to-end orchestration process.
* Add `zfg-monitor FEATURE=<name>`: A standalone target to run the PR polling and conflict resolution loop in case the main process is interrupted.



### 4.4. Update `.specify/scripts/bash/update-agent-context.sh`

* **Requirements**:
* Ensure the script concatenates the target Persona, `.agent/rules/*.md`, `.agent/templates/monorepo-context.md`, and the specific Phase `.sh`/`.md` task into a single string/file. This compiled file is what is passed to `--prompt-file` in the Codex CLI so the cloud agent boots with full context.



