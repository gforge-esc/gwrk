# Port and adapter test evidence

The toolchain port exposes five runtime exports. Blocked for production changes until the domain boundary review passes.

| Requirement | Test | Baseline |
|---|---|---|
| Port contract ownership | `src/utils/toolchain-mapper.test.ts` checks the runtime export set | Fails. The port exports a factory and file classification helpers. |
| Store isolation | Two file-backed adapters write through distinct connections | Pending |
| CLI isolation | Overlapping normal and agent commands use distinct sinks | Pending |

The same run passed the 18 existing toolchain cases.
