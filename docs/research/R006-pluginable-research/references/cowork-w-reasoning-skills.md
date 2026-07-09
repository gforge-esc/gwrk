# Job Queue Technology Selection — Research Draft

> **Status:** Draft — Awaiting Review
> **Initiative:** [R001-queue/brief.md](./brief.md)
> **Consumer:** Async Processing design doc

## Executive Summary

Three self-hostable candidates fit the infra policy: RabbitMQ, Redis Streams, and NATS JetStream. All three provide at-least-once delivery, which satisfies the core durability requirement that the current in-process dispatch entirely lacks. The differentiator is not raw capability — it is operational burden against a 2-person platform team that is already on-call constrained.

The recommendation is **Redis Streams**, but for a different reason than the one offered in the source notes. The notes argue for it on speed ("fastest, will scale forever"); that claim is an unbenchmarked hallway opinion and is not the basis here. The real basis is operational: Redis is already operated in-cluster with an existing runbook and backup story, so it adds at-least-once delivery without adding a new stateful service to on-call — directly addressing the platform team's stated constraint. RabbitMQ is the close second and the safer pick if ordering turns out to be a hard requirement.

One assumption is doing quiet work and must be resolved before the spec: whether per-image ordering is actually required. It is asserted in the notes but was never confirmed, and the system being replaced never provided it. This is flagged as an Open Item.

## Q1 — Delivery and ordering guarantees

### Findings
- All three candidates provide **at-least-once** delivery: RabbitMQ via manual acks, Redis Streams via consumer-group acknowledgement, NATS JetStream via persisted streams [Source: eng-sync.md].
- The current system provides **none** — process death loses queued and in-flight jobs, and exceptions are swallowed with no retry [Code: dispatch.py:5-6,19-20].
- Ordering: RabbitMQ preserves per-queue order; Redis Streams preserves per-stream order; JetStream preserves per-subject order. Whether *per-image* ordering is required is unconfirmed [Requires Decision — see Open Items].

### Recommendation
At-least-once is met by all three, so it is not a differentiator. Treat ordering as an open requirement, not a settled one, until Q's owner confirms it against the processing logic.

## Q2 — Self-hosting fit

### Findings
- Infra policy mandates in-cluster self-hosting for stateful workloads; managed options are out [Source: platform-constraints.md]. This is consistent with the brief's anti-pattern and was honored — no managed service is evaluated.
- Redis is **already operated in-cluster** with an existing runbook and backup story [Source: platform-constraints.md]. Redis Streams reuses that footprint.
- RabbitMQ and NATS JetStream are both self-hostable on k8s but would each be a **new stateful service** requiring a new runbook and backup story [Source: platform-constraints.md; Inferred: applies the doc's "new stateful service" cost to these two specifically].

### Recommendation
Redis Streams has the lowest marginal footprint because it rides existing infrastructure. RabbitMQ/JetStream are viable but each adds a net-new operational surface.

## Q3 — Operational burden

### Findings
- The team has **2 platform engineers and an already-strained on-call** [Source: platform-constraints.md]. Ops burden is a primary constraint, not a tiebreaker.
- A new stateful service adds on-call surface, a runbook, and a backup story [Source: platform-constraints.md].
- RabbitMQ has operator experience on the team (Marco) [Inferred: experience-based, per eng-sync.md — not a benchmarked or documented claim].
- Nobody has run NATS JetStream in prod [Source: eng-sync.md] → highest unknown-operational-risk of the three.

### Recommendation
Rank by marginal ops burden: **Redis Streams (reuses existing) < RabbitMQ (new, but known) < JetStream (new and unknown)**.

## Deliverable 1 — Comparison table

| Candidate | Delivery guarantee | Self-hosting fit | Ops burden |
|---|---|---|---|
| **Redis Streams** | At-least-once (consumer groups) | Reuses Redis already in-cluster | Lowest — existing runbook/backup |
| **RabbitMQ** | At-least-once (manual acks) | New stateful service, k8s-friendly | Medium — new, but team has experience |
| **NATS JetStream** | At-least-once (persisted) | New stateful service | Highest — new and no prod experience |

## Deliverable 2 — Recommendation with trade-offs

**Recommend Redis Streams**, on operational grounds: it delivers at-least-once without adding a new on-call surface to a constrained 2-person team.

Trade-offs accepted:
- *Shared failure domain* (surfaced by red-team): co-locating the queue on the existing Redis means a Redis incident takes down both caching and job processing. The draft's "reuses existing infra" benefit carries this blast-radius cost — it should be an explicit operating decision, possibly a separate Redis instance, not a silent inheritance.
- *Runbook reuse is partial, not free* (surfaced by red-team): the existing Redis runbook covers caching, not consumer-group semantics, acks, or stream trimming. Some net-new operational knowledge is required even on familiar infrastructure.
- *If per-image ordering is a hard requirement and a single stream becomes a throughput bottleneck*, Redis Streams' sharding story is more hands-on than RabbitMQ's. This is the main capability risk; it is unquantified because no benchmark exists and the ordering requirement is unconfirmed.
- *The speed argument in the notes is not part of this rationale* — it was an unbenchmarked opinion. If throughput later proves to be the real constraint, this recommendation should be revisited with an actual benchmark.

**What the recommendation withstood:** a decision-forge pass attacked the pick as status-quo bias. The operational case survived because the on-call constraint is documented and real, but the pass exposed a shared-failure-domain risk and an overstated runbook-reuse claim, both now folded in above.

**Fallback: RabbitMQ**, if the ordering Open Item resolves to "strict per-image ordering required" and Redis Streams' approach proves too operationally hands-on.

## Consumer Alignment Notes
- The design doc should spec Redis Streams consumer groups with explicit ack-on-success and a retry/dead-letter path (the current system has neither).
- The doc must state the ordering decision once resolved; do not inherit the notes' unconfirmed assumption.

## Open Items
- **[Requires Decision] Is per-image ordering actually required?** Asserted by Priya in eng-sync.md, never confirmed; the replaced system provided no ordering [Code: dispatch.py:13]. This decision flips the fallback to primary if the answer is "strict ordering required." Needs the design-doc owner to confirm against processing semantics.
