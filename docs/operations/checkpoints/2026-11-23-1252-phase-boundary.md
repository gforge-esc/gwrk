# Core implementation checkpoint

The integration candidate includes cleared durable coordination. Blocked: model routing and project scope repairs remain under review. The coordinator owns integration and final verification.

## Cleared work

| Feature | Cleared phases | Evidence |
|---|---|---|
| 044 Architecture policy | All four | Final CI run 44439554353 PASS |
| 045 Workflow governance | All four | Final CI run 45246332986 PASS |
| 046 Model discovery | All five | Final CI run 44391585085 PASS |
| 047 Model qualification | First four | Phase 4 CI run 44452741392 PASS |
| 048 Project identity and Slack | First four | Phase 4 CI run 44450110915 PASS |
| 049 Durable dispatch and harvest | First four | Phase 4 CI run 45247992333 PASS |
| 050 Linux lifecycle | All five | Final CI run 44426644228 PASS |

The combined candidate is `e36e6692` on `codex/full-feature-integration-nov18`. Its durable composition build and lint pass. Its six-file durable gate passes all 84 checks. The full combined suite passes all 4,276 tests. It skips 16 tests and retains six todo cases. Evidence is `/tmp/gwrk-nov23-durable4-combined-full-ci.log`. Native Linux verification needs a refresh on the final combined head.

## Active workers

| Assignment | Branch | Worktree under its parent | Model |
|---|---|---|---|
| Model qualification Phase 5 | `feat/047-model-qualification` | `model-phase4-red-nov18/.runs/sandboxes/047-model-qualification-ship-7f585869` | Codex Astra |
| Slack scope Phase 5 | `feat/048-project-identity-slack` | `slack-phase4-prep-nov18/.runs/sandboxes/048-project-identity-slack-ship-03ea735f` | Antigravity Neon High |
| Durable ingress Phase 5 | `feat/049-durable-dispatch-harvest` | `durable-next-phases-nov18/.runs/sandboxes/049-durable-dispatch-harvest-ship-2de95b05` | Antigravity Neon High |

Each parent lives under `/Users/gonzo/Code/gwrk-worktrees`. Each branch has one writer. Each bounded ship call selects one phase with `--worktree --max-iterations 2`. Inference capacity is three occupied slots. Heavy verification uses a separate two-slot limit. Review and CI waits release inference capacity.

## Blocking findings

Model routing committed `1952cd32` but failed the required phase gate. Its second bounded attempt is diagnosing the result. Passing gates and independent reviews remain required.

Slack completion must preserve the caller receipt while deriving an authorized Slack recipient. Thread hints must not override project ownership. Three restored regressions fail before repair. The worker owns both findings.

Durable HTTP acceptance currently acknowledges work without a durable operation. The new real SQLite regression proves that failure. The ingress worker must preserve receipt replay and authorization while composing the approved coordinator ports.

## Completion dependencies

Durable ingress Phase 5 releases durable command status and recovery Phase 6. Slack Phase 5 releases project enrollment interfaces Phase 6. These paths proceed in parallel with model qualification Phase 5.

After those phases clear review, integrate their final heads. Run combined gates and native Linux checks. Require both CI jobs on each final evidence head. Align companion plugin documentation and manifests with the final implementation. Present pull requests and merge order for David's approval.

## Subsequent scope

Hosted pilot and project rollout remain features 051 and 052. This implementation prepares interfaces and handoffs. Live deployment and DNS changes remain external prerequisites. Google authentication setup and project enrollment also remain external.

## Native Linux follow-up

The immutable `0b126495` full Linux run passes 4,283 tests but fails two Git-manager fixtures. Both fail while creating their initial commit. The fixtures depend on a host Git identity. Evidence is `/tmp/gwrk-nov23-native-0b126495-full.log`.

The repair uses the existing isolated Git fixture helper with an explicit test identity. It preserves branch creation and merge-conflict assertions. Both repaired tests pass locally. Evidence is `/tmp/gwrk-nov23-native-git-fixture-host-green.log`. A fresh native Linux run must verify the repair.
