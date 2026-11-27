# gwrk Documentation and Reference Architecture

gwrk automates Foxtrot Charlie across discovery and definition plus shipping and delivery. Start with the [Human Consumer Guide](getting-started.md) for installation. Open the [Consumer-Agent Guide](agent-guide.md) when operating inside a target repository. Blocked: none.

> Guide version: `1.6.0-beta.3`. Source repository: [github.com/gforge-esc/gwrk](https://github.com/gforge-esc/gwrk). Companion plugins: [github.com/gforge-esc/gwrk-plugins](https://github.com/gforge-esc/gwrk-plugins).

```{toctree}
:maxdepth: 3
:caption: Guides & Reference

foxtrot-charlie
getting-started
agent-guide
cli-reference
hosted-architecture
api-reference
```

## Quick Navigation

| Guide | Audience | Purpose |
|---|---|---|
| [Human Consumer Guide](getting-started.md) | Developers and operators | Install gwrk, initialize projects, enroll hosted repos, run bounded ship loops |
| [Consumer-Agent Guide](agent-guide.md) | AI agents in target projects | Verify setup, follow target ADRs, run dry-run and isolated phases |
| [CLI Command Reference](cli-reference.md) | Humans and agents | Verify exact command syntax and operator-only admin boundaries |
| [Hosted Reference Architecture](hosted-architecture.md) | Architects and reviewers | Review hexagonal target rules (`ADR-011`, `ADR-013`) and hosted auth (`ADR-014`) |
| [HTTP API Reference](api-reference.md) | API clients and operators | Inspect route authorization policies and credential-safe request patterns |

## Repository Links

| Resource | URL |
|---|---|
| Source repository | [github.com/gforge-esc/gwrk](https://github.com/gforge-esc/gwrk) |
| Releases | [github.com/gforge-esc/gwrk/releases](https://github.com/gforge-esc/gwrk/releases) |
| Companion plugin registry | [github.com/gforge-esc/gwrk-plugins](https://github.com/gforge-esc/gwrk-plugins) |
| Support and issue routing | [SUPPORT.md](https://github.com/gforge-esc/gwrk/blob/main/SUPPORT.md) |
| Security policy | [SECURITY.md](https://github.com/gforge-esc/gwrk/blob/main/SECURITY.md) |

## Mantra

From [`docs/product/FOXTROT-CHARLIE.md`](https://github.com/gforge-esc/gwrk/blob/develop/docs/product/FOXTROT-CHARLIE.md#L124-L131):

- Discovery extracts truth.
- Definition creates clarity.
- Shipping creates throughput.
- Delivery creates value.

## The Four Pillars

| Pillar | Opening Line | Purpose | Closing Line |
|---|---|---|---|
| Discovery (Truth Extraction) | Extract truth and do not wait for it | Extract and validate truths that determine what to build | Discovery extracts truth |
| Definition (Clarity and Commitments) | Say what we will do and when | Translate truth into testable commitments with explicit ownership | Definition converts truth into commitments |
| Shipping (Execution and Learning) | Learn fast and fix fast | Build and ship small increments that surface errors early | Shipping creates throughput |
| Delivery (Value Realization) | Prove value rather than activity | Measure real-world adoption and customer outcomes | Delivery creates value |
