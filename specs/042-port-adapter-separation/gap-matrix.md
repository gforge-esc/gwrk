# Port and adapter test evidence

The boundary and store tests reproduced five failures. The candidate fixes pass in the port and adapter worktree. Blocked for ship until the domain boundary review passes.

| Requirement | Test | Baseline |
|---|---|---|
| Port contract ownership | `src/utils/toolchain-mapper.test.ts` checks the runtime export set | Fails. The port exports a factory and file classification helpers. |
| Port dependency direction | `src/architecture.test.ts` checks type-only imports and exports | Failed before the checker recognized runtime imports from the domain. |
| Adapter ownership | `src/architecture.test.ts` checks legacy module re-exports | Failed before the checker recognized infrastructure re-exports. |
| Store isolation | Two file-backed adapters write through distinct connections | Failed when the stores used the default connection. Passes with isolated connections. |
| CLI isolation | Overlapping normal and agent commands use distinct sinks | Pending |

The same run passed the 18 existing toolchain cases.

The toolchain change passed 122 scoped tests. The adapter change passed 43 scoped tests.

The CI suite passed 1,770 tests after the store change. A scratch project used the CLI to initialize and render its plan.
