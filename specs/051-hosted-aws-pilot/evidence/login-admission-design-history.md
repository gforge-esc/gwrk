# Login admission design history

The coordinator approved the revised login-admission design after independent architecture review. Final merge approval remains human-owned. This receipt records design history only. It provides no runtime or deployment clearance.

| Artifact | SHA-256 |
|---|---|
| Initial proposal | `2f19c29b7532d4221655b90ffca64e354e02777599d8c93cc4b7fb64357abf18` |
| Initial REVISE review | `15ede5d46cc63fb05b711bb62da8c1833c6def019ca42f3a2a809456c4da52bf` |
| Revised proposal | `fa08477c72672927671082b4e242dcdaca0ddc83db757676373aeb1608e857d4` |
| Independent APPROVE review | `a7dd5dbd3fc660666c8a37df3eb42189cf158bdeaa1f8ac66ccdc2d256f676fe` |

The initial review required changes for header restoration and implicit transport retries. It also required exact peer trust and an explicit denial-response invariant. The revised design resolves those concerns through a scoped accounting amendment and a defined header lifecycle. It retains the shared owner and introduces no endpoint or replay state.

The private source artifacts remain preserved in the coordinator's run evidence. The proposal folder is `.runs/phase7-login-admission-design/` in the independent review checkout. The review folder is `.runs/aws-hosted-pilot-nov23/phase7-login-admission-independent-review/` in the main checkout. Hashes above identify the reviewed contents without local path assumptions.

The tracked [login admission boundary](../contracts/login-admission-boundary.md) carries the approved constraints. Implementation must observe synthetic RED and preserve native evidence before live acceptance. Existing phase states and gate inventories remain unchanged. Architecture Decision Record 14 remains Proposed and awaits human ratification.
