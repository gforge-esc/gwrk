# Core compatibility

The companion plugins are compatible with the checked core contracts. No blocker reproduced. This verification uses synthetic inputs and makes no qualification or promotion claim.

## Sources

| Source | Commit |
|---|---|
| Core integration | `9361efe65bafb25fd503239255ab660ce3c95446` |
| Companion proof | `f40af40b8ad873c100a2d50defe1105e4556844b` |
| Core model qualification final | `543b6c2a340584777709171c21a2cac3f611055e` |
| Core webhook authentication repair | `89ac728be54c07d1bd50fde0bc04cbab058d644c` |

## Results

| Check | Result |
|---|---|
| External adapter tests | PASS: 9 of 9 |
| Current core manifest schema | PASS: 16 of 16 |
| Current core registry digest function | PASS: 16 of 16 |
| Exact model forwarding | PASS: 4 adapters |
| Synthetic discovery and core store round trip | PASS: 3 discovered models |
| Conditional architecture guidance | PASS: 10 framework packs |
| Retired Gemini backend directory and registry entry | PASS: absent |
| Antigravity reference | PASS: core provides `agy` |

The manifest population contains four agents, ten framework skills and two review strategies. Verification imports the current core `AnyManifestSchema` and `computePluginDigest` implementations. Every registry version matches its manifest and digest.

Aider, Cursor and OpenCode discovery results satisfy the core discovery snapshot schema. The check writes and reads their synthetic catalog through the core route lock store. Goose supports exact model forwarding and uses explicit candidates. Discovery checks inject command output. They do not launch an agent or query account access.

All four adapters retain the selected model ID and workflow context. Catalog discovery describes availability. Manifest defaults remain compatibility aliases rather than qualified pins. The README states that distinction and requires core qualification before promotion.

The core separates runner discovery and evaluation evidence from active worktree prompt validation. Its store-backed resolver verifies a bundle hash before trusting its catalog digest. These rules require no companion storage change. The companion supplies discovery data and dispatch arguments. It does not create promoted locks or evaluation evidence.

The retired `gemini` backend is absent from the companion tree and registry. Remaining Gemini names identify provider model families. The README points users to core Antigravity and its `agy` command.

Each framework pack conditions its hexagonal functional guidance on project selection. The rules keep domain decisions separate from effects and framework boundaries. They do not claim that existing project code conforms to that architecture.

## Merge order

| Order | Pull request | Verified head | Required core contract |
|---|---|---|---|
| 1 | [Goose forwarding, PR 2](https://github.com/gforge-esc/gwrk-plugins/pull/2) | `c9cb6a3` | Model forwarding capability and selected model dispatch |
| 2 | [External discovery, PR 3](https://github.com/gforge-esc/gwrk-plugins/pull/3) | `c0fa649` | Optional discovery context and runner-scoped catalog schema |
| 3 | [Framework guidance, PR 4](https://github.com/gforge-esc/gwrk-plugins/pull/4) | `df5eaa2` | Language and framework manifests plus selected architecture context |

Use this publication order for the final companion receipt. The proof tree already contains all three heads. Its recorded composition merged framework guidance before Goose forwarding and external discovery. The combined result passes the current core checks. The core model qualification final supplies the reviewed routing and evidence rules. Keep that dependency in the release receipt.

All three pull requests remain open against `main`. This preparation does not merge them.

## Continuous integration

The proof head has zero GitHub check runs and zero commit statuses. The status API returns `pending` with an empty status list. This is not a passing check. The companion tree contains no GitHub Actions workflow files. The local verification above supplies the recorded test evidence.

## Evidence

The final private receipt is `.runs/core-compatibility-throttle-final-nov23/manifest.json` in the companion proof checkout. It records logs and compiled module digests. The verifier imports the final core build directly. Earlier receipts remain in `.runs/core-compatibility-nov23/`. The source includes throttle repair `f8d1f2d8`. Its compiled contract module hashes match the earlier final receipt. Later changes add review records and documentation.

The final recheck changed no tracked source or documentation. It made no commits or pushes. No live inference or promotion ran. No authentication probes ran. The companion proof branch records this report in metadata commit `35933eb`. Verified plugin source remains `f40af40`.
