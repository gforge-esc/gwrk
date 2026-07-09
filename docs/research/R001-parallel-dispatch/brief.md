# Research Initiative: R001 — Parallel Dispatch Architecture
status: COMPLETED

> **Status:** Brief — Awaiting Approval
> **Consumer:** F005 spec rewrite, architecture.md v5.0
> **Output:** `docs/reference/parallel-dispatch-architecture.md`

---

## Objective

Resolve the sandbox and parallel dispatch model for F005 before specification begins. The current F005 spec (2026-03-10) references retired F008 and a pre-ADR-006 dispatch model. The fundamental architectural question — how does gwrk run N agents concurrently on the same codebase without corruption? — has no research backing.

---

## Questions to Answer

### Q1: Sandbox Model

What isolation mechanism should F005 use for concurrent local dispatch?

| Candidate | Startup | Disk | Isolation | Git Safety | Codex Cloud Compat |
|-----------|---------|------|-----------|------------|-------------------|
| Docker containers | ~30s | High (full image) | Full | N/A (separate FS) | ? |
| Git worktrees | ~1s | Low (shared .git) | Partial (shared .git) | ? | N/A (local only) |
| Local clones (`--reference`) | ~5s | Medium (shared objects) | Full | Full | N/A (local only) |

**Must answer:**
- Can two git worktrees of the same repo run `git commit` simultaneously without `.git/index.lock` collisions?
- Does `git worktree add` support concurrent adds from the same parent?
- What are the failure modes when a worktree is removed while another is mid-commit?

### Q2: Codex Cloud Parallel Lifecycle

How does the orchestrator manage N concurrent Codex Cloud dispatches?

**Must answer:**
- What happens after `codex exec --full-auto` is called from a cloud VM? Does it return synchronously or fire-and-forget?
- How does the orchestrator know when a cloud dispatch completes? Polling? Webhook? Git event?
- What is the result artifact from a Codex Cloud run? (stdout/stderr capture? PR? Branch push?)
- Can multiple Codex Cloud VMs work on the same repo concurrently? Branch isolation?

### Q3: Merge Serialization

How are completed sandboxes merged back to the feature branch?

**Must answer:**
- File locks vs advisory locks vs in-memory queue — which mechanism serializes merges?
- What does `git-manager.ts` already support? (Read the actual code.)
- Rebase vs merge commit — which strategy for sandbox results?
- What happens when sandbox A's merge succeeds but introduces a conflict for sandbox B's pending merge?
- Should sandboxes rebase onto latest feature branch before their merge attempt?

### Q4: Resource Gating & AgentBackend Interaction

Who owns capacity limits — the orchestrator config or the `AgentBackend` adapter manifest?

**Must answer:**
- Does the `AgentBackend` manifest declare `maxConcurrent` (the adapter knows its own limits)?
- Or does `.gwrkrc.json → agents.parallelism` control it (the operator configures limits)?
- Or both (adapter declares default, operator overrides)?
- How does F005's capacity gate interact with F014 P4's routing intelligence (future)?

---

## Input Documents

The agent executing this research MUST read and synthesize these sources:

### Primary (read in full)
1. `docs/architecture.md` — §6.1 (Dispatch Boundary), §6.2 (Ship Loop), §9 (Branching Model)
2. `docs/decisions/ADR-006-plugin-agent-backends.md` — `AgentBackend` interface, dispatch contract
3. `specs/005-parallel-dispatch/spec.md` — current spec (staleness analysis target)
4. `specs/004-ship-loop/spec.md` — Ship Loop contracts (handoff point for F005)
5. `docs/reference/cli-backend-research-report.md` — Backend invocation patterns

### Codebase (read actual implementation)
6. `src/utils/agent.ts` — current `dispatchToAgent()` facade
7. `src/server/dispatch.ts` — current dispatch queue
8. `src/server/git-manager.ts` — current branch/merge operations
9. `src/server/sandbox.ts` — current sandbox manager (if exists)
10. `scripts/dev/work-until-done.sh` — current Ship Loop orchestrator
11. `.gwrkrc.json` — current agent config (parallelism section)

### External (research as needed)
12. Git worktree documentation — concurrency safety, limitations
13. Codex CLI documentation — `codex exec` lifecycle, cloud VM behavior

---

## Output Contract

The research document MUST produce:

1. **Trade-off matrix** — Sandbox models scored across: startup time, disk cost, isolation level, git safety, Codex Cloud compatibility, implementation complexity
2. **Recommended sandbox model** — with rationale anchored to gwrk's constraints (single operator, macOS, <10 concurrent agents)
3. **Orchestrator architecture diagram** — showing the dispatch flow for mixed local + cloud backends
4. **Merge serialization design** — concrete mechanism with failure mode analysis
5. **Resource gating contract** — who declares what, how it's enforced, interaction with `AgentBackend`
6. **F005 spec alignment notes** — explicit list of what changes in F005 spec (retired references, new contracts, new data model)
7. **Architecture.md amendments** — specific text for architecture.md v5.0 updates

---

## Anti-Patterns

- ❌ Do NOT spec F005 in this document — this is research. The spec consumes this.
- ❌ Do NOT invent abstractions without reading the existing code first
- ❌ Do NOT assume Docker is the sandbox model — evaluate alternatives with evidence
- ❌ Do NOT hand-wave Codex Cloud lifecycle — cite actual CLI behavior or flag as unknown
- ❌ Do NOT design the F014 plugin system — that's R002's scope
