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

### Shipped Features

| Feature | tasks.json | Notes |
|---------|------------|-------|
| **002 (build-server)** | 25/25 ✅ | Server runs, routes exist. macOS memory reporting fixed (vm_stat). |
| **003 (slack)** | 26/26 ✅ | Merge from Slack (`gh pr merge`), ship from Slack, status → PlanStore DAG, Foxtrot Charlie noise kill, webhook fallback, init provisioning. |
| **004 (ship-loop)** | 35/35 ✅ | Core loop works. 018 hardening fixed 3 systemic breaks. |
| **011 (harvest)** | 21/21 ✅ | `harvest.ts` engine, `github.ts` webhook handler, idempotency guard, dedup notifications, full test coverage. Phase 6 remediation complete. |

### In Progress

| Feature | Status | What's Left |
|---------|--------|-------------|
| **006 (pulse)** | Phase 1-2 done (8/11 tasks). PR #33 open. | Phase 3: 3 tasks remaining |

### Specified But Not Started

| Feature | Tasks | What It Does |
|---------|-------|-------------|
| **007 (effort-compression)** | 0/24 | SP estimation, compression ratios, "how much faster is AI?" metrics |
| **008 (agent-router)** | 0/20 | Smart model selection, rate-limit awareness, cost tracking, failback chains |

---

## The Question: What Gets You to Daily-Driver?

Your daily workflow is: **define features → ship them → measure progress → share with team**

The critical path is NOT "complete all features." It's: **make the core define→ship loop reliable enough that you trust it on every project, then layer measurement on top.**

---

## Proposed Sequence

### Phase 1: Stabilize — "Stop the Bleeding" ✅ COMPLETE

> [!IMPORTANT]
> All Phase 1 items shipped.

1. ~~**002 refinement**: The server is chatty.~~ ✅ macOS memory fixed, server stable
2. ~~**003 refinement**: Slack bot sends messages nobody reads.~~ ✅ Foxtrot Charlie contract, bless-from-phone, webhook support
3. ~~**011 completion**: 3 tasks left. `harvest.ts` + `github.ts` + tests.~~ ✅ All 21/21 tasks complete. Phase 6 remediation done.

**Exit criteria:** ✅ Met. Server stable. Slack useful. Harvest pipeline complete.

---

### Phase 2: Daily-Driver (in progress) — "Use It on Real Projects"

> [!IMPORTANT]
> This is where gwrk stops being a tool you're building and starts being a tool you're using. Deploy it on `the-ai-skeptic`, `resonancexl`, and `gforge`.

4. **006 pulse (Phase 1-2 done, Phase 3 in progress)**: Git commit velocity dashboard. `gwrk measure pulse` shows you a useful summary of what shipped this week across repos. PR #33 open.
5. **007 effort-compression (Phase 1 only)**: `gwrk measure effort <feature>` gives you SP estimate from spec stories. `gwrk measure compression` shows actual-vs-estimated. These are the numbers that make gwrk's value legible.
6. **Build plan status reconciliation**: The plan DAG says everything is `DEFINED` when 002/003/004/011 are actually `SHIPPED`. Reconcile plan status with reality so `gwrk plan status` tells the truth.

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

## Shipping Log

### 2026-05-06: 003-slack Daily-Driver

| What | Impact |
|------|--------|
| Feature prefix resolution | `gwrk ship 003` → `003-slack` |
| Merge from Slack | ✅ Merge → `gh pr merge #N` via PR lookup |
| Ship from Slack | `/gwrk ship 003 1` → spawn subprocess |
| Status from Slack | `/gwrk status` → PlanStore DAG, Home Tab |
| Kill the Noise | Foxtrot Charlie: only bless-CTA messages |
| View Review fix | → real GitHub PR URL, not broken localhost |
| Memory reporting | macOS `vm_stat` — was 99.6%, now 71.2% |
| Webhook support | Per-project webhook in `.gwrkrc.json` |
| Channel alignment | gwrk repo → `gwrk-dev` channel + webhook |

### 2026-05-06: 011-harvest Phase 6 Remediation

| What | Impact |
|------|--------|
| Idempotency guard | `harvestFeature()` skips already-harvested features |
| Dedup notifications | Removed double `notifySlack` in `github.ts` |
| Test coverage | All `it.todo()` stubs filled, 7 tests passing |
| Test debt cleanup | 12 pre-existing test failures resolved (dead WUD tests, dispatch race, specify timing) |

### 2026-05-07: 006-pulse Phase 1-2

| What | Impact |
|------|--------|
| PR #33 | Phase 1 shipped to develop |
| 008-agent-router | Spec + plan refined |

---

## Open Questions

1. **Pulse repos**: Which repos should `gwrk measure pulse` track? Just `gwrk`, or also `gforge`, `the-ai-skeptic`, `resonancexl`?
2. **Shareable target**: Joe Kaiser and Lance Helsten.

## What's Next

> [!IMPORTANT]
> **Immediate**: Finish 006-pulse Phase 3 (3 tasks). Merge PR #33.
> **After that**: 007 effort-compression Phase 1, plan status reconciliation.
