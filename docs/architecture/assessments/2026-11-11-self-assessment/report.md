# gwrk self-assessment

The command produced six proposed migration features from eleven reported findings. Review closes the temporary template mismatch and narrows the transport finding. Blocked: none for this assessment. The project owner decides whether to adopt the proposals.

## Provenance

The configured agy agent assessed the repository through `gwrk assess`. Its first response exposed an event-envelope parsing defect. The adapter now normalizes that envelope. The command recovered the recorded response without another model call.

This report and the feature specs include subsequent source review. [The prior gap map](../../../research/2026-11-11-architecture-onboarding-gap-map.md) records the public design context. `target.md` preserves the target supplied to the agent.

The working tree changed during the run. The local evidence archive holds the original response, reference and recovery-time provenance. The source hashes establish the recovery state.

## Reviewed findings

| Finding | State | Source | Evidence |
|---|---|---|---|
| Domain effects (F01) | Open | [src/domain/project-id.ts](../../../../src/domain/project-id.ts) | Git subprocesses in domain |
| Boundary coverage (F02) | Open | [src/architecture.test.ts](../../../../src/architecture.test.ts) | Relative static imports only |
| Physical layering (F03) | Open | [src/ports/toolchain-port.ts](../../../../src/ports/toolchain-port.ts) | Adapter construction inside port module |
| Routing policy (F04) | Open | [src/server/backend-selector.ts](../../../../src/server/backend-selector.ts) | Multiple selection policies |
| Prompt transport (F05) | Partly fixed | [src/plugins/workflow-runtime.ts](../../../../src/plugins/workflow-runtime.ts) | Enforcement expansion still needs a seam test |
| Infrastructure state (F06) | Open | [src/db/index.ts](../../../../src/db/index.ts) | Global store complicates isolated composition |
| Template mismatch (F07) | Closed | [src/domain/architecture-context.ts](../../../../src/domain/architecture-context.ts) | Re-init now matches the current renderer |
| Policy routing (F08) | Open | [src/domain/types.ts](../../../../src/domain/types.ts) | Design absent from typed profiles |
| Workflow guidance (F09) | Open | [src/plugins/builtins/workflows/gwrk-plan/PROMPT.md](../../../../src/plugins/builtins/workflows/gwrk-plan/PROMPT.md) | Legacy folder guidance |
| Governance visibility (F10) | Open | [src/engine/discover.ts](../../../../src/engine/discover.ts) | Target and assessment absent from discovery |
| Delivery evidence (F11) | Open | [vitest.config.ts](../../../../vitest.config.ts) | Quarantine and unhandled-error masking |

## Review corrections

The template mismatch was transient. The renderer changed during inspection. Re-init now reproduces the checked-out context. Keep the determinism regression test rather than scheduling a repair for that observation.

The live run reproduced the Antigravity envelope defect. Adapter normalization and WorkflowRuntime consumption now cover it. Tests also cover recorded-response recovery without dispatch.

The claim that the placeholder prompt suppressed stdin was not reproduced. The live agent received the assessment instructions. The remaining transport work should prove complete payload delivery and enforcement expansion through a captured dispatch test.

`src/server/agent-registry.ts` re-exports domain configuration. It is a compatibility shim rather than an independent registry implementation. Multiple routing policies still need consolidation. Remove the shim only after migrating its consumers.

Infrastructure state is not inherently a functional-core violation. The database singleton needs explicit composition because it complicates isolation. Domain effects remain a separate architectural defect.

The decision index already displays Proposed and Decided statuses. Preserve the existing uniform index contract. Add explicit conflict guidance and tests rather than dropping Proposed records from grounding.

## Feature sequence

1. [Domain purity and boundary gates](specs/01-pure-domain-and-boundary-gates/spec.md)
2. [Port and adapter separation](specs/02-port-adapter-physical-separation/spec.md)
3. [Unified routing and prompt delivery](specs/03-unified-agent-dispatch-and-stream-contracts/spec.md)
4. [Architecture-aware policy selection](specs/04-architecture-aware-profile-and-skill-routing/spec.md)
5. [Workflow guidance and governance visibility](specs/05-hexagonal-workflow-prompts-and-governance-readiness/spec.md)
6. [Hermetic integration checks and blocking lint](specs/06-hermetic-ci-and-lint-enforcement/spec.md)

The integration work depends on adapter separation and unified dispatch. It can proceed alongside policy selection once those dependencies pass.

## Prior gap reconciliation

| Prior gap | Reviewed state | Remaining work |
|---|---|---|
| No architecture selection model | Improved | Typed profile propagation |
| Re-init resets prompt defaults | Resolved | Preserve regression coverage |
| No greenfield ADR bootstrap | Resolved | Human adoption remains explicit |
| Custom corpus mismatch | Resolved | Preserve custom-path coverage |
| No standards selection in profile | Open | Propagate project design |
| No architecture manifest selector | Open | Add architecture selectors |
| Conditional standards injection | Open | Test the workflow dispatch seam |
| Language skills exclude reviews | Resolved | Language manifests now cover review |
| Core conventions apply universally | Improved | Scope remaining repository-only rules |
| JavaScript baseline absent | Open | Add language baseline |
| Architecture checks miss effects | Open | Strengthen import rules |
| Generic clean-code checks absent | Open | Add scoped laws and boundary checks |
| No architecture readiness evidence | Improved | Expose assessment scope in discovery |
| Installed versions are machine state | Open | Track project policy versions |
| Framework rules lack shared contract | Improved | Assess external pack compatibility |
| Prompt layout remains legacy | Open | Update planning guidance |
| Skill seeding uses absent source | Improved | Repair the separate plugin seed command |

## Verification limits

The agent executed twenty-four targeted tests. All passed. Its inspection sampled representative modules rather than every runtime file. It did not inspect the external `gwrk-plugins` checkout.

The implementation validation records the broader hermetic suite and command-line acceptance checks. See [validation](../../../../specs/039-architecture-context/validation.md). Existing quarantines and todo cases remain outside that claim.

The proposed specs require project review before adoption. They describe the remaining work and its acceptance criteria.
