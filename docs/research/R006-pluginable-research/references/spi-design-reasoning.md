# SPI Design Reasoning — Why v4, Not v3

> **Status:** Research Reference — Design Decision Record  
> **Date:** 2026-06-26  
> **Consumed by:** [R006 draft.md Q6-Q7](../draft.md)  
> **Supersedes:** v3 (Capability Layers — REJECTED as "conceding rather than properly architecting")  
> **Key Reference:** [Windows/Linux API Analysis](Architectural%20Analysis_%20Core%20Differences%20Between%20Windows%20and%20Linux%20APIs.md)

---

## Why v3 Was Wrong

v3 proposed three patterns (Kernel + Modules, Microkernel, Capability Layers) and recommended the weakest one — "keep the kernel fixed, add layers." That's not architecture. That's avoidance. It says "we have gaps, let's plug them" without asking the prior question: **what is the stable boundary?**

The Windows/Linux reference answers this question precisely. Both operating systems succeed not because of what they expose, but because of **where they draw the stability line**:

- **Linux**: The syscall ABI is the stable boundary. Everything below (kernel internals) can change freely. Everything above (glibc, userspace) builds against the stable syscalls.
- **Windows NT**: The Win32 DLL layer is the stable boundary. Everything below (ntoskrnl.exe, NtCreateFile) can change freely. Everything above (applications) links to the stable DLLs.

Both systems make the same fundamental trade: **hide the implementation, stabilize the interface.** The difference is WHERE they place the interface — Linux at the kernel/userspace boundary, Windows at the subsystem DLL layer.

**gwrk already has this structure. It just hasn't named it.**

---

## The Three Questions, Re-Answered

### (a) Can plugins mutate core gwrk functionality?

**Yes — through the SPI, not around it.**

Just as a Windows application cannot modify ntoskrnl.exe but CAN replace what kernel32.dll dispatches to (via DLL redirection, manifests, or subsystem layering), a gwrk plugin cannot modify the ship orchestrator but CAN replace what it dispatches to.

The existing resolution chain already supports this:

```
Project-local (.gwrk/plugins/) > Global (~/.gwrk/plugins/) > Builtin (src/plugins/builtins/)
```

This IS the mutation mechanism. A project that installs a project-local `gwrk-implement` workflow **replaces how implementation works** for that project. The ship orchestrator doesn't change — it still calls `WorkflowRuntime.executeWorkflow("gwrk-implement", ...)` — but what it dispatches to is completely different.

**R006 already proved this.** The draft showed that `gwrk-research-jtbd` replaces the research methodology without touching any core code. Same mechanism: workflow name → plugin resolution → project-local override. The architecture doesn't need a new "command" plugin type. It needs **the same workflow resolution that R006 already designed, applied consistently.**

### (b) Can plugins attach to existing command structure? (Discoverability)

**Yes — but the CLI is a thin routing layer, not the extension point.**

This is where v3 went wrong. It proposed making the CLI extensible (adding a `command` plugin type). That's the Linux approach — "let userspace add new syscalls." But gwrk is NT-shaped: the CLI should be a **thin, stable routing layer** that dispatches to the plugin resolution chain.

Commands don't need to be dynamic. What's behind them does.

```bash
# The CLI is fixed. The resolution is dynamic.
gwrk define research R006 --methodology jtbd
#     │      │                          │
#     │      │                          └── Resolves to workflow: gwrk-research-jtbd
#     │      └── Subcommand: dispatches to WorkflowRuntime
#     └── Pillar: Definition
```

Discoverability comes from **introspection of the SPI**, not from scanning for command plugins:

```bash
gwrk define research --list-methodologies   # Scans workflows matching gwrk-research-*
gwrk plugin list --type workflow            # Shows all installed workflows
gwrk plugin info gwrk-research-jtbd         # Manifest details
```

This is exactly how R006 designed it. The `--list-methodologies` flag queries the PluginLoader for workflows matching a naming convention. No dynamic CLI registration needed.

**The same pattern works for reasoning:**

```bash
gwrk define reasoning specs/017 --modes equilibrium-diagnosis
#     │      │                          │
#     │      │                          └── Resolves to enforcement skills + reasoning prompt
#     │      └── Subcommand: dispatches to WorkflowRuntime
#     └── Pillar: Definition

gwrk define reasoning --list-modes          # Scans skills matching reasoning-*
```

Reasoning is a subcommand of `define` — not a new top-level FC entry. This is consistent with research being under `define`. Both are **pre-definition** cognitive work. Both dispatch through `WorkflowRuntime`. Both use plugin resolution for methodology selection.

### (c) Can plugins modify core functionality without touching command structure?

**This is not a concession. This is the primary architectural power.**

v3 treated behavioral modification (enforcement, grounding, extensions) as "Pattern C — what's already there." That framing dismissed it as leftover capability. Wrong.

Behavioral modification through the SPI is **the "everything is a file" of gwrk**. Just as Linux's unified file descriptor model lets you `write()` to a socket, a pipe, or a terminal without knowing which, gwrk's behavioral injection lets you modify how ANY command thinks without knowing which command is running.

An enforcement skill with `scope: all` injects into:
- `gwrk define spec` prompts
- `gwrk define research` prompts
- `gwrk ship` (implement, review, diagnose) prompts

One plugin. Every command. No CLI changes. No workflow changes. No manifest changes. Just a `SKILL.md` and a `manifest.yaml` dropped into `.gwrk/plugins/skills/`.

**"New language or project template" example:**

```
.gwrk/plugins/skills/python-django-conventions/
  SKILL.md          ← Django coding standards, project layout expectations
  manifest.yaml     ← type: skill, tier: enforcement, language: Python, framework: Django
```

Result: every agent dispatch for this project — implement, review, diagnose, research, spec — gets Django conventions injected. No commands added. No workflows replaced. The ship loop's DIAGNOSE phase knows about Django error patterns. The spec workflow knows about Django's app structure. The implement workflow follows Django idioms.

**This is not Pattern C. This is the whole point.** The enforcement skill system is gwrk's equivalent of Linux's `/proc` and `/sys` — a universal interface that makes every subsystem configurable without touching the subsystem's source code.

---

## What Changes vs. v3

| v3 Proposal | v4 Correction |
|------------|--------------|
| Add `command` plugin type | ❌ Rejected. CLI is a thin routing layer. |
| Reasoning as FC top-level entry | → Reasoning as `gwrk define reasoning` (subcommand, like research) |
| "Pattern C is what's already there" | → Behavioral injection IS the architecture, not a concession |
| "Capability Layers" (add missing layers) | → **Stable Plugin Interface (SPI)**: name what exists, extend through it |
| Dynamic CLI registration | → Introspection via `--list-*` flags on existing commands |

---

## Design Principle: No Magic Values

> *"I hate debugging magic values of any kind in any setting."*

The default "reasoning" in any gwrk dispatch is whatever the underlying agent model imposes when executing gwrk's populated prompts. That's not reasoning — that's **opaque model behavior**. The user has no visibility into why the agent chose a particular approach, no ability to override it, and no way to debug it when it makes wrong choices.

**gwrk's reasoning value is making the implicit explicit:**

- Every reasoning constraint the agent follows should be traceable to a **configured enforcement skill**, a **grounding document**, or a **workflow PROMPT.md** — never to opaque model training weights.
- When `gwrk ship 014` dispatches an implement agent, the user should be able to answer: "What coding standards were injected? What domain context was provided? What reasoning methodology was applied?" by inspecting `.gwrk/plugins/skills/`, `.gwrk/ontology/`, and the workflow PROMPT.md.
- If a reasoning mode like `equilibrium-diagnosis` is active, it's because the user **explicitly installed** a reasoning workflow or enforcement skill — not because someone hardcoded a prompt fragment into the ship orchestrator.

This principle applies across the SPI:

| Layer | Magic Values (Bad) | Explicit Configuration (Good) |
|-------|-------------------|-------------------------------|
| **Enforcement** | Hardcoded coding standards in PROMPT.md | `.gwrk/plugins/skills/conventions/SKILL.md` |
| **Grounding** | Domain terms embedded in workflow prompts | `.gwrk/ontology/domain.md` |
| **Reasoning** | Model decides how to analyze a problem | `gwrk define reasoning --modes X` dispatches explicit methodology |
| **Profile** | Hardcoded `if (language === "Python")` guards | `.gwrkrc.json` declares profile, enforcement skills auto-filter |
| **Agent** | Hardcoded model selection per command | `AgentRouter` selects based on capability mapping in agent manifest |

**The SPI's stability contract includes this transparency guarantee:** a principal architect can audit every behavioral influence on any gwrk command by inspecting the plugin resolution chain, the project profile, and the grounding documents. No hidden prompts. No embedded heuristics. No magic values.

---

## SPI Versioning

SPI versioning is independent of gwrk semver:
- **SPI version** tracks the plugin contract (the 7 stable interfaces)
- **gwrk version** tracks the CLI and core internals

Separate version numbers prevent confusion when internals change but the SPI doesn't (or vice versa). UX transparency is critical — principal architects, contributors, and users must see which SPI version a plugin targets.

---

## References

| Document | Role in This Analysis |
|----------|----------------------|
| [Windows/Linux API Analysis](Architectural%20Analysis_%20Core%20Differences%20Between%20Windows%20and%20Linux%20APIs.md) | The "where is the stable boundary?" question |
| [R006 Draft](../draft.md) | Proof that workflow plugins ARE the extension model |
| [R006 Brief](../brief.md) | "Research plugins are project-scoped... same infrastructure" |
| [loader.ts](../../../../src/plugins/loader.ts) | 3-tier resolution chain (project > global > builtin) |
| [manifest.ts](../../../../src/plugins/manifest.ts) | 6-type plugin taxonomy + enforcement scope |
| [extension-runtime.ts](../../../../src/plugins/extension-runtime.ts) | ContextProvider interface |
| [profile-detector.ts](../../../../src/engine/profile-detector.ts) | Auto-detection + override |
| [skill-runtime.ts](../../../../src/plugins/skill-runtime.ts) | Enforcement skill resolution |
| [cowork-w-reasoning-skills.md](cowork-w-reasoning-skills.md) | Proof that the reasoning→draft pipeline works through workflow dispatch |
