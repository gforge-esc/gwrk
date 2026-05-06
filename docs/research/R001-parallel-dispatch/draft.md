# R001 — Parallel Dispatch Architecture

> **Status:** Draft v3 — All open items resolved per reviewer decisions
> **Initiative:** [R001 brief](file:///Users/gonzo/Code/gwrk/docs/research/R001-parallel-dispatch/brief.md)
> **Consumer:** F005 spec rewrite, architecture.md v5.0

---

## Executive Summary

This research resolves the fundamental architectural question behind F005: *how does gwrk run N agents concurrently on the same codebase without corruption?*

**Three findings drive the design:**

1. **Git worktrees are the simplest local-only sandbox.** Per-worktree index isolation, ~1s startup, zero deps. Docker is viable (0.21s warm, Oct 2025) but pushed to backlog — worktrees are the MVP path.

2. **The merge procedure is always GitHub PR + Harvest.** Even for local worktree sandboxes, each completed sandbox produces a PR. The Ship Loop (004) dispatches work → agents work in sandboxes → each sandbox's result becomes a PR → code review → UAT → merge → Harvest (011) fires on merge. F005 parallelizes dispatch; it does NOT change the merge-to-done-done lifecycle.

3. **Dispatch calls `gwrk ship`, not shell scripts.** Clean hexagonal architecture — the orchestrator dispatches via `gwrk` commands, not `work-until-done.sh`. Codex Cloud (and any dispatched backend) must be able to use gwrk either as installed on start or shipped air-gapped within the project repo.

4. **Codex Cloud is a separate feature.** F005 must not foreclose or make Codex Cloud integration more difficult, but Codex Cloud dispatch is architecturally distinct and will be a separate feature. See [Codex Cloud Research Report](file:///Users/gonzo/Code/gwrk/docs/reference/codex-cloud-research-report.md).

**Implementation tiers (phased rollout):**
| Tier | Capability | Backend | Sandbox Model | Feature |
|------|-----------|---------|---------------|----------|
| **Tier 1** | Multi-dispatch with default backend | Gemini (local) | Git worktrees | F005 |
| **Tier 2** | Multi-dispatch with all local CLIs | Gemini + Claude + Codex (local) | Git worktrees | F005 |
| **Tier 3** | Dispatch via Codex Cloud | Codex Cloud (web/GitHub) | Codex-managed cloud container | **Separate feature** |

---

## Q1: Sandbox Model

### Findings

**Current state:** `src/server/sandbox.ts` (134 lines) uses Dockerode to create Docker containers with the host repo bind-mounted at `/workspace`. This is fundamentally broken for parallel dispatch:

- **No isolation**: All sandboxes share the same bind-mount (`${projectRoot}:/workspace`). Concurrent file writes corrupt each other.
- **Source**: [sandbox.ts L36–53](file:///Users/gonzo/Code/gwrk/src/server/sandbox.ts#L36-L53) — `createSandbox()` passes `Binds: [\`${projectRoot}:/workspace\`]`.

**Docker startup times (corrected):**
The 30s figure in draft v1 was stale — it reflected cold image pull + first start. Actual benchmarks (Oct 2025, Docker Desktop on Apple Silicon):
- **Minimal container startup: 0.21s** (benchmark by repoflow.io, Docker Desktop vs OrbStack vs Apple Container)
- Docker Desktop 4.23+ achieved 75% reduction in startup time
- VirtioFS file sharing reduces filesystem operation times by up to 98%
- Docker VMM for Apple Silicon (Docker Desktop 4.35+) further improves performance

> **Decision from reviewer**: Docker pushed to backlog. Worktrees are the MVP. Docker remains a viable future candidate but current `sandbox.ts` code should be deleted — no dead code.

**Candidate evaluation (corrected):**

| Criterion | Docker Containers | Git Worktrees | Local Clones (`--reference`) |
|-----------|-------------------|---------------|------------------------------|
| **Startup time** | ~0.2s warm, ~5-10s cold (image pull) | ~1s (`git worktree add`) | ~5s (full clone, shared objects) |
| **Disk cost** | Medium (layers cached, but per-container overhead) | Low (shared `.git`, only working files) | Medium (working files + partial `.git`) |
| **Isolation** | Full filesystem + process | Per-worktree index + working dir, shared `.git` objects | Full isolation (separate `.git`) |
| **Git safety** | ✅ (separate filesystem, own `.git`) | ✅ Per-worktree `index.lock` — concurrent commits safe | ✅ Full — independent repos |
| **Network isolation** | ✅ (Docker networking) | ❌ (same host, shared network) | ❌ (same host) |
| **Impl complexity** | Medium (Dockerode dep, image management) | Low (~50 LOC, zero deps) | Medium (~80 LOC, zero deps) |
| **macOS dependency** | Docker Desktop required | ✅ Native git | ✅ Native git |
| **Agent CLI compat** | ❓ Requires CLI installed in container | ✅ CLIs already on host | ✅ CLIs already on host |

**Git worktree concurrency evidence:**

- Each worktree has its own independent index file and `HEAD` pointer. The `index.lock` in one worktree protects only that worktree's index.
- Operations that affect the working tree (`git add`, `git commit`, `git checkout`) are isolated per-worktree.
- Shared `.git` operations (`git fetch`, `git gc`) are internally safe for concurrent execution.
- **Constraint**: Two worktrees cannot check out the same branch simultaneously. Each sandbox must operate on its own branch (e.g., `sandbox/<feature>-<task>-<uuid>`).
- **Failure mode**: If a worktree is removed while another is mid-commit, the mid-commit completes normally (worktree removal doesn't affect other worktrees' in-progress operations).

### Recommendation

**Tier 1/2: Git worktrees for local dispatch (MVP).** Rationale:
1. Zero external dependency — aligns with gwrk's local-first, no-phone-home mandate
2. Agent CLIs (gemini, claude, codex) are already on the host PATH — no container image management
3. Per-worktree index isolation is sufficient for concurrent agent execution
4. Implementation is ~50 LOC
5. Strictly local-only — which is the correct scope for Tier 1/2

**Docker: pushed to backlog.** Rationale:
1. 0.21s warm startup IS competitive — numbers don't lie
2. Full filesystem + process isolation is valuable for hardened mode
3. BUT: requires Docker Desktop, requires agent CLIs in container image, adds complexity
4. **Decision**: Delete current `sandbox.ts`. Docker-based sandboxes are a backlog item, not F005 scope. F005 worktree implementation must not foreclose Docker as a future sandbox provider (use `SandboxFactory` interface).

**Worktree layout:**

```
.runs/sandboxes/
├── <feature>-<taskId>-<short-uuid>/     # git worktree
│   ├── (full working tree)
│   └── .git -> ../../.git/worktrees/... # symlink to shared .git
```

**Branch per sandbox:**

```
sandbox/<feature>-<taskId>-<short-uuid>
```

Each sandbox worktree checks out its own ephemeral branch, forked from the feature branch HEAD. After task completion, the sandbox branch is merged back and both worktree and branch are cleaned up.

---

## Q2: Codex Cloud Parallel Lifecycle

> **Comprehensive reference**: See [Codex Cloud Research Report](file:///Users/gonzo/Code/gwrk/docs/reference/codex-cloud-research-report.md) for full platform documentation including environment configuration, container image details ([openai/codex-universal](https://github.com/openai/codex-universal)), pricing, security model, and gwrk integration architecture.

### Findings — Corrected

> **Critical correction from reviewer**: Codex Cloud is NOT a CLI command. There is no `codex cloud exec`. Codex Cloud operates exclusively through web and integration surfaces.

**Codex Cloud entry points** (source: [developers.openai.com/codex/cloud](https://developers.openai.com/codex/cloud)):

| Entry Point | Trigger | Result Delivery |
|-------------|---------|-----------------|
| **Web UI** | chatgpt.com/codex → submit task | Diff view → "Open PR" button |
| **GitHub** | `@codex <prompt>` in issue/PR comment | Codex reacts 👀 → creates cloud task → posts changes as PR or commit | 
| **Slack** | `@Codex <prompt>` in channel/thread | Codex reacts 👀 → creates cloud task → posts result link + optional answer |
| **IDE Extension** | Cloud icon → select environment → submit prompt | Cloud thread carries IDE context → diff → PR |

**Cloud task lifecycle** (source: [developers.openai.com/codex/cloud/environments](https://developers.openai.com/codex/cloud/environments)):

```
1. Container created from `codex-universal` image (or custom)
2. Repo checked out at selected branch/commit SHA
3. Setup script runs (with internet access)
4. Agent internet access settings applied (off by default)
5. Agent loop: edits code, runs checks, validates work
   (Uses AGENTS.md for project-specific lint/test commands)
6. Agent finishes → shows diff
7. User opens PR or pulls changes locally
```

**Container caching**: Codex caches container state for up to 12 hours. Cached containers skip setup on subsequent tasks.

**Key insight for gwrk**: Codex Cloud tasks produce **diffs and PRs** on repository branches. They do NOT push to arbitrary branches. The integration model for gwrk is:

1. **Dispatch**: gwrk creates a GitHub issue (or PR comment) containing `@codex <prompt>` with full task context
2. **Execution**: Codex Cloud spins up container, runs task, produces diff
3. **Completion detection**: gwrk detects completion via GitHub webhook (`pull_request.opened` or `issue_comment` events)  
4. **Result**: PR with agent's changes → feeds into merge serialization

**gwrk's Codex Cloud integration is a GitHub-integration adapter**, not a local CLI spawn.

### Local CLI Dispatch (Tier 1/2)

Local dispatch for **all three CLIs** is synchronous: the CLI process blocks until the agent completes:

- `gemini -p "<prompt>" --yolo` — blocks, returns exit code + output
- `claude -p "<prompt>" --dangerously-skip-permissions` — blocks, returns exit code + output
- `codex exec --full-auto "<prompt>"` — blocks, returns exit code + output

**Source**: Current implementation in [agent.ts L152–161](file:///Users/gonzo/Code/gwrk/src/utils/agent.ts#L152-L161) — `child_process.spawn()` → `await child.close`.

The orchestrator `await`s each local CLI process. Multiple concurrent spawns into separate worktrees = parallel local dispatch.

### Recommendation

**Tier 1/2** (local dispatch): No change to dispatch model — just add worktree creation before spawn and merge queue after completion.

**Codex Cloud (separate feature, not F005)**: See [Codex Cloud Research Report](file:///Users/gonzo/Code/gwrk/docs/reference/codex-cloud-research-report.md) §7 for full integration architecture. F005's `AgentBackend` interface must not foreclose Codex Cloud by assuming all backends are local CLI spawns — the interface needs a `dispatchMode` discriminator.

---

## Q3: Merge Serialization — GitHub PR + Harvest

### Ship Loop / Harvest Boundary

The [011-harvest spec](file:///Users/gonzo/Code/gwrk/specs/011-harvest/spec.md) establishes a critical boundary:

| Motion | Feature | Starts At | Ends At |
|--------|---------|-----------|---------|
| **Dispatch** (Ship Loop) | 004 | `gwrk ship` invocation | PR issued + Slack notification (steps 1-7) |
| **Done Done** (Harvest) | 011 | PR merged (GitHub webhook) | Logs rehomed, DB finalized, compression calculated, Slack 🏆 |

> **Reviewer decision**: The merge procedure is **always GitHub PR + Harvest**, even for local worktree sandboxes. There is no direct `git merge` back to the feature branch.

### Corrected Merge Model

**Each sandbox produces a PR.** The merge lifecycle is:

```
1. Orchestrator dispatches N agents into N worktree sandboxes
2. Each agent works on sandbox/<feature>-<task>-<uuid> branch
3. Agent completes → sandbox branch pushed to origin
4. gwrk creates PR from sandbox branch → feat/<feature>
5. Ship Loop (004): code review → UAT → PR merge
6. Harvest (011): triggered by PR merge webhook
   → Logs rehomed, DB finalized, compression calculated, Slack 🏆
```

This means:
- **F005 does NOT need a `MergeQueue` or `AsyncMutex`** — GitHub handles merge serialization via PR merge
- **F005 does NOT own merge conflict resolution** — PR conflicts are resolved in the review step of Ship Loop (004)
- **F005 scope is dispatch + sandbox lifecycle only**: create worktree → spawn agent → push branch → create PR → cleanup worktree

### What F005 DOES own

| Responsibility | F005 | F004 (Ship Loop) | F011 (Harvest) |
|---------------|:---:|:---:|:---:|
| Create sandbox worktree | ✅ | | |
| Fork sandbox branch | ✅ | | |
| Dispatch agent into sandbox | ✅ | | |
| Push sandbox branch to origin | ✅ | | |
| Create PR (sandbox → feature) | ✅ | | |
| Code review of PR | | ✅ | |
| UAT review of PR | | ✅ | |
| Merge PR | | ✅ | |
| Merge conflict resolution | | ✅ | |
| Log rehoming | | | ✅ |
| DB finalization | | | ✅ |
| Compression calculation | | | ✅ |
| Done Done notification | | | ✅ |
| Cleanup sandbox worktree + branch | ✅ | | |

### Current `git-manager.ts` problems

**Current `git-manager.ts`** ([L35–56](file:///Users/gonzo/Code/gwrk/src/server/git-manager.ts#L35-L56)) is unsafe regardless:

```typescript
mergePhaseBack(featureId, phaseId): void {
  const currentBranch = this.exec("git rev-parse --abbrev-ref HEAD");
  this.exec(`git checkout ${featureBranch}`);           // ❌ MUTATES MAIN WORKTREE
  this.exec(`git merge ${phaseBranch} --no-ff -m ...`); // ❌ NO LOCK
  this.exec(`git checkout ${currentBranch}`);            // ❌ RACE CONDITION
}
```

**This entire pattern is wrong.** Merge should not be a direct git operation in the main worktree. It should be a GitHub PR merge triggered by the Ship Loop review cycle.

**Required refactoring**: Replace `mergePhaseBack()` with `createPR()` that uses the GitHub API to create a PR from the sandbox branch to the feature branch. The Ship Loop then handles review + merge.

### Dispatch Architecture — Hexagonal Design

> **Reviewer decision**: Dispatch should call `gwrk ship`, not `work-until-done.sh`. Clean hexagonal architecture. Dispatched tasks (including Codex Cloud) must be able to use gwrk either as installed on start or shipped air-gapped within the project repo.

The orchestrator's boundary:

```
┌──────────────────────────────────────────────────────────┐
│  Parallel Dispatch Orchestrator (F005)                    │
│                                                          │
│  INPUT:  Phase task list (from plan.md / tasks.json)     │
│  OUTPUT: N PRs (sandbox → feature branch)                │
│                                                          │
│  Calls:  gwrk ship <feature> <phase> --task <taskId>     │
│          (NOT work-until-done.sh directly)                │
│                                                          │
│  Each dispatch:                                          │
│    1. Create worktree sandbox                            │
│    2. gwrk ship --task <taskId> --sandbox <path>         │
│    3. Agent works (via AgentBackend plugin)               │
│    4. Push sandbox branch                                │
│    5. Create PR (sandbox → feature)                      │
│    6. Cleanup worktree                                   │
└──────────────────────────────────────────────────────────┘
```

**Hexagonal principle**: The orchestrator knows about `gwrk` commands. It does NOT know about shell scripts, specific agent CLIs, or internal implementation details. The `gwrk ship` command is the port; the agent backend is the adapter.

**Air-gapped readiness**: Codex Cloud (and other remote dispatches) need gwrk available in the container. Two strategies:
1. **Installed on setup**: Codex Cloud setup script runs `npm install -g gwrk` (requires internet during setup, which is allowed)
2. **Shipped in repo**: `.gwrk/bin/gwrk` vendored in the repo, available without installation — true air-gapped

F005 must design the dispatch interface so BOTH strategies work. The orchestrator calls `gwrk ship`, and the command resolves to whichever binary is available.

---

## Q4: Resource Gating — Config-Driven with Sane Defaults

### Findings

> **Correction from reviewer**: `maxConcurrent` needs sane defaults grounded in what actually works. This is a config + discovered limit — not an arbitrary number from adapter manifests.

**Current config** (`.gwrkrc.json` [L21–31](file:///Users/gonzo/Code/gwrk/.gwrkrc.json#L21-L31)):

```json
"parallelism": {
  "local": { "maxCpu": 80, "maxMem": 80, "minDiskGb": 10, "maxClones": 2 },
  "cloud": { "maxConcurrent": 10 }
}
```

### Sane defaults — grounded reasoning

Local CLI agents are CPU/memory intensive. Each agent spawns a CLI process that:
- Loads a model context (~1-2GB memory for the process)
- Reads/writes files in the worktree
- May run build/test commands (pnpm test, pnpm build)

**Default `maxClones` derivation:**
- Apple Silicon Mac (M2 Pro, 16GB): 2 concurrent agents practical, 3 pushes limits
- Apple Silicon Mac (M3 Max, 64GB): 4-6 concurrent agents practical
- Resource gate (CPU 80%, mem 80%) prevents over-subscription regardless

**Recommendation: `maxClones: 2` is the correct default for Tier 1/2.** This is conservative and safe. Operators with beefier machines can increase via config. The resource health gate (CPU/mem/disk) acts as the hard ceiling regardless.

**For Codex Cloud (Tier 3)**: The Codex Cloud platform manages its own concurrency. gwrk's `maxConcurrent` for cloud is about how many simultaneous GitHub issues gwrk creates with `@codex` mentions. Default of 3 is reasonable — the bottleneck is human review of resulting PRs, not compute.

### Resource gating contract

```typescript
// .gwrkrc.json schema
interface ParallelismConfig {
  local: {
    maxClones: number;        // DEFAULT: 2. Global ceiling for ALL local agents
    maxCpu: number;           // DEFAULT: 80. % threshold
    maxMem: number;           // DEFAULT: 80. % threshold
    minDiskGb: number;        // DEFAULT: 10. Minimum free disk
  };
  cloud: {
    maxConcurrent: number;    // DEFAULT: 3. Max simultaneous Codex Cloud dispatches
  };
}
```

**Resolution**: config value → resource health gate. No adapter-declared limits. The operator's machine determines capacity — not the adapter's opinion.

**Two gates, checked in order:**

| Gate | Check | Source |
|------|-------|--------|
| **Capacity gate** | `activeLocal < config.parallelism.local.maxClones` | `.gwrkrc.json` |
| **Resource gate** | `cpu < maxCpu && mem < maxMem && disk > minDiskGb` | SystemMonitor |

If either gate fails → task queued. Queue drains when a slot opens (sandbox completes + merge finishes).

### Phased implementation

| Tier | What | Config Needed | Backend | Feature |
|------|------|---------------|---------|----------|
| **Tier 1** | Multi-dispatch with gemini | `parallelism.local.maxClones: 2` (default) | gemini (local CLI) | F005 |
| **Tier 2** | Multi-dispatch with all local CLIs | Same config; backend selection per `.gwrkrc.json.agents` | gemini + claude + codex (all local CLI) | F005 |
| **Tier 3** | Dispatch via Codex Cloud | `parallelism.cloud.maxConcurrent: 3` (default) | GitHub `@codex` integration | **Separate feature** |

**Tier 1** is the MVP and should be buildable in a single F005 phase. It proves:
- Worktree creation/cleanup lifecycle
- Concurrent `gwrk ship --task` invocations in separate worktrees
- PR creation per sandbox (replaces direct merge)
- Capacity gating from config

**Tier 2** adds backend selection — which local CLI to use per task. This composes with F014 P4 (routing intelligence) but can start with simple round-robin or `.gwrkrc.json.agents` mapping.

**Tier 3** is a **separate feature**. F005 must not foreclose it — the `AgentBackend` interface and dispatch orchestrator must support non-local backends via `dispatchMode` discriminator.

---

## Output Contract Deliverables

### 1. Trade-off Matrix

| Criterion | Docker Containers | Git Worktrees |
|-----------|:-:|:-:|
| Startup time | ⭐⭐⭐⭐⭐ (0.21s warm) | ⭐⭐⭐⭐ (1s) |
| Disk cost | ⭐⭐⭐ (cached layers) | ⭐⭐⭐⭐⭐ (shared .git) |
| Isolation level | ⭐⭐⭐⭐⭐ (full FS + process) | ⭐⭐⭐ (per-worktree index) |
| Git safety | ⭐⭐⭐⭐⭐ (separate .git) | ⭐⭐⭐⭐ (per-worktree locks) |
| External dependency | ⭐⭐ (Docker Desktop required) | ⭐⭐⭐⭐⭐ (native git) |
| Agent CLI availability | ⭐⭐ (CLIs must be in container image) | ⭐⭐⭐⭐⭐ (already on host PATH) |
| Impl complexity | ⭐⭐⭐ (~134 LOC + Dockerode dep) | ⭐⭐⭐⭐⭐ (~50 LOC, zero deps) |
| **Tier 1/2 (local MVP)** | **Needs exploratory dev** | **Recommended** |
| **Future "hardened" mode** | **Candidate** | **N/A** |

### 2. Recommended Sandbox Model

**Tier 1/2: Git worktrees** — simplest, zero-dep, local-only. Proven git concurrency model.

**Future investigation: Docker** — 0.21s warm startup makes it competitive. Needs spike to validate: (a) agent CLI availability in container, (b) file sync performance for large repos, (c) image management lifecycle. Could become "hardened" mode alongside worktrees as "fast" mode.

### 3. Orchestrator Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│  Parallel Dispatch Orchestrator (F005)                        │
│                                                              │
│  ┌────────────┐    ┌─────────────┐    ┌──────────────────┐  │
│  │ Task Queue  │──▶│ Capacity    │──▶│ Sandbox Factory   │  │
│  │ [T01..T0N]  │   │ Gate        │   │                    │  │
│  │             │   │ maxClones:2 │   │ worktree (MVP)    │  │
│  │             │   │ CPU/mem/disk│   │ docker (backlog)  │  │
│  └────────────┘    └─────────────┘   └────────┬───────────┘  │
│                                               │              │
│  ┌────────────────────────────────────────────┘              │
│  │                                                          │
│  │  ┌─────────────────────────────────────────────────────┐ │
│  │  │  Concurrent Agent Execution (per-sandbox)           │ │
│  │  │                                                     │ │
│  │  │  ┌─ Worktree Sandbox ──────────────────────────────┐│ │
│  │  │  │ .runs/sandboxes/<id>/                           ││ │
│  │  │  │  gwrk ship <feature> --task <taskId> --sandbox  ││ │
│  │  │  │  Agent works (via AgentBackend plugin)           ││ │
│  │  │  │  Push sandbox branch to origin                  ││ │
│  │  │  └──────────┬──────────────────────────────────────┘│ │
│  │  │             │                                       │ │
│  │  │             ▼                                       │ │
│  │  │  ┌──────────────────────┐                           │ │
│  │  │  │ Create PR            │                           │ │
│  │  │  │ sandbox → feat/      │                           │ │
│  │  │  │ (GitHub API)         │                           │ │
│  │  │  └────────┬─────────────┘                           │ │
│  │  └───────────┼─────────────────────────────────────────┘ │
│  │              ▼                                           │
│  │  ┌──────────────────────────────────────────────────┐   │
│  │  │  Ship Loop (004) — per-PR                        │   │
│  │  │  Code Review → UAT → PR merge                   │   │
│  │  └──────────────────────────────────────────────────┘   │
│  │              │                                           │
│  │  ─ ─ ─ ─ ─ ─│─ ─ ─ ─ ─ ─ ─ (PR merged)                │
│  │              ▼                                           │
│  │  ┌──────────────────────────────────────────────────┐   │
│  │  │  Harvest (011) — triggered by webhook            │   │
│  │  │  Logs → DB → Compression → Slack 🏆             │   │
│  │  └──────────────────────────────────────────────────┘   │
│  └──────────────────────────────────────────────────────────┘
│                                                              │
│  ┌────────────────┐  ┌────────────────────────────────────┐ │
│  │ SystemMonitor   │  │ Dispatch State (mem + disk)        │ │
│  │ CPU/Mem/Disk    │  │ sandboxes[], queue[], completed[]  │ │
│  └────────────────┘  └────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘

   ┌───────────────────────────────────────────────────────┐
   │  AgentBackend Plugins (ADR-006)                       │
   │                                                       │
   │  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
   │  │ Gemini   │  │ Claude   │  │ Codex    │  Tier 1/2 │
   │  │ (local)  │  │ (local)  │  │ (local)  │  sync     │
   │  └──────────┘  └──────────┘  └──────────┘           │
   │                                                       │
   │  ┌────────────────────────────────────┐   Separate   │
   │  │ Codex Cloud (GitHub integration)   │   feature    │
   │  │ @codex in issues → webhook → PR    │   (not F005) │
   │  └────────────────────────────────────┘              │
   └───────────────────────────────────────────────────────┘
```

### 4. Merge Serialization Design

- **Mechanism**: GitHub PR (not direct git merge, not AsyncMutex)
- **Flow**: Each sandbox pushes branch → gwrk creates PR → Ship Loop reviews + merges → Harvest fires on merge
- **Conflict handling**: PR conflicts resolved in Ship Loop review cycle (human or agent-assisted)
- **No merge worktree needed**: PRs are merged via GitHub API, not local git operations
- **Lifecycle boundary**: F005 owns dispatch + PR creation. F004 owns review + merge. F011 owns harvest.

### 5. Resource Gating Contract

```typescript
interface ParallelismConfig {
  local: {
    maxClones: number;    // DEFAULT: 2. Sane for 16GB Mac. Adjustable.
    maxCpu: number;       // DEFAULT: 80%
    maxMem: number;       // DEFAULT: 80%
    minDiskGb: number;    // DEFAULT: 10
  };
  cloud: {
    maxConcurrent: number; // DEFAULT: 3. Bottleneck is PR review, not compute.
  };
}
```

**No adapter-declared limits.** The operator's machine and config determine capacity.

### 6. F005 Spec Alignment Notes

### 6. F005 Spec Alignment Notes

| Section | Current State | Required Change |
|---------|--------------|-----------------|
| **FR-002** | References Docker clones and `--reference` | Replace with git worktree model for Tier 1/2 MVP. |
| **FR-004** | References "file-based lock" for merge | **DELETE**. Merge serialization is handled by GitHub PR mechanisms; F005 does not own merge locking. |
| **FR-007** | Conflict resolution flow | **DELETE**. F005 does not own conflict resolution; PR conflicts are handled downstream by F004 Ship Loop. |
| **FR-008** | Mandates "cloud agents via PR tagging" | **DELETE / DEFER**. F005 MVP (Tier 1/2) strictly uses `local-cli`. Tier 3 (Codex Cloud) is a separate feature. |
| **US-003** | Auto-merge requirement | **DELETE**. F005 creates PRs but does not merge them. |
| **US-006** | References F008 routing | Replace F008 with F014 P4 (routing intelligence). |
| **FR-005** | References "per-backend `maxConcurrent`" | Simplify to global config-driven `maxClones` + system resource gate. |
| **TC-004** | "No Host Mutation" | Strengthen: host worktree NEVER modified. All agent work localized to sandbox worktrees. |
| **General** | No phased rollout | Add explicit Tier 1/2/3 phasing. |
| **General** | No Ship/Harvest boundary | Clarify F005 operates exclusively in the dispatch phase. |

### 7. Architecture.md Amendments

#### §1 Overview diagram — replace "Docker Sandbox Manager"

```diff
-│  Docker Sandbox Manager                              │
+│  Parallel Dispatch Orchestrator (F005)               │
+│  ┌──────────┐  ┌──────────┐                         │
+│  │ Sandbox  │  │ Sandbox  │  (git worktrees)        │
+│  │ (wktree) │  │ (wktree) │  each → PR              │
+│  └──────────┘  └──────────┘                         │
```

#### §6.1 Dispatch Boundary — add F005 subsection

```markdown
### 6.1.1 Parallel Dispatch (F005)

When a phase contains multiple independent tasks, the orchestrator dispatches
them concurrently into isolated sandboxes:

| Tier | Backend | Sandbox | Dispatch Mode |
|------|---------|---------|---------------|
| 1 | Gemini (local) | Git worktree | sync (spawn + await) |
| 2 | All local CLIs | Git worktree | sync (spawn + await) |
| 3 | Codex Cloud | Codex-managed container | async (GitHub @codex) |

Merge serialization feeds Ship Loop (004). Harvest (011) is independent —
triggered only when the Ship Loop's PR is merged.
```

#### §4 Project Structure — add `.runs/sandboxes/`

```markdown
├── .runs/                         # Machine-local, gitignored
│   ├── sandboxes/                 # Ephemeral sandbox worktrees (F005)
│   │   └── <feature>-<task>-<uuid>/  # git worktree
│   ├── <feature>_p<phase>.state   # Ship loop crash recovery state
│   └── <timestamp>_wud_*.log      # Ship loop logs
```

#### §8 Config — update parallelism section

```json
"parallelism": {
  "local": { "maxClones": 2, "maxCpu": 80, "maxMem": 80, "minDiskGb": 10 },
  "cloud": { "maxConcurrent": 3 }
}
```

#### §10 Technology Stack

```diff
-| **Sandbox** | Docker | Per-feature-phase container isolation |
+| **Sandbox (local)** | Git worktrees | Per-task worktree isolation (~1s startup, zero deps) |
+| **Sandbox (cloud)** | Codex Cloud | @codex GitHub integration (Tier 3) |
```

---

## 8. Spec Ambiguity Resolutions (F005 vs F011/F014)

A comprehensive cross-specification governance audit identified three critical architectural fractures. The following design resolutions establish tracing and enforce strict boundaries to remedy them before implementation:

### Fracture 1: The Merge Ownership Collision
*   **Conflict:** F005 references owning GitHub PR merging, serialized locking, and conflict resolution (US-003, FR-004, FR-007), which collides with F004 Ship Loop ownership.
*   **Resolution:** F005 scope MUST be strictly redacted. F005 is exclusively responsible for **PR Creation** (Sandbox → Feature Branch). It does not lock, it does not merge, and it does not resolve conflicts.
*   **Spec Remedy:** Aggressively SCRUB F005 of US-003, FR-004, and FR-007. The orchestrator's job ends the millisecond the PR is opened.

### Fracture 2: The Harvest Trigger Mismatch
*   **Conflict:** F005 parallelization creates an N:1 cardinality mismatch. N sandboxes = N PRs (Sandbox → Feature Branch). F011 (Harvest) triggers its "Done, Done!" breakdown upon a PR merge webhook, which would falsely trigger on the first Sandbox PR merge.
*   **Resolution:** Harvest trigger conditions MUST differentiate between "Task PRs" and "Phase Rollup PRs".
*   **Spec Remedy:** F011 MUST update FR-H01 to enforce strict branch targeting. Harvest is ONLY permitted to trigger when `pull_request.closed` and `merged: true` AND the base branch is the trunk (`main` or `develop`). Sandbox PRs targeting `feat/*` will be completely ignored by Harvest.

### Fracture 3: The Cloud Dispatch Ordering Paradox
*   **Conflict:** F005 FR-008 mandates Cloud Agents (`github-integration` mode) in the base feature, while F014 actively forbids this outside Phase 1, prioritizing `local-cli` exclusively.
*   **Resolution:** Dependency inversion. F005 Phase 1 MUST inherit F014's Phase 1 constraints.
*   **Spec Remedy:** F005 FR-008 MUST be deferred to a later tier. F005 Phase 1 MVP is strictly bounded to Tier 1 and Tier 2 (Git worktrees + Local CLI) dispatch models. F014's dictate overrides F005's assumed timeline.

---

## Open Items — Resolved

| # | Item | Decision | Rationale |
|---|------|----------|----------|
| 1 | **Docker sandbox** | **Pushed to backlog.** Delete `sandbox.ts`. | Docker is viable (0.21s) but adds complexity not needed for MVP. `SandboxFactory` interface in F005 must not foreclose Docker. |
| 2 | **Worktree cleanup on crash** | **Auto-clean on startup with messages.** | `gwrk server start` runs `git worktree prune` and logs to Slack. No orphan worktrees survive restart. |
| 3 | **`work-until-done.sh` + parallel dispatch** | **Dispatch calls `gwrk ship`, not WUD directly.** | Hexagonal architecture. Orchestrator knows `gwrk` commands, not shell scripts. WUD survives as internal implementation detail of `gwrk ship`. |
| 4 | **Merge worktree** | **Not needed.** Merge is via GitHub PR. | Each sandbox creates a PR. No direct git merge, no merge worktree, no AsyncMutex. |
| 5 | **Codex Cloud scope** | **Separate feature.** F005 must not foreclose. | Codex Cloud is architecturally distinct (web/GitHub/Slack integration, not local CLI). F005's `AgentBackend` interface must support `dispatchMode` discriminator. |
| 6 | **gwrk air-gapped readiness** | **F005 design must support both install-on-setup and vendored-in-repo.** | Codex Cloud containers (and any remote dispatch) need `gwrk` available. Two strategies: `npm install -g gwrk` in setup script, or `.gwrk/bin/gwrk` vendored. |

---

## Source Lineage

| Source | Contribution |
|--------|-------------|
| [architecture.md](file:///Users/gonzo/Code/gwrk/docs/architecture.md) §1, §4, §6, §8, §9, §10 | Dispatch boundary, branching model, config contract, tech stack |
| [ADR-006](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-006-plugin-agent-backends.md) | `AgentBackend` interface, stdin delivery, exit normalization |
| [F005 spec](file:///Users/gonzo/Code/gwrk/specs/005-parallel-dispatch/spec.md) | Current spec (staleness analysis) |
| [F004 spec](file:///Users/gonzo/Code/gwrk/specs/004-ship-loop/spec.md) | Ship loop contracts, dispatch boundary FRs 019-021 |
| [F011 spec](file:///Users/gonzo/Code/gwrk/specs/011-harvest/spec.md) | **Ship/Harvest boundary: dispatch ≠ done done** |
| [CLI backend research](file:///Users/gonzo/Code/gwrk/docs/reference/cli-backend-research-report.md) | Backend invocation patterns, per-CLI flags |
| [Codex Cloud Research Report](file:///Users/gonzo/Code/gwrk/docs/reference/codex-cloud-research-report.md) | **Comprehensive Codex Cloud reference: environments, universal image, pricing, security, gwrk Tier 3 integration** |
| [Codex Cloud docs](https://developers.openai.com/codex/cloud) | **Cloud task lifecycle, entry points (web/GitHub/Slack)** |
| [Codex GitHub integration](https://developers.openai.com/codex/integrations/github) | **`@codex` in issues/PRs, automatic reviews** |
| [Codex Slack integration](https://developers.openai.com/codex/integrations/slack) | **`@Codex` in channels/threads** |
| [Codex Cloud environments](https://developers.openai.com/codex/cloud/environments) | **Container lifecycle, setup scripts, caching** |
| [agent.ts](file:///Users/gonzo/Code/gwrk/src/utils/agent.ts) | Current `dispatchToAgent()` — 314 LOC |
| [dispatch.ts](file:///Users/gonzo/Code/gwrk/src/server/dispatch.ts) | `DispatchQueue` class — capacity gate, idempotency — 303 LOC |
| [git-manager.ts](file:///Users/gonzo/Code/gwrk/src/server/git-manager.ts) | `mergePhaseBack()` — 76 LOC, no concurrency |
| [sandbox.ts](file:///Users/gonzo/Code/gwrk/src/server/sandbox.ts) | Docker-only sandbox — 134 LOC, shared bind-mount (unsafe) |
| [work-until-done.sh](file:///Users/gonzo/Code/gwrk/scripts/dev/work-until-done.sh) | Sequential phase orchestrator — 691 LOC |
| [.gwrkrc.json](file:///Users/gonzo/Code/gwrk/.gwrkrc.json) | Parallelism config: `maxClones: 2`, `cloud.maxConcurrent: 10` |
| Docker Desktop benchmarks (repoflow.io, Oct 2025) | **0.21s warm container startup on Apple Silicon** |
| Git worktree research (web) | Per-worktree index isolation, concurrent commit safety |
