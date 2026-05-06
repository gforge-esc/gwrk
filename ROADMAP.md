# gwrk: From Ugly Baby to Daily Driver

## Current State — Honest Assessment

### What Actually Works (tested, shipped, usable)

| Feature | Status | Verdict |
|---------|--------|---------|
| **CLI core** (001) | ✅ 44 source files, 104 test files, 573 tests passing | Solid foundation |
| **define spec/plan** | ✅ Agent dispatches, creates spec.md + plan.md | Works, used daily |
| **ship** (004 + 018) | ✅ Branch→implement→review→PR. Quiet UX. Retry prompts. | Just proven on Phase 5 |
| **plan DAG** (018) | ✅ Seed, status, viz, solver, proposals, heartbeat | Freshly shipped |
| **plugin system** (014) | ✅ WorkflowRuntime, PluginLoader, manifest validation | Working infra |
| **execution ledger** | ✅ SQLite, run tracking, .runs/ logs | Working but underused |

### What Exists But Is Ugly (tasks say "complete" but quality is unverified)

| Feature | tasks.json | Reality |
|---------|------------|---------|
| **002 (build-server)** | 25/25 ✅ | Server runs, routes exist. ~~Slack integration is chatty and unusable.~~ ✅ macOS memory reporting fixed (vm_stat). |
| **003 (slack)** | 26/26 ✅ | ✅ **SHIPPED this session**: merge from Slack (`gh pr merge`), ship from Slack, status → PlanStore DAG, Foxtrot Charlie noise kill, webhook fallback, init provisioning. |
| **004 (ship-loop)** | 35/35 ✅ | Core loop works. But 018 hardening revealed 3 systemic breaks that were latent. The original ship was fragile — now fixed. |
| **011 (harvest)** | 18/21 | Missing: `harvest.ts` engine, `github.ts` webhook handler, harvest tests. **3 tasks open.** |

### What's Specified But Not Started

| Feature | Tasks | What It Does |
|---------|-------|-------------|
| **006 (pulse)** | 0/11 | Productivity dashboard — git commit velocity, shipping cadence, compression metrics |
| **007 (effort-compression)** | 0/24 | SP estimation, compression ratios, "how much faster is AI?" metrics |
| **008 (agent-router)** | 0/20 | Smart model selection, rate-limit awareness, cost tracking, failback chains |

---

## The Question: What Gets You to Daily-Driver?

Your daily workflow is: **define features → ship them → measure progress → share with team**

The critical path is NOT "complete all features." It's: **make the core define→ship loop reliable enough that you trust it on every project, then layer measurement on top.**

---

## Proposed Sequence

### Phase 1: Stabilize (1-2 days) — "Stop the Bleeding"

> [!IMPORTANT]
> Don't build new things. Fix what's broken in the features you already use.

1. ~~**002 refinement**: The server is chatty.~~ ✅ **SHIPPED** — macOS memory fixed, server stable
2. ~~**003 refinement**: Slack bot sends messages nobody reads.~~ ✅ **SHIPPED** — Foxtrot Charlie contract, bless-from-phone, webhook support
3. **011 completion**: 3 tasks left. `harvest.ts` + `github.ts` + tests. Ship these to close the feature.

**Exit criteria:** ~~`gwrk server start` produces useful, non-noisy Slack output.~~ ✅ Done. `gwrk discover` has a working harvest pipeline — **OUTSTANDING**.

---

### Phase 2: Daily-Driver (3-5 days) — "Use It on Real Projects"

> [!IMPORTANT]
> This is where gwrk stops being a tool you're building and starts being a tool you're using. Deploy it on `the-ai-skeptic`, `resonancexl`, and `gforge`.

4. **006 pulse (Phase 1 only)**: Just the git commit velocity dashboard. `gwrk measure pulse` shows you a useful summary of what shipped this week across repos. Skip the fancy stuff.
5. **007 effort-compression (Phase 1 only)**: `gwrk measure effort <feature>` gives you SP estimate from spec stories. `gwrk measure compression` shows actual-vs-estimated. These are the numbers that make gwrk's value legible.
6. **Build plan status reconciliation**: The plan DAG says everything is `DEFINED` when 002/003/004 are actually `SHIPPED`. Reconcile plan status with reality so `gwrk plan status` tells the truth.

**Exit criteria:** You can run `gwrk measure pulse` on any project and get a useful answer. You can show someone `gwrk plan status` and it reflects reality.

---

### Phase 3: Shareable (1 week) — "Other People Can Use This"

7. **008 agent-router (Phase 1-2)**: Smart model selection is what makes gwrk portable. Right now it's hardcoded to Gemini. Add Claude/Codex routing so it works for people on different providers.
8. **README + setup wizard**: `gwrk init` should bootstrap a project with `.gwrkrc.json`, spec templates, and a "hello world" define→ship cycle in < 5 minutes.
9. **011 harvest + knowledge items**: The discovery pillar. This is what makes gwrk a *learning system* vs a task runner.

**Exit criteria:** Someone clones gwrk, runs `gwrk init`, and completes a define→ship cycle on their own project within 30 minutes.

---

## What NOT to Build Yet

- **005 (parallel-dispatch)**: Premature optimization. You're not bottlenecked on concurrency.
- **012 (knowledge-work)**: Interesting but not blocking daily use.
- **013 (agent-native-interface)**: Cool feature, zero urgency.

---

## The 018 Build Plan as Backbone

Yes — 018 can now orchestrate the work. The sequence above maps to:

```
gwrk plan status           # See what's next
gwrk define spec 002       # Refine the spec for server stabilization
gwrk define plan 002       # Plan the refinement
gwrk ship 002 1            # Ship it
gwrk measure compression   # See the compression ratio
```

The define→ship loop is the product. Everything else is measurement and distribution.

---

## Session Shipped (2026-05-05 → 05-06)

### 003-slack Daily-Driver — 8 commits on `feat/003-slack`

| What | Commit | Impact |
|------|--------|--------|
| Feature prefix resolution | `feat(cli): resolve feature prefix` | `gwrk ship 003` → `003-slack` |
| Merge from Slack | Sprint 1 | ✅ Merge → `gh pr merge #N` via PR lookup |
| Ship from Slack | Sprint 2 | `/gwrk ship 003 1` → spawn subprocess |
| Status from Slack | Sprint 3 | `/gwrk status` → PlanStore DAG, Home Tab |
| Kill the Noise | Sprint 4 | Foxtrot Charlie: only bless-CTA messages |
| View Review fix | `fix(003)` | → real GitHub PR URL, not broken localhost |
| Memory reporting | `fix(002)` | macOS `vm_stat` — was 99.6%, now 71.2% |
| Webhook support | `feat(003)` | Per-project webhook in `.gwrkrc.json` |
| Channel alignment | `config` | gwrk repo → `gwrk-dev` channel + webhook |

### Deferred (not blocking daily-driver)

| Item | Why Later |
|------|-----------|
| ShipBridge for shell path | `work-until-done.sh` doesn't fire events. Need webhook or deprecation. |
| Codex Cloud webhook | Ship from Codex Cloud can't reach localhost. FR-014. |
| Define event bridge | Depends on DefineOrchestrator emitting events. |
| Presence throttling | Current batching works. Polish later. |

---

## Open Questions

1. ~~**002/003 refinement scope**: Do you want to re-spec these features (run define again) or just fix the known issues manually? Re-speccing is cleaner but slower.~~ Resolved: fixed manually.
2. **Pulse repos**: Which repos should `gwrk measure pulse` track? Just `gwrk`, or also `gforge`, `the-ai-skeptic`, `resonancexl`?
3. **Shareable target**: ~~Who's the first person you'd hand this to?~~ Joe Kaiser and Lance Helsten.

## What's Next

> [!IMPORTANT]
> **Immediate next**: Merge `feat/003-slack` → main. Then 011 harvest (3 tasks) to close Phase 1.
> **After that**: Phase 2 — pulse, effort-compression, plan status reconciliation.
