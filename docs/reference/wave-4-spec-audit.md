# Wave 4 Cross-Spec Governance Audit

> **Status:** Resolved & Consolidated (2026-03-19)
> **Scope:** F005 (Parallel Dispatch), F011 (Harvest), F014 (Plugin System)
> **Goal:** Identify and resolve critical architectural fractures prior to Stage 3 Implementation.

---

## Part 1: The Ambiguity Report

The specifications initially failed the Integrative pass. While individually coherent, cross-referencing them revealed three critical fractures in system boundaries, event lifecycles, and dependency ordering.

1. **F005 violently conflicts with its own architectural input (R001)** regarding merge ownership and conflict resolution.
2. **F005's parallelization breaks F011's linear sequence**, creating a 1:N mapping problem for Harvest triggers.
3. **F005 mandates an implementation (Cloud Agents)** that F014 explicitly forbids in Phase 1, creating a dependency paradox.

### Fracture 1: The Merge Ownership Collision

**The Conflict:** `005-parallel-dispatch` claims it owns GitHub PR merging, serialized locking, and conflict resolution. This directly violates [parallel-dispatch-architecture.md](file:///Users/gonzo/Code/gwrk/docs/reference/parallel-dispatch-architecture.md) (R001), which dictates F005 *only* creates the PRs, leaving F004 (Ship Loop) to own code review, UAT, merging, and conflict resolution.

*   **F005 Spec (US-003, FR-004, FR-007):** "System MUST serialize completed sandbox work back to the feature branch... maintaining a lock... System MUST detect merge conflicts... On conflict, it MUST pull... dispatch a targeted resolve conflict prompt and retry." 
*   **R001 Reference:** "Decision: Merge is via GitHub PR. F005 does NOT own merge conflict resolution... F005 scope is dispatch + sandbox lifecycle only: create worktree → spawn agent → push branch → create PR → cleanup worktree."

**The Risk:** Implementing F005 as written will build a complex, brittle, redundant merge-conflict-resolution engine inside the dispatch layer, completely circumventing the standard Ship Loop (F004) process.

### Fracture 2: The Harvest Trigger Mismatch

**The Conflict:** `011-harvest` triggers its "Done, Done!" sequence upon a single PR merge webhook. However, `005-parallel-dispatch` breaks a single phase into multiple concurrent sandboxes, resulting in *multiple* PRs per phase.

*   **F005 Spec (FR-004):** Each dispatched task operates in an isolated sandbox (`sandbox/<feature>-<task>-<uuid>`). Each sandbox creates its own PR against the feature branch.
*   **F011 Spec (FR-H01, FR-H08):** Triggered by GitHub webhook on `pull_request.closed` where `merged: true`. Extracts the feature/phase name and invokes the harvest pipeline, finalizing the DB record, calculating compression, and deleting the branch.

**The Risk:** If a phase dispatches 3 parallel tasks, it generates 3 PRs. When the *first* PR merges, Harvest will trigger, prematurely closing the database execution records, finalizing the phase context, and shouting "Done, Done!" in Slack—while 2 PRs are still pending. F011 currently lacks the concept of "Phase Conclusion" vs "Task Conclusion".

### Fracture 3: The Cloud Dispatch Ordering Paradox

**The Conflict:** F005 requires the implementation of Cloud CLI execution (`github-integration` mode), but F014 explicitly defers this capability to a future phase, forbidding its structural inclusion in Phase 1.

*   **F005 Spec (FR-008):** "MUST support diverse dispatch strategies... Local CLI agents (`local-cli`)... Cloud agents (`github-integration`) MUST execute by pushing sandbox commits to remote and creating/tagging draft PRs..."
*   **F014 Spec (FR-L1-007) & R002 / ADR-006:** "F014 Phase 1 MUST only support `dispatchMode: local-cli`. The `github-integration` mode (Codex Cloud) is a separate feature and MUST NOT block Phase 1."

**The Risk:** If F005 development strictly follows the spec, developers will be blocked trying to implement `github-integration` logic into the F014 `AgentBackend` interface, which doesn't structurally support it yet. This breaks the implementation sequencing outlined in [000-build-plan.md](file:///Users/gonzo/Code/gwrk/specs/000-build-plan.md).

---

## Part 2: Remediation & Architectural Consensus

Following a peer review from the R001 (Parallel Dispatch Architecture) perspective, the fractures and their associated deep research questions have been architecturally resolved. The consensus dictates the following mandates for the upcoming spec cascading:

### 1. Remedies for the 3 Fractures

#### Fracture 1: The Merge Ownership Collision (F005 vs R001/F004)
**The Remedy (Wider System - F005 Rewrite):**
The F005 spec MUST be aggressively pared down. F005's scope is purely **Dispatch & PR Creation**, ending its lifecycle the moment `gh pr create` completes. It must not attempt to lock branches or resolve conflicts.
*   **Impact on R002:** R002 is correctly isolated. R002 dictates that `AgentBackend` plugins end their lifecycle by returning a `TaskResult` (parsed from exit codes). Merging is explicitly an orchestrator concern outside the agent plugin layer.

#### Fracture 2: The Harvest Trigger Mismatch (F011 vs F005)
**The Remedy (Wider System - F011 & F005 Update):**
F011 Harvest currently operates on a simple `1 Phase = 1 PR` assumption. With parallel dispatch, we have a `1 Phase = N Tasks = N PRs` reality. 
*   **Impact on F011 Spec:** F011 must introduce the concept of **Phase State vs. Task State**. Harvest can only shout "Done, Done!" and finalize the phase when all sub-task PRs belonging to that phase are merged. A Phase is an aggregate of Tasks.

#### Fracture 3: The Cloud Dispatch Ordering Paradox (F005 vs F014/R002)
**The Remedy (R002 Draft & F005 Rewrite):**
F005 defines `github-integration` agents as required, while F014 explicitly defers them because the interface doesn't support async webhooks yet.
*   **Impact on F005 Spec:** Downgrade `github-integration` from a mandatory Phase 1 requirement to a Future Supported Capability. F005 Phase 1 MUST only dispatch against local CLI backends.
*   **Impact on R002 Draft:** Reinforce the exact phase boundary in R002 §8. The F014 Phase 1 `AgentBackend` interface only supports `LocalDispatchResult`. `CloudDispatchResult` requires asynchronous daemon state tracking that does not yet exist.

### 2. Resolution of Research Questions

#### Q1: The Parallel Git Rebase Collision Problem
> *If 3 tasks dispatch in parallel and create 3 separate PRs, merging PR #1 will inevitably trigger conflict states in PR #2 and PR #3 because they branch from the same base commit.*
*   **R001 Consensus:** This is an accepted, natural consequence of parallel git workflows. F005 deliberately delegates this friction to the F004 Ship Loop. Once PR #1 merges, GitHub will UI-flag PR #2 and #3 as conflicted. The developer (or an agent-assisted "rebase and resolve" command in F004) will update the branch via GitHub's "Update branch" or local `git pull --rebase`. F005 does not need a cascading rebase strategy.

#### Q2: Asynchronous Cloud State Tracking (The F014 / F005 Gap)
> *If Cloud agents return an `issueNumber` rather than a process, what subsystem owns the polling/webhook processing for Harvest?*
*   **R001 Consensus:** Moot for Phase 1. By firmly deferring Cloud Agents out of the MVP (resolving Fracture 3), this is deferred. When Tier 3 is built, the gwrk daemon will listen for `pull_request.opened` webhooks tied to the issue number. There is no active polling. F014 will be neatly extended to handle `CloudDispatchResult` at that time.

#### Q3: Config Ownership Overlap in Parallel Sandboxes
> *If concurrent agents mutate `.gemini` settings, does `AgentBackend.dispatch()` need isolation semantics?*
*   **R001 Consensus:** Repo-level config mutations (inside the sandbox's `.gwrk/` directory) are inherently isolated per-sandbox by the Git worktrees. However, mutating global user directories (e.g., `~/.gemini/`) concurrently will cause race conditions and state corruption.
*   **Mandate for F014:** The F014 spec MUST enforce a strict isolation rule: **`AgentBackend` plugins are strictly confined to mutating state WITHIN the provided `projectRoot` (the sandbox worktree path).** Plugins MUST NOT initiate global filesystem side-effects during dispatch.

---

## Part 3: Final Required Actions

To conclude this ambiguity resolution phase before beginning implementation, the following concrete spec updates must be executed:

1.  **F005 Spec (Parallel Dispatch):**
    *   Delete all FRs mandating merge locks or conflict resolution (FR-004, FR-007, US-003). Scoped strictly to PR Creation.
    *   Defer Cloud Agents (`github-integration`) to Tier 3. Phase 1 is `local-cli` only.
2.  **F011 Spec (Harvest):**
    *   Update trigger logic: Harvest MUST NOT trigger on Sandbox PRs targeting `feat/*`. Harvest only triggers on Phase Rollup PR merges into `main` or `develop` (or when explicitly calculating task completion count).
3.  **F014 Spec (Plugin System):**
    *   Encode the "Strict Isolation Rule" for AgentBackends: No global state mutation during `.dispatch()`. Config changes must stay within the sandbox `projectRoot`.
