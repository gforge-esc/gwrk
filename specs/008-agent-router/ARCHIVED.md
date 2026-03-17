# ⚫ F008 — RETIRED (2026-03-17)

> **Folded into:** F014 Phase 4: Routing Intelligence
> **Decision:** [plugin-strategy-audit.md](file:///Users/gonzo/Code/gwrk/docs/reference/plugin-strategy-audit.md)
> **ADR:** [ADR-006](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-006-plugin-agent-backends.md)

F008's agent registry conflicted with F014's plugin registry (same domain, different schemas). Quota probing is CLI-specific knowledge that belongs in AgentBackend adapter plugins. Routing intelligence (quota-weighted selection, fallback chains, historical learning) survives as F014 Phase 4.

**Original spec and plan preserved below for reference.** Do not implement from these files — they reference the pre-plugin `.gwrkrc.json` agent registry which is superseded.
