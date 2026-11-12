# Domain purity verification

The boundary gate reports zero violations in the domain. The identity, registry and toolchain tests exercise the same adapters that the runtime uses. Blocked: none for local validation.

| Phase | Observed failing test | Passing check |
|---|---|---|
| Boundary gate | Regex missed package imports and matched prompt text | TypeScript syntax tree fixtures and the live boundary scan |
| Project identity | Pure identity functions were absent | Fixed digest, working-directory invariance and linked worktrees |
| Agent registry | Pure layer validation was absent | Layer precedence, typed errors, startup failures and optional model fallback |
| Toolchain discovery | Pure manifest policy was absent | Explicit override, package manager precedence, malformed manifests and adapter composition |

The unexempted scan exposed nine violations across the three affected domain modules. Each migration removed its entries. The scan also exposed three direct engine imports from the Slack server. They now pass through the notifications adapter. The existing harvest and issue tests cover those call paths.

Run `gwrk gate 040` to exercise all seven behavioral gates. The phase commands live in [the implementation plan](plan.md).
