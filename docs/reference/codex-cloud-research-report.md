# Codex Cloud Research Report

> **Status:** Research Report · **Date:** 2026-03-18
> **Purpose:** Primary reference for Codex Cloud integration in gwrk parallel dispatch (F005 Tier 3)
> **Compatibility:** [R001 Parallel Dispatch](file:///Users/gonzo/Code/gwrk/docs/research/R001-parallel-dispatch/draft.md), [ADR-006](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-006-plugin-agent-backends.md), [CLI Backend Research](file:///Users/gonzo/Code/gwrk/docs/reference/cli-backend-research-report.md)
> **Sources:** [developers.openai.com/codex/cloud](https://developers.openai.com/codex/cloud), [openai/codex-universal](https://github.com/openai/codex-universal), operator screenshots
> **Model:** GPT-5.4, GPT-5.3-Codex (cloud runtime model)

---

## 1. Executive Summary

Codex Cloud is OpenAI's cloud-hosted coding agent that runs tasks in isolated containers, asynchronously and in parallel, against GitHub repositories. **It is NOT a CLI command** — there is no `codex cloud exec`. Codex Cloud is a web/integration service with four entry points:

1. **Web UI** at chatgpt.com/codex
2. **GitHub** — `@codex` in issue/PR comments
3. **Slack** — `@Codex` in channels/threads
4. **IDE Extension** — cloud delegation from VS Code / Cursor

For gwrk, Codex Cloud is the **only currently available fully parallelizable backend** — each cloud task gets its own container, clones the repo independently, and produces diffs that can be turned into PRs. This makes it the natural Tier 3 dispatch target for F005 parallel dispatch.

### Core Finding

Codex Cloud's architecture is fundamentally different from local CLI dispatch:

| Aspect | Local CLI (gemini/claude/codex) | Codex Cloud |
|--------|-------------------------------|-------------|
| **Execution** | `spawn()` → await exit | Create trigger → poll for completion |
| **Sandbox** | gwrk manages (worktree/Docker) | Codex manages (own container) |
| **Result** | stdout/stderr + exit code | Diff + optional PR |
| **Parallelism** | gwrk orchestrates N worktrees | Codex natively supports parallel threads |
| **Context delivery** | stdin/args + context files | AGENTS.md + setup scripts + prompt |
| **Merge** | gwrk merge queue | PR-based (GitHub-native) |
| **Cost model** | API key (token-based) | ChatGPT subscription (credit-based) |

---

## 2. Platform Architecture

### 2.1 Entry Points

#### Web UI (chatgpt.com/codex)

The primary interface. Users submit tasks via a prompt composer that supports:
- Text prompts with file/image context
- Cloud environment selection (dropdown)
- Thread-based workflow — follow-up prompts continue in the same thread
- Diff viewer → "Open PR" action on completion

#### GitHub Integration

**Setup**: Install Codex GitHub App + enable in Codex settings.

**Two modes**:

| Mode | Trigger | Behavior |
|------|---------|----------|
| **Code Review** | `@codex review` in PR comment | Posts a GitHub code review (P0/P1 issues only) |
| **Task** | `@codex <any other prompt>` in issue/PR comment | Creates cloud task with context from the issue/PR |

**Automatic reviews**: Can be enabled per-repo — Codex automatically reviews every new PR.

**AGENTS.md integration**: Codex reads `AGENTS.md` files to find project-specific review guidelines, lint commands, and conventions. This is the same `AGENTS.md` used by the local Codex CLI.

> **gwrk integration path**: For F005 Tier 3, gwrk creates a GitHub issue with `@codex <prompt>` containing the full task context. Codex creates a cloud task, executes, and results appear as a new PR or commit.

#### Slack Integration

**Setup**: Install Codex Slack App + add `@Codex` to channels.

**Behavior**:
- Mention `@Codex <prompt>` in any channel or thread
- Codex reacts (👀) and creates a cloud task
- On completion, posts result link + optional answer in thread
- Codex uses thread history as additional context

**Environment selection**: Codex auto-selects the best-matching environment from the user's available environments. If ambiguous, falls back to most recently used.

**Enterprise controls**: Admins can disable Codex from posting answers (post link only).

#### IDE Extension (Cloud Delegation)

**Workflow**: Local planning → Cloud execution

1. Plan locally in IDE (use `$plan` skill or free-form prompt)
2. Click cloud icon → select cloud environment
3. Submit prompt → Codex creates cloud thread carrying IDE context
4. Review diff → iterate → create PR or pull changes locally

This is the **"Delegate refactor to the cloud"** workflow pattern documented by OpenAI.

### 2.2 Cloud Task Lifecycle

```
1. Container created from environment image (default: codex-universal)
2. Repository cloned + branch checked out (at selected branch or commit SHA)
3. Setup script runs (with internet access)
   - Automatic: detects npm/yarn/pnpm/pip/pipenv/poetry → installs deps
   - Manual: custom bash script (e.g., `pip install pyright && pnpm install`)
4. Maintenance script runs (if cached container resumed, optional)
5. Agent internet access settings applied (off by default)
6. Agent loop: reads files → formulates plan → edits code → runs checks → validates
   - Agent reads AGENTS.md for project conventions
   - Agent runs terminal commands in a loop until task complete
7. Agent finishes → shows diff of changed files
8. User reviews → opens PR, or asks follow-up questions
```

### 2.3 Threads Model

A **thread** is a session: prompt + model outputs + tool calls.

Key properties:
- **Multiple prompts per thread**: Follow-ups continue the same thread
- **Multiple concurrent threads**: You can run N threads in parallel
- **Warning**: Avoid two threads modifying the same files
- **Context window**: Model-specific. Codex monitors remaining space. For long tasks, auto-compaction summarizes context.
- **Local vs Cloud**: Local threads run on your machine; cloud threads run in environments

> **gwrk implication**: Each parallel dispatch to Codex Cloud is a separate thread. Multiple threads = native parallelism without gwrk worktree management.

---

## 3. Environment Configuration

### 3.1 gforge-esc/gwrk Environment (from operator screenshots)

| Setting | Value | Notes |
|---------|-------|-------|
| **GitHub org** | gforge-esc | Private repo access |
| **Repository** | gwrk | Private repository ✓ |
| **Environment name** | gforge-esc/gwrk | Auto-generated from org/repo |
| **Container image** | universal | Ubuntu 24.04 base |
| **Workspace directory** | /workspace | Repo cloned to `/workspace/gwrk` |
| **Container caching** | On | Caches for up to 12h |
| **Setup script** | Automatic | Detects pnpm → runs `pnpm install` |
| **Agent internet access** | Off | No internet during agent phase |

### 3.2 Preinstalled Packages (universal image)

From operator screenshot and [openai/codex-universal](https://github.com/openai/codex-universal):

| Language | Version | gwrk Relevance |
|----------|---------|----------------|
| **Node.js** | **20** | ✅ Primary — gwrk is TypeScript/Node.js |
| Python | 3.12 | Low — not used in gwrk |
| Ruby | 3.4.4 | None |
| Rust | 1.89.0 | None (future: CodeRed) |
| Go | 1.24.3 | None |
| Bun | 1.2.14 | Low — pnpm is primary |
| PHP | 8.4 | None |
| Java | 21 | None |
| Swift | 6.1 | None |

**Additional pre-installed**: bun 1.2.10, bazelisk/bazel, erlang 27.1.2, elixir 1.18.3

**Package managers pre-installed**: npm, yarn, pnpm, corepack

> **gwrk compatibility**: Node.js 20 + pnpm pre-installed = gwrk's `pnpm install` setup script will work automatically. No manual setup script needed for basic operations.

### 3.3 codex-universal Docker Image

**Registry**: `ghcr.io/openai/codex-universal:latest`

```bash
docker pull ghcr.io/openai/codex-universal:latest
```

**Architecture**: Builds for `linux/amd64` and `linux/arm64`. Cloud runs `linux/amd64` only.

**Local testing**: You can approximate the cloud environment locally:

```bash
docker run --rm -it \
  -e CODEX_ENV_NODE_VERSION=20 \
  -v $(pwd):/workspace/$(basename $(pwd)) \
  -w /workspace/$(basename $(pwd)) \
  ghcr.io/openai/codex-universal:latest
```

**Language version control**: Environment variables `CODEX_ENV_*` configure runtimes:

| Variable | Supported Versions |
|----------|-------------------|
| `CODEX_ENV_NODE_VERSION` | 18, **20**, 22 |
| `CODEX_ENV_PYTHON_VERSION` | 3.10, 3.11.12, 3.12, 3.13, 3.14.0 |
| `CODEX_ENV_RUST_VERSION` | 1.83.0 – 1.92.0 |
| `CODEX_ENV_GO_VERSION` | 1.22.12, 1.23.8, 1.24.3, 1.25.1 |
| `CODEX_ENV_JAVA_VERSION` | 11, 17, 21, 22, 23, 24, 25 |
| `CODEX_ENV_RUBY_VERSION` | 3.2.3, 3.3.8, 3.4.4 |
| `CODEX_ENV_PHP_VERSION` | 8.2, 8.3, 8.4 |
| `CODEX_ENV_SWIFT_VERSION` | 5.10, 6.1, 6.2 |

### 3.4 Container Caching

Codex caches container state for **up to 12 hours** to speed up tasks:

**On cache creation**:
1. Clone repo → checkout default branch
2. Run setup script
3. Cache resulting container state

**On cache resume**:
1. Checkout task-specific branch
2. Run maintenance script (optional — use when deps need updating)

**Cache invalidation**: Automatic if setup script, maintenance script, env vars, or secrets change. Manual reset available on environment page.

**Business/Enterprise**: Caches shared across all users with access to the environment.

### 3.5 Environment Variables and Secrets

| Type | Availability | Encryption | Use Case |
|------|-------------|------------|----------|
| **Environment variables** | Full task duration (setup + agent) | Standard | `NODE_ENV`, `DEBUG`, etc. |
| **Secrets** | Setup scripts ONLY | Extra encryption | API keys, tokens — removed before agent phase |

> **Security model**: Secrets are explicitly removed before the agent starts. This prevents the model from exfiltrating credentials via tool calls or code execution. Environment variables persist — don't put secrets there.

---

## 4. Internet Access & Security

### 4.1 Default Behavior

**Internet is OFF during agent phase by default.** Setup scripts run WITH internet (for dependency installation).

### 4.2 Risk Model

Enabling agent internet access introduces:
- **Prompt injection** from untrusted web content (e.g., malicious issue descriptions)
- **Code/secret exfiltration** via HTTP requests
- **Supply chain attacks** from downloading untrusted dependencies
- **License contamination** from pulling restricted-license content

### 4.3 Configuration Options

When internet access is enabled:

| Control | Options |
|---------|---------|
| **Domain allowlist** | None (empty), Common Dependencies (preset), All (unrestricted) |
| **HTTP methods** | Can restrict to GET/HEAD/OPTIONS only (blocks POST/PUT/DELETE) |

**Common dependencies preset** includes: github.com, npmjs.com, pypi.org, crates.io, ubuntu.com, docker.com, and ~60 more package registry domains.

### 4.4 gwrk Recommendation

**Keep internet OFF for gwrk tasks.** Rationale:
- gwrk tasks are code modification — no external API calls needed
- All dependencies installed during setup script (with internet)
- Eliminates exfiltration risk for private repo code
- If pnpm lock needs updating, setup script handles it

---

## 5. Pricing & Rate Limits

### 5.1 Plan Comparison

| Feature | Plus ($20/mo) | Pro ($200/mo) | Business | Enterprise |
|---------|:---:|:---:|:---:|:---:|
| Cloud tasks | ✅ | ✅ | ✅ | ✅ |
| GitHub code review | ✅ | ✅ | ✅ | ✅ |
| Slack integration | ✅ | ✅ | ✅ | ✅ |
| Models | GPT-5.4, GPT-5.3-Codex | + GPT-5.3-Codex-Spark | + larger VMs | + priority processing |
| Usage limits | Base | 6x local/cloud | Flexible credits | Flexible credits |
| Code reviews/week | Base | 10x more | Flexible | Flexible |
| Credits | Purchasable | Purchasable | Workspace credits | Workspace credits |
| Data training | — | — | Off by default | Off by default |
| API key mode | ✅ (no cloud) | ✅ (no cloud) | ✅ (no cloud) | ✅ (no cloud) |

### 5.2 Usage Limits

- Local messages and cloud tasks share a **5-hour rolling window**
- Additional weekly limits may apply
- Credits can extend usage past included limits
- GPT-5.4-mini extends limits by ~2.5–3.3x
- `/status` in CLI shows remaining limits

### 5.3 API Key Mode

For CI/automation:
- CLI, SDK, or IDE extension only — **no cloud features**
- No GitHub code review, no Slack
- Pay per token at standard API rates
- Delayed access to newest models

> **gwrk implication**: F005 Tier 3 (Codex Cloud via GitHub) requires a ChatGPT subscription (Pro recommended for 6x limits). Tier 1/2 (local Codex CLI) can use API key mode.

---

## 6. AGENTS.md — The Governance File

Codex reads `AGENTS.md` at every level:

| Scope | Location | Purpose |
|-------|----------|---------|
| **Global** | `~/.codex/AGENTS.md` | User-wide defaults |
| **Repo root** | `AGENTS.md` | Project conventions, stack, quality rules |
| **Subdirectory** | `src/server/AGENTS.md` | Scoped overrides for module |

**For GitHub code reviews**: Codex applies the closest `AGENTS.md` to each changed file. Add a `## Review guidelines` section for review-specific rules.

**For cloud tasks**: Codex reads `AGENTS.md` to find:
- Lint/test commands to run
- Project conventions to follow
- File patterns and constraints

> **gwrk integration**: gwrk already generates `AGENTS.md` as part of the `AgentBackend` context adapter (ADR-006, `syncGovernance()`). This same file will govern Codex Cloud behavior — no additional integration needed.

---

## 7. gwrk Integration Architecture (F005 Tier 3)

### 7.1 Dispatch Flow

```
gwrk ship <feature> <phase>
  │
  ├── Tier 1/2: Local dispatch
  │   └── spawn(gemini/claude/codex, args) → await → merge queue
  │
  └── Tier 3: Codex Cloud dispatch
      │
      ├── 1. AGENTS.md already in repo (syncGovernance)
      │
      ├── 2. Create GitHub issue via GitHub API:
      │   Title: "[gwrk] <feature> P<phase> T<task>: <title>"
      │   Body:  @codex <full task prompt with context>
      │   Labels: gwrk-dispatch, codex-cloud
      │
      ├── 3. Codex reacts (👀) → creates cloud task
      │   Container: codex-universal
      │   Branch: develop (or feature branch)
      │   Setup: automatic (pnpm install)
      │   Internet: OFF
      │
      ├── 4. Agent loop: read → edit → test → validate
      │   Guided by AGENTS.md conventions
      │
      ├── 5. Agent finishes → diff ready
      │   Codex creates PR from diff
      │   PR targets: feat/<feature> branch
      │
      ├── 6. gwrk detects PR via webhook
      │   Event: pull_request.opened
      │   Match: labels contain "gwrk-dispatch"
      │
      └── 7. PR enters Ship Loop (004) review cycle
          Code review → UAT → merge → Harvest (011)
```

### 7.2 Completion Detection

| Method | Mechanism | Latency | Complexity |
|--------|-----------|---------|------------|
| **GitHub webhook** | `pull_request.opened` event | ~1s | Medium (webhook handler exists in 002-build-server) |
| **Polling** | `gh pr list --label gwrk-dispatch` | 30-60s | Low |
| **Issue comment** | Codex posts completion comment on source issue | ~1s | Low (parse comment) |

**Recommendation**: GitHub webhook for PR detection. gwrk's build server (F002) already handles GitHub webhooks (F011 harvest uses `pull_request.closed`). Adding `pull_request.opened` handler is trivial.

### 7.3 Branch Strategy

**Problem**: Codex Cloud checks out a branch and creates a PR. gwrk needs to control which branch Codex works on.

**Solution**: The GitHub issue prompt specifies the branch:

```markdown
@codex

Work on branch `feat/005-parallel-dispatch`.

<task>
Implement the AsyncMutex class in src/server/merge-queue.ts.
...
</task>
```

Codex Cloud checks out the specified branch in the environment. The resulting PR targets that same branch (or a configurable base branch).

### 7.4 Parallel Dispatch

Codex Cloud natively supports **multiple concurrent threads**. Each cloud task is its own thread, its own container, its own clone. No gwrk worktree management needed.

**gwrk's responsibility**: Rate limit issue creation. Don't flood with N issues simultaneously — respect `parallelism.cloud.maxConcurrent: 3`.

**Merge serialization**: Cloud tasks produce PRs. Multiple PRs against the same branch may conflict. Options:
1. **Sequential merge**: Merge PRs one at a time, rebase later ones
2. **Stacked PRs**: Each PR targets the previous PR's branch
3. **Human review**: Codex Cloud tasks are less deterministic — human reviews each PR

### 7.5 `AgentBackend` Interface Extension

```typescript
interface CodexCloudBackend extends AgentBackend {
  name: 'codex-cloud';
  dispatchMode: 'github-integration';

  // Override: does NOT spawn a local process
  dispatch(opts: DispatchOpts): Promise<CloudDispatchResult>;

  // Creates GitHub issue with @codex mention
  createCloudTask(opts: {
    repo: string;          // 'gforge-esc/gwrk'
    branch: string;        // 'feat/005-parallel-dispatch'
    prompt: string;        // Full task prompt
    labels: string[];      // ['gwrk-dispatch', 'codex-cloud']
  }): Promise<{ issueNumber: number; issueUrl: string }>;

  // Watches for PR creation from the cloud task
  awaitCompletion(issueNumber: number): Promise<{
    prNumber: number;
    prUrl: string;
    diff: string;
  }>;
}
```

---

## 8. Setup Checklist for gforge-esc/gwrk

Based on operator screenshots, the environment is partially configured. Full checklist:

- [x] GitHub org connected (gforge-esc)
- [x] Repository selected (gwrk, Private)
- [x] Environment named (gforge-esc/gwrk)
- [x] Container image selected (universal)
- [x] Workspace directory set (/workspace)
- [x] Container caching enabled (On)
- [x] Setup script mode selected (Automatic — detects pnpm)
- [x] Agent internet access configured (Off)
- [ ] **Node.js version pinned** — Set to 20 (matches operator screenshot)
- [ ] **Environment variables** — Add `NODE_ENV=test` if tests require it
- [ ] **Secrets** — None needed (gwrk has no external API deps for implementation)
- [ ] **AGENTS.md created** — gwrk's `syncGovernance()` should maintain this
- [ ] **Setup script validated** — Click "Connect interactive terminal" → verify `pnpm install` succeeds
- [ ] **Test task submitted** — Submit a simple `@codex` task to verify end-to-end flow

---

## 9. Operational Considerations

### 9.1 gwrk-Specific Setup Script

If automatic setup doesn't suffice, use a manual setup script:

```bash
# gwrk Codex Cloud setup script
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

This ensures:
- `corepack` enables pnpm at the correct version (from `package.json` `packageManager` field)
- `--frozen-lockfile` prevents lock file modifications in cloud
- `pnpm build` compiles TypeScript so the agent can run `gwrk` commands

### 9.2 AGENTS.md for Cloud Tasks

The `AGENTS.md` should include gwrk-specific cloud guidance:

```markdown
## gwrk Cloud Task Rules

### Verification
- Run `pnpm test` after every change
- Run `pnpm lint` before finishing
- If a gate script exists for your task, run it: `bash specs/<feature>/gates/T0xx-gate.sh`

### Constraints
- Do NOT modify files outside your task scope
- Do NOT modify package.json unless the task requires new dependencies
- All TypeScript files must pass `pnpm build` without errors

### Exit Signals
- Your task is ONLY complete when verification passes
- Do not stop at uncertainty — make reasonable assumptions and proceed
```

### 9.3 Rate Limit Management

| Plan | Cloud Tasks per 5h | Practical Throughput |
|------|--------------------|--------------------|
| Plus | ~5-10 (estimated) | ~1-2 parallel, conservative |
| Pro | ~30-60 (6x Plus) | **3-5 parallel, recommended** |
| Business | Credit-based | Budget-dependent |

> **Recommendation**: ChatGPT Pro subscription for gwrk's Codex Cloud usage. The 6x multiplier makes sustained parallel dispatch practical.

### 9.4 Local Testing with codex-universal

Before deploying to cloud, test locally:

```bash
# Pull the image
docker pull ghcr.io/openai/codex-universal:latest

# Test gwrk setup
docker run --rm -it \
  -e CODEX_ENV_NODE_VERSION=20 \
  -v $(pwd):/workspace/gwrk \
  -w /workspace/gwrk \
  ghcr.io/openai/codex-universal:latest \
  bash -c "corepack enable && pnpm install && pnpm build && pnpm test"
```

This validates that gwrk's dependencies install and tests pass in the codex-universal image before submitting cloud tasks.

---

## 10. Comparison: Codex Cloud vs Local CLI

| Dimension | Codex Cloud | Codex CLI (local) |
|-----------|------------|-------------------|
| **Execution model** | Cloud container | Local process |
| **Sandbox** | Codex-managed container | `--full-auto` (workspace-write) or `--dangerously-bypass-*` |
| **Parallelism** | Native (multiple threads) | gwrk manages (worktrees) |
| **Models** | GPT-5.4, GPT-5.3-Codex | Same (if subscription) or API models |
| **Context delivery** | AGENTS.md + prompt | AGENTS.md + stdin + `--output-schema` |
| **Result format** | Diff → PR | stdout + exit code |
| **Trigger** | Web UI / GitHub / Slack / IDE | `codex exec <prompt>` |
| **Cost** | ChatGPT subscription credits | API key (per-token) |
| **Internet** | Configurable (off by default) | Full access |
| **Git integration** | Clones repo, creates PRs | Works on local worktree |
| **AGENTS.md** | ✅ Auto-read | ✅ Auto-read |
| **Governance** | Setup scripts + secrets + allowlists | config.toml + sandbox modes |

---

## 11. Open Items

| # | Item | Status | Requires |
|---|------|--------|----------|
| 1 | **Test cloud task** — Submit a simple `@codex` task to gforge-esc/gwrk to validate end-to-end flow | Action needed | Engineering |
| 2 | **AGENTS.md cloud section** — Add cloud-specific rules to gwrk's AGENTS.md | Action needed | Engineering |
| 3 | **Rate limit empirical measurement** — Submit 5 tasks in sequence, measure credits consumed | Action needed | Engineering |
| 4 | **Setup script validation** — Use interactive terminal to verify `pnpm install && pnpm build && pnpm test` succeeds | Action needed | Engineering |
| 5 | **GitHub webhook handler** — F002 build server needs `pull_request.opened` handler for cloud task completion detection | F005 Tier 3 impl | Engineering |
| 6 | **Stacked PR strategy** — If multiple cloud tasks target same branch, define merge ordering | F005 Tier 3 design | Architecture |

---

## Source Lineage

| Source | Contribution |
|--------|-------------|
| [Codex Cloud Overview](https://developers.openai.com/codex/cloud) | Task lifecycle, entry points, delegation model |
| [Cloud Environments](https://developers.openai.com/codex/cloud/environments) | Container setup, caching, setup/maintenance scripts |
| [openai/codex-universal](https://github.com/openai/codex-universal) | Docker image, CODEX_ENV_* vars, language runtimes, Dockerfile reference |
| [GitHub Integration](https://developers.openai.com/codex/integrations/github) | `@codex review`, `@codex <task>`, automatic reviews, AGENTS.md for reviews |
| [Slack Integration](https://developers.openai.com/codex/integrations/slack) | `@Codex` in channels, environment selection, enterprise controls |
| [Prompting](https://developers.openai.com/codex/prompting) | Prompts, threads, context model, auto-compaction |
| [Sandboxing](https://developers.openai.com/codex/concepts/sandboxing) | sandbox_mode, approval_policy, writable_roots, full-auto vs danger-full-access |
| [Pricing](https://developers.openai.com/codex/pricing) | Plan tiers, credits, rate limits, API key mode |
| [Internet Access](https://developers.openai.com/codex/cloud/internet-access) | Risk model, domain allowlist, HTTP method restrictions, common dependencies |
| [Workflows — Cloud Delegation](https://developers.openai.com/codex/workflows) | IDE → Cloud delegation pattern, milestone-based refactoring |
| Operator screenshots (2026-03-18) | gforge-esc/gwrk environment config, package versions, workspace directory |
