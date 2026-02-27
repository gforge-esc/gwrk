# gwrk Architecture Visualizations & Observability Exploration

> Mermaid diagrams distilled from [GWRK-PRD-PRFAQ.md](file:///Users/gonzo/Code/gwrk/docs/GWRK-PRD-PRFAQ.md) (located at `docs/GWRK-PRD-PRFAQ.md`) + observability UX brainstorm.

---

## 1. The Full Agent Pipeline — Sequence Diagram

This is the end-to-end story: idea on your phone → merged PR.

```mermaid
sequenceDiagram
    actor You as 📱 You (Telegram)
    participant DUT as 🧠 Agent-DUT<br/>(Dream Until Told)
    participant DUS as 📐 Agent-DUS<br/>(Define Until Solid)
    participant ZFG as ⚡ Agent-ZFG<br/>(Local Daemon)
    participant WUD as 🔨 Agent-WUD<br/>(Cloud/Local)
    participant GH as 🐙 GitHub
    participant CI as ⚙️ CI

    You->>DUT: 💬 /dream "I want historical git analysis..."
    DUT->>You: 🧠 Clarifying questions (scope, perf, branches?)
    You->>DUT: 📝 Answers + refinements
    DUT->>You: 📋 Draft spec [View] [Edit] [Ship It 🚀]
    You->>DUT: 🚀 Ship It!
    DUT->>DUS: spec.md committed to repo

    rect rgb(220, 220, 240)
    Note over DUS: Define-Until-Solid Loop
    DUS->>DUS: /plan → plan.md
    DUS->>DUS: /plan-to-tasks → tasks.json + gates/
    DUS->>DUS: /analyze → consistency audit
    DUS->>DUS: /define-tests → RED tests
    end
    DUS->>ZFG: ✅ SOLID — definition complete

    rect rgb(210, 235, 220)
    Note over ZFG,WUD: Parallel Dispatch
    ZFG->>ZFG: Create feature branch + phase branches
    par Phase 01
        ZFG->>WUD: Dispatch Phase 01 (Codex Cloud ☁️)
        WUD->>WUD: PRE-FLIGHT: gate MUST FAIL (RED)
        WUD->>WUD: Implement + test
        WUD->>WUD: POST-FLIGHT: gate MUST PASS (GREEN)
        WUD->>GH: Open PR
    and Phase 02
        ZFG->>WUD: Dispatch Phase 02 (Claude 💻)
        WUD->>WUD: PRE-FLIGHT → Implement → POST-FLIGHT
        WUD->>GH: Open PR
    and Phase 03
        ZFG->>WUD: Dispatch Phase 03 (Gemini 💻)
        WUD->>WUD: PRE-FLIGHT → Implement → POST-FLIGHT
        WUD->>GH: Open PR
    end
    end

    GH->>CI: PR triggers CI
    CI->>ZFG: CI results (pass/fail)

    alt CI passes
        ZFG->>ZFG: /review-code (PE persona)
        ZFG->>ZFG: /review-uat (PM persona)
        ZFG->>You: 📋 Review verdict + [✅ Merge] [🔄 Rework]
        You->>ZFG: ✅ Merge
        ZFG->>GH: Merge PR → develop
        ZFG->>ZFG: Record compression ratios
        ZFG->>You: 🏆 Done, Done!
    else CI fails
        ZFG->>WUD: Retry with error context (up to 3×)
        alt All retries fail
            ZFG->>WUD: Escalate to next backend
            alt All backends exhausted
                ZFG->>You: 🔴 Escalation — human needed
            end
        end
    end
```

---

## 2. System Architecture — Top-Down

```mermaid
flowchart TD
    subgraph MOBILE["📱 Mobile Control Plane"]
        TG[Telegram Bot<br/>grammY]
        DUT_AGENT["Agent-DUT<br/>Dream Until Told"]
    end

    subgraph DAEMON["⚡ gwrk Daemon · localhost:18790"]
        direction TB
        CLI[gwrk CLI<br/>Commander.js]
        
        subgraph ENGINES["Core Engines"]
            DISPATCH[Dispatch Queue<br/>Phase pool · Agent pool<br/>Retry + escalation]
            GIT[Git Manager<br/>Branch · Merge<br/>Conflict resolution]
            PULSE[Pulse Engine<br/>Git log scanner<br/>Snapshot generator]
            EFFORT[Effort Estimator<br/>SP × role hours<br/>1.25× overhead]
            COMPRESS[Compression Engine<br/>Point + Total ratios<br/>Dormancy detection]
            REVIEW[Review Gate<br/>/review-code PE<br/>/review-uat PM]
            ROUTER[Agent Router<br/>Task → backend mapping<br/>Fallback chain]
        end

        subgraph SANDBOX["🐳 Docker Sandbox Manager"]
            S1["Phase 01<br/>WUD #1"]
            S2["Phase 02<br/>WUD #2"]
            S3["Phase 03<br/>WUD #3"]
        end
    end

    subgraph BACKENDS["🤖 Agent Backends"]
        CODEX["☁️ Codex Cloud<br/>True parallelism<br/>Autonomous microVMs"]
        CLAUDE["💻 Claude Code<br/>Local clone<br/>Deep context window"]
        GEMINI["💻 Gemini CLI<br/>Local clone<br/>Multi-file reasoning"]
    end

    subgraph STORAGE["📂 State"]
        TASKS["tasks.json<br/>Flat-file tracking"]
        HISTORY["history.jsonl<br/>Append-only audit"]
        GWRKRC[".gwrkrc.json<br/>Agent config"]
        GATES["gates/T0xx-gate.sh<br/>Hard gate scripts"]
    end

    subgraph GH_STACK["🐙 GitHub"]
        REPO[Repository]
        PR[Pull Requests]
        ACTIONS[GitHub Actions CI]
    end

    TG <-->|status, commands,<br/>approvals| DAEMON
    DUT_AGENT -->|spec.md| CLI
    CLI --> ENGINES
    DISPATCH --> ROUTER
    ROUTER --> SANDBOX
    SANDBOX --> BACKENDS
    CODEX --> GH_STACK
    CLAUDE --> GH_STACK
    GEMINI --> GH_STACK
    ACTIONS -->|CI results| REVIEW
    REVIEW -->|verdict| TG
    GIT <--> REPO
    ENGINES --> STORAGE
```

---

## 3. Done, Done! Protocol — Sequence

The retry-with-escalation flow that is core to gwrk's "maniacal commitment to completion."

```mermaid
sequenceDiagram
    participant ZFG as ⚡ ZFG<br/>(Orchestrator)
    participant R as 🔀 Router
    participant W1 as ☁️ Codex Cloud
    participant W2 as 💻 Claude Code
    participant W3 as 💻 Gemini CLI
    participant CI as ⚙️ CI
    participant YOU as 📱 You

    ZFG->>R: Dispatch Phase 01
    R->>W1: Attempt 1 (preferred: Codex Cloud)

    rect rgb(245, 215, 215)
    Note over W1: Attempt 1 — Codex Cloud
    W1->>W1: PRE-FLIGHT (gate FAILS ✅)
    W1->>W1: Implement code + tests
    W1->>W1: POST-FLIGHT (gate FAILS ❌)
    W1-->>ZFG: 3 test failures
    ZFG->>W1: Retry 1/3 with error context
    W1-->>ZFG: Still failing
    ZFG->>W1: Retry 2/3
    W1-->>ZFG: Still failing
    ZFG->>W1: Retry 3/3
    W1-->>ZFG: Still failing — retries exhausted
    end

    ZFG->>R: Escalate to next backend
    R->>W2: Attempt 2 (fallback: Claude Code)

    rect rgb(215, 240, 220)
    Note over W2: Attempt 2 — Claude Code
    W2->>W2: PRE-FLIGHT (gate FAILS ✅)
    W2->>W2: Implement (with previous failure context)
    W2->>W2: POST-FLIGHT (gate PASSES ✅)
    W2->>CI: Open PR → CI runs
    CI-->>ZFG: All checks pass ✅
    end

    ZFG->>YOU: 📋 Review ready [✅ Merge] [🔄 Rework]
    YOU->>ZFG: ✅ Merge
    ZFG->>ZFG: Record compression (backend: claude, attempt: 2)
    ZFG->>YOU: 🏆 Done, Done!
```

---

## 4. Git Branching — Flowchart

```mermaid
flowchart TD
    MAIN[main] --> DEV[develop]
    DEV --> FW["feature/003-ast-diff-wip<br/>👑 ZFG owns"]

    FW --> P1["phase/003-ast-diff-phase-01<br/>☁️ WUD #1 · Codex Cloud"]
    FW --> P2["phase/003-ast-diff-phase-02<br/>💻 WUD #2 · Claude Code"]
    FW --> P3["phase/003-ast-diff-phase-03<br/>💻 WUD #3 · Gemini CLI"]

    P1 -->|PR + review + merge| FW
    P2 -->|PR + review + merge| FW
    P3 -->|PR + review + merge| FW
    FW -->|final PR| DEV
    DEV -->|release| MAIN

    style MAIN fill:#52b788,stroke:#2d6a4f,color:#000
    style DEV fill:#74c69d,stroke:#40916c,color:#000
    style FW fill:#b185db,stroke:#7209b7,color:#000
    style P1 fill:#72b1f4,stroke:#0077cc,color:#000
    style P2 fill:#72b1f4,stroke:#0077cc,color:#000
    style P3 fill:#72b1f4,stroke:#0077cc,color:#000
```

---

## 5. Build Phase Wave Strategy

```mermaid
flowchart LR
    subgraph W1["Wave 1 — Keystone"]
        P1[P1: CLI Core<br/>13 SP]
    end

    subgraph W2["Wave 2 — Core Engines"]
        P2[P2: Build Server<br/>13 SP]
        P4[P4: WUD Loop<br/>8 SP]
        P6[P6: Pulse<br/>5 SP]
        P7[P7: Effort+Comp<br/>5 SP]
    end

    subgraph W3["Wave 3 — Multipliers"]
        P3[P3: Telegram<br/>8 SP]
        P5[P5: Parallel Dispatch<br/>8 SP]
    end

    subgraph W4["Wave 4 — Intelligence"]
        P8[P8: Agent Router<br/>8 SP]
        P9[P9: Agent-DUT<br/>8 SP]
    end

    subgraph W5["Wave 5 — Integration"]
        P10[P10: GForge Int.<br/>5 SP]
    end

    P1 --> P2
    P1 --> P4
    P1 --> P6
    P1 --> P7
    P2 --> P3
    P2 --> P5
    P4 --> P5
    P5 --> P8
    P3 --> P9
    P6 --> P10
    P7 --> P10

    style W1 fill:#d0bfff,stroke:#7b2cbf,color:#000
    style W2 fill:#b8c0ff,stroke:#3a0ca3,color:#000
    style W3 fill:#a2d2ff,stroke:#0077b6,color:#000
    style W4 fill:#99d5cf,stroke:#0a9396,color:#000
    style W5 fill:#95d5b2,stroke:#40916c,color:#000
```

---

## 6. Observability: "What's Going On?" — The Noodling

You described the scenario perfectly: **the daemon runs silently, and you're curious what's happening.** The PRD is explicit that Pulse is NOT observability (§14). So there's actually a **gap** between what Pulse provides (productivity portrait) and what you want in this moment (real-time operational awareness).

### The Two Distinct Needs

| Need | What It Answers | PRD Coverage |
|---|---|---|
| **Pulse** (productivity) | "What have I shipped? What's in progress?" | ✅ Fully specced |
| **Ops View** (observability) | "What is the daemon *doing right now*?" | ❌ Gap |

### What the Ops View Would Show

```mermaid
flowchart TD
    subgraph OPS["🔭 gwrk Ops View · localhost:18791"]
        direction TB

        subgraph LIVE["Live Status"]
            AGENTS["Active Agents<br/>━━━━━━━━━━━━━━━<br/>☁️ WUD-1 · Codex Cloud<br/>  └ 001-cli-core Phase 01<br/>  └ 12 min elapsed · 3/5 tasks<br/>💻 WUD-2 · Claude Code<br/>  └ 001-cli-core Phase 02<br/>  └ 8 min elapsed · 1/4 tasks"]
            QUEUE["Dispatch Queue<br/>━━━━━━━━━━━━━━━<br/>⏳ Phase 03 → waiting<br/>⏳ Phase 04 → blocked on P3"]
            SYSTEM["System Resources<br/>━━━━━━━━━━━━━━━<br/>CPU: ██████░░░░ 62%<br/>MEM: █████░░░░░ 51%<br/>DSK: 84 GB free<br/>Clones: 2/3 active"]
        end

        subgraph STREAM["Event Stream"]
            LOG["[23:14:02] WUD-1 passed gate T001<br/>[23:14:05] WUD-1 starting T002<br/>[23:13:48] WUD-2 installed deps<br/>[23:12:30] ZFG created phase branches<br/>[23:12:28] Dispatch: 001-cli-core → 3 phases"]
        end

        subgraph HISTORY["Recent Activity"]
            TIMELINE["Feature Timeline<br/>━━━━━━━━━━━━━━━<br/>001-cli-core<br/>  Phase 01 ████████░░ 60%<br/>  Phase 02 ███░░░░░░░ 25%<br/>  Phase 03 ░░░░░░░░░░ queued"]
        end
    end
```

### Three Implementation Paths

#### Option A: Prometheus + Grafana + Loki (Full Observability Stack)

```mermaid
flowchart LR
    ZFG[gwrk daemon] -->|metrics| PROM[Prometheus<br/>:9090]
    ZFG -->|logs| LOKI[Loki<br/>:3100]
    PROM --> GRAF[Grafana<br/>:3000]
    LOKI --> GRAF

    style GRAF fill:#f46800,stroke:#ff8c00,color:#fff
    style PROM fill:#e6522c,stroke:#ff6b4a,color:#fff
    style LOKI fill:#2c7be5,stroke:#5b9af7,color:#fff
```

| Pro | Con |
|---|---|
| Battle-tested, industry-standard | Heavy — 3 separate services to run |
| Rich dashboards, alerting out of the box | Overkill for a single-user local daemon |
| Grafana panels are gorgeous | Config overhead: `prometheus.yml`, datasources |
| Grafana has built-in mobile-responsive views | Docker Compose bloat for a CLI tool |
| You already know the stack from GForge.ai | Three ports to tunnel for remote access |

**Verdict**: Too heavy for v1. But worth noting: Grafana *does* have mobile views, so if you ever go hosted/team, this becomes the right answer.

---

#### Option B: Lightweight Vite SPA + Tunnel (The "Glass Dashboard")

This is the answer. The daemon already runs Fastify. Embed a mobile-first SPA, add a tunnel, and you can watch your builds from a park bench.

```mermaid
flowchart LR
    ZFG["gwrk daemon<br/>:18790"] -->|SSE / WebSocket| SPA["Embedded SPA<br/>:18790/dashboard"]
    ZFG -->|REST API| SPA
    SPA -->|localhost| DESKTOP["🖥️ Desktop Browser"]

    subgraph TUNNEL["🌐 Tunnel Layer"]
        NGROK["ngrok / cloudflared / tailscale"]
    end

    SPA --> TUNNEL
    TUNNEL -->|"https://your-gwrk.ngrok.io"| PHONE["📱 Mobile Browser"]

    style SPA fill:#c3c6ff,stroke:#646cff,color:#000
    style DESKTOP fill:#a2d2ff,stroke:#0077b6,color:#000
    style TUNNEL fill:#ffd6a5,stroke:#f4a261,color:#000
    style PHONE fill:#b5e48c,stroke:#52b788,color:#000
```

| Pro | Con |
|---|---|
| Zero external deps — bundled into the daemon | You're building a frontend |
| SSE from Fastify gives real-time streaming for free | Design work needed |
| Embedded at `:18790/dashboard` — one port, no CORS | — |
| Mobile-first responsive design = phone-native experience | — |
| `gwrk tunnel start` → instant remote access | — |
| Telegram handles commands; dashboard handles *watching* | — |
| Can serve Pulse + Ops + Compression in one view | — |

**Architecture Sketch**:

```mermaid
flowchart TD
    subgraph DAEMON["gwrk daemon (Fastify :18790)"]
        API["/api/status — agents, queue, system"]
        EVENTS["/api/events — SSE stream"]
        PULSE_API["/api/pulse — productivity data"]
        COMPRESS_API["/api/compression — ratios"]
        STATIC["/dashboard — embedded SPA static assets"]
    end

    subgraph REMOTE["Remote Access Layer"]
        TUNNEL_SVC["gwrk tunnel start<br/>ngrok / cloudflared / tailscale"]
        AUTH["Magic link via Telegram<br/>(time-limited JWT)"]
    end

    subgraph DASHBOARD["Glass Dashboard (mobile-first)"]
        LIVE_VIEW["Live Ops Panel<br/>Active agents · Queue · Resources"]
        PULSE_VIEW["Pulse Panel<br/>LOC trends · Specs · Repos"]
        TIMELINE_VIEW["Feature Timeline<br/>Phase progress · Gate status"]
        LOG_VIEW["Event Log<br/>Streaming events via SSE"]
    end

    STATIC -->|serves| DASHBOARD
    API --> LIVE_VIEW
    EVENTS --> LOG_VIEW
    PULSE_API --> PULSE_VIEW
    COMPRESS_API --> TIMELINE_VIEW
    DAEMON --> TUNNEL_SVC
    TUNNEL_SVC --> AUTH
    AUTH -->|"https://xyz.ngrok.io/dashboard"| DASHBOARD

    style DASHBOARD fill:#e8ecf1,stroke:#8b949e,color:#000
    style DAEMON fill:#dde3ea,stroke:#8b949e,color:#000
    style REMOTE fill:#fff3cd,stroke:#f4a261,color:#000
```

---

#### Option C: Terminal-Only (Ink TUI)

```mermaid
flowchart LR
    ZFG[gwrk daemon] --> INK["gwrk dashboard<br/>(Ink TUI in terminal)"]

    style INK fill:#c8ccd2,stroke:#444c56,color:#000
```

| Pro | Con |
|---|---|
| No browser, no port, no frontend build | Ink is explicitly deferred in the PRD (§4) |
| Fits the CLI-native ethos | Can't run while agents are using the terminal |
| Zero infrastructure | **No remote viewing at all** — you must be at your desk |

**Verdict**: Good for `gwrk status` quick checks. Dead end for the "on a walk" experience.

---

### Recommended: Option B — "Glass Dashboard" with Remote Access

#### The Insight

gwrk already has **Telegram for commands** (approve, reject, dispatch, status). What Telegram is *not* great at is the **ambient watching experience** — a live-updating view of agents working, gates firing, resources breathing. That's a visual, spatial experience that belongs in a browser.

The two channels complement each other perfectly:

| Channel | Best For | Interaction Model |
|---|---|---|
| **Telegram** | Commands, approvals, alerts, DUT ideation | Push (gwrk → you) + Pull (you → gwrk) |
| **Glass Dashboard** | Watching, monitoring, exploring, understanding | Pull (you open it and watch) |

#### Remote Access: Tunnel Options

The daemon runs on `localhost:18790`. To reach it from your phone on a walk, gwrk needs a tunnel. Three strong options:

| Tunnel | Command | URL You Get | Auth Model | Trade-off |
|---|---|---|---|---|
| **ngrok** | `ngrok http 18790` | `https://xyz.ngrok-free.app` | Token + optional OAuth | Easiest setup, free tier available, random URLs unless paid |
| **Cloudflare Tunnel** | `cloudflared tunnel run gwrk` | `https://gwrk.yourdomain.com` | Cloudflare Access (Zero Trust) | Stable URL with your domain, needs Cloudflare account |
| **Tailscale Funnel** | `tailscale funnel 18790` | `https://macbook.tail1234.ts.net` | Tailscale identity (WireGuard) | P2P encrypted, no third-party relay, already installed? |

```mermaid
flowchart TD
    subgraph HOME["🏠 Your Mac"]
        DAEMON["gwrk daemon<br/>localhost:18790"]
        TUNNEL["gwrk tunnel start"]
    end

    DAEMON --> TUNNEL

    subgraph OPTIONS["Tunnel Providers"]
        NG["ngrok<br/>https://xyz.ngrok-free.app"]
        CF["cloudflared<br/>https://gwrk.yourdomain.com"]
        TS["tailscale funnel<br/>https://mac.ts.net"]
    end

    TUNNEL --> NG
    TUNNEL --> CF
    TUNNEL --> TS

    subgraph MOBILE["📱 On a Walk"]
        PHONE_DASH["Glass Dashboard<br/>in mobile Safari/Chrome"]
        TELEGRAM["Telegram<br/>commands + approvals"]
    end

    NG --> PHONE_DASH
    CF --> PHONE_DASH
    TS --> PHONE_DASH

    style HOME fill:#dde3ea,stroke:#8b949e,color:#000
    style OPTIONS fill:#fff3cd,stroke:#f4a261,color:#000
    style MOBILE fill:#d4edda,stroke:#52b788,color:#000
```

#### The Magic Link (Telegram Auth)

You don't want to scan QR codes or copy tokens when you're leaving the house. Since gwrk is already authenticated with Telegram (Phase 3), the authentication loop for the dashboard is trivial:

```bash
You (in Telegram): /dashboard
gwrk (in Telegram): 🌐 Here's your live dashboard: 
                    https://your-gwrk.ngrok.io/dashboard?token=temp_xyz123
```

**The Auth Flow**:
1. You text `/dashboard` to the gwrk bot.
2. The daemon generates a one-time, time-limited JWT.
3. The daemon replies with the tunnel URL + the token.
4. You tap the link. The SPA loads, consumes the token, stores it in memory or `sessionStorage`, and removes it from the URL.

If the token expires or you open a different browser, you just text `/dashboard` again. Zero friction, fully secure.

#### Security Model

The dashboard is personal. It's *your* machine, *your* data. But a public tunnel demands auth:

| Layer | Mechanism |
|---|---|
| **Transport** | HTTPS (all three tunnels provide TLS) |
| **Authentication** | Magic link via Telegram `/dashboard` (short-lived JWT) |
| **Session** | In-memory token used for SSE connection auth |
| **Rate limiting** | Fastify rate-limit plugin — 100 req/min per IP |
| **Read-only by default** | Dashboard is view-only; mutations go through Telegram |

The last point is key: **the dashboard is read-only**. You *watch* through the dashboard, you *act* through Telegram. This keeps the security surface tiny — even if someone got your tunnel URL, they can only see status, not dispatch agents.

#### Mobile-First Design Principles

The dashboard must be designed for a phone screen first:

| Principle | Implementation |
|---|---|
| **Touch targets** | Minimum 44px tap targets, generous spacing |
| **Viewport** | Standard responsive meta tag, no horizontal scroll |
| **Progressive disclosure** | Summary cards → tap to expand details |
| **SSE reconnect** | Auto-reconnect when phone wakes from sleep |
| **Dark mode** | Respect `prefers-color-scheme` — you're checking on a walk at night |
| **Pull-to-refresh** | For the non-streaming panels (Pulse, Compression) |
| **Offline indicator** | Clear banner when SSE connection drops |

---

### What This Means for the Build Plan

The Glass Dashboard + tunnel is a **new spec** — it doesn't fold neatly into P6 (Pulse) because Pulse is about *productivity data* while the dashboard is about *ops visibility + remote access*. Proposed placement:

| Spec Slot | Content | Dependencies |
|---|---|---|
| `011-glass-dashboard` | Embedded SPA, SSE endpoints, mobile-first UI, Pulse/Ops/Compression views | P2 (Build Server) |
| `012-tunnel` | `gwrk tunnel` command, provider abstraction, auth, QR code | P2 (Build Server), `011` |

Or collapse into one: `011-glass-dashboard` with the tunnel as Phase 2 of that spec.

---

## 7. "Global View" — Cross-Project Resource Monitor

The dashboard's Ops View naturally extends to a **global multi-project view** — the daemon already knows about multiple repos via Pulse.

```mermaid
flowchart TD
    subgraph PROJECTS["Tracked Projects"]
        CR["code-red<br/>2 agents running<br/>CPU: 34%"]
        GF["gforge-ai<br/>1 agent running<br/>CPU: 18%"]
        GW["gwrk<br/>idle<br/>CPU: 0%"]
    end

    subgraph GLOBAL["🌍 Global Resource View"]
        TOTAL["Total System<br/>━━━━━━━━━━━━━━━━━━━<br/>CPU: ████████░░ 62% (limit: 80%)<br/>MEM: █████░░░░░ 51% (limit: 70%)<br/>Agents: 3/9 max (3 per project × 3)<br/>Clones: 3/9 active<br/>Cloud VMs: 2 (Codex)"]
        
        BREAKDOWN["Per-Project Breakdown<br/>━━━━━━━━━━━━━━━━━━━<br/>code-red:  ██████░░ 45% resources<br/>gforge-ai: ███░░░░░ 20% resources<br/>gwrk:      ░░░░░░░░ idle"]
    end

    CR --> GLOBAL
    GF --> GLOBAL
    GW --> GLOBAL
```

On your phone via the tunnel, this becomes the **"am I running hot?"** glance — one scroll tells you which projects have active agents, how much of your machine they're eating, and whether Codex Cloud is doing the heavy lifting so your laptop stays cool.
