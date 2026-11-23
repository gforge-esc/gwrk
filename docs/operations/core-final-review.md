# Core final review

Core implementation and independent reviews are complete for features 044 through 050. Foundations 040 through 043 remain integrated. Final merge readiness requires both CI jobs on each displayed PR head. David owns every merge.

## Review candidate

[Consolidated core PR 240](https://github.com/gforge-esc/gwrk/pull/240) combines the reviewed work against develop. PR 222 is present through develop commit `d3120324`. The cumulative feature PRs below identify review units. Do not merge them separately after the consolidated candidate.

| Feature | Cleared phases | Review unit | Final feature head |
|---|---|---|---|
| Architecture policy, 044 | PASS: four of four | [PR 236](https://github.com/gforge-esc/gwrk/pull/236) | `5a701723` |
| Workflow governance, 045 | PASS: four of four | [PR 239](https://github.com/gforge-esc/gwrk/pull/239) | `dc7da707` |
| Hermetic verification, 046 | PASS: five of five | [PR 233](https://github.com/gforge-esc/gwrk/pull/233) | `f5c285c1` |
| Model qualification, 047 | PASS: five of five | [PR 234](https://github.com/gforge-esc/gwrk/pull/234) | `543b6c2a` |
| Project identity and Slack, 048 | PASS: six of six | [PR 231](https://github.com/gforge-esc/gwrk/pull/231) | `11e52fc9` |
| Durable dispatch and harvest, 049 | PASS: six of six | [PR 235](https://github.com/gforge-esc/gwrk/pull/235) | `a37c737b` |
| Linux lifecycle, 050 | PASS: five of five | [PR 228](https://github.com/gforge-esc/gwrk/pull/228) | `a00007fb` |

All 171 tasks across these 35 phases are completed. The final recovery call returned code-review GO and acceptance-review GO. Both Node jobs passed on its reviewed source in [run 45291530534](https://github.com/gforge-esc/gwrk/actions/runs/45291530534). The final recovery head also retains the independently reviewed throttle repair. Its final-head checks are [run 45292374129](https://github.com/gforge-esc/gwrk/actions/runs/45292374129).

## Verification

Verified code source is `f8d1f2d8c5fe2618fe8c209574ad7983e8c7e56c`. Combined evidence source is `c90159ee8ad8f43ad64a535192ce6cc43638b06e`. Their differences contain operations documentation and recovery task records. Later review-packet edits change documentation only.

| Check | Target | Result |
|---|---|---|
| Build | Zero type errors | PASS |
| Lint | Zero findings | PASS |
| Full macOS suite | Zero failures | PASS: 4468 tests |
| Native Linux ARM64 Node 22 | Zero failures | PASS: 4477 tests |
| Recovery code review | No blocking findings | GO |
| Recovery acceptance review | Agreed requirements | GO |
| Throttle repair review | Unchanged deadline and scope | GO |
| Independent readiness audit | No additional core blocker | GO |
| Companion adapter tests | All nine | PASS: 9 |
| Companion manifests and digests | All sixteen | PASS: 16 |
| Conditional framework packs | All ten | PASS: 10 |

macOS skipped 16 tests and retained six todo cases. Linux skipped seven tests and retained six todo cases. No reproduced failure remains as a baseline exception. Final GitHub checks also cover the architecture decision record index and citation barrier. Exact final-head CI links belong in the PR description and delivery receipt.

| Evidence | Location |
|---|---|
| macOS full suite | `/tmp/gwrk-nov23-throttle-candidate-macos-full.log` |
| Native Linux proof | `.runs/native-linux/f8d1f2d8c5fe-final-20261123T234820Z/proof.json` |
| Native source archive SHA-256 | `beeee0fcc41ade5f018973c24bf9e6c8643d73c582d8ac8e1c84869d9066e7a8` |
| Native log SHA-256 | `fa798b3c832a2e5f66fa2609adf2a17f4ec7ee0f76072cd586b891687c8ba554` |
| Independent throttle review | [Review receipt](code-review-throttle-deadline.md) |
| CI regression history | [Repair receipt](../../specs/049-durable-dispatch-harvest/evidence/nov23-final-ci-throttle-repair.md) |
| Companion compatibility | [Compatibility receipt](companion-plugin-compatibility-nov23.md) |

The private evidence archive retains original failures and review patches. It also retains verification logs and exact operator tasks. Earlier phase checkpoints remain historical records.

## Acceptance boundary

| Requirement | Verified behavior |
|---|---|
| Initialization | Compiled CLI tests trap agent executables and assert zero inference calls |
| Existing projects | Initialization preserves source and marks architectural conformance unassessed |
| Guidance composition | Context and policy tests align architecture with language and framework selections |
| Project scope | Two-repository tests retain authorization and dispatch boundaries through recovery |
| Harvest and receipts | Durable tests cover restart and uncertain outbox state without duplicate notification |
| Model promotion | Tests require repeat evidence and independent judges plus integrity checks |

Synthetic model tests establish enforcement behavior. They do not qualify a live model or promote production pins. Slack verification used isolated fixtures. No live project enrollment or Slack message occurred.

## Merge order

1. Review and squash [core PR 240](https://github.com/gforge-esc/gwrk/pull/240) into develop under the existing repository policy.
2. Merge [Goose PR 2](https://github.com/gforge-esc/gwrk-plugins/pull/2) at `c9cb6a3` after the core contracts are available.
3. Merge [external discovery PR 3](https://github.com/gforge-esc/gwrk-plugins/pull/3) at `c0fa649`.
4. Merge [framework guidance PR 4](https://github.com/gforge-esc/gwrk-plugins/pull/4) at `df5eaa2`.

The dedicated `codex/core-review-evidence-20261123` branch preserves the consolidated ancestry. Advance it to the final verified candidate before approval. Core allows squash only and deletes merged feature branches. Companion merge commits remain available to preserve their reviewed history. No repository setting needs to change.

The active [develop ruleset](https://github.com/gforge-esc/gwrk/rules/19069993) requires `ci (22)` and blocks force pushes. Delivery also requires `ci (20)`. Verify both on each final PR head. Companion CI is unconfigured. Its local compatibility receipt supplies the recorded test evidence.

## Hosted pilot

Features 051 and 052 follow the [hosted handoff](core-to-hosted-pilot-handoff.md). The intended target is David's AWS account at `gwrk.gforge.ai`. This core review includes no live deployment or DNS change. It includes no production authentication configuration or project enrollment.

Production Google login and API credential verification remain mandatory before public exposure. Detailed health routes also require protection. The read-only Google sign-in proof does not secure the full API. [Hosted security gates](hosted-security-readiness.md)

The Google SDK has an existing skills-connection configuration. Preserve it. Alert David before Google-auth setup and use an isolated gwrk configuration. Use the CLI or Chrome for available steps. Run `gcloud init` only if needed. Verify costs before cloud changes. Supply a manual punch list only when those tools cannot complete a step.

Known [orchestration followups](orchestration-followups.md) remain separate from core acceptance. They do not reopen completed foundations.
