# Linux startup ownership fixture

The Linux CI failure came from an obsolete test spy. Hosted startup already invokes the scoped sandbox manager. The fixture now observes that owner and preserves the startup and ledger recovery assertions. Blocked: none.

## Cause

The test sets `GWRK_RUNTIME_DIR`, which selects hosted startup. Enrollment composition makes the hosted registry active even when it contains no projects. `startLockedServer` therefore creates `ScopedSandboxManager`.

That class overrides `pruneSandboxes`. The old test spied on `SandboxManager.prototype.pruneSandboxes`, so it recorded zero calls. Startup awaited the scoped override as intended. The base and scoped methods both prune Git worktrees. The scoped method also supplies the target root and Git environment.

The native RED fixture observed both hooks. It verified one scoped prune call before failing the original assertion that expected one base call. This distinguishes an observation defect from missing production startup work.

## Change

The fixture now observes `ScopedSandboxManager.prototype.pruneSandboxes`. It still requires one startup prune after rejecting a duplicate process. It also verifies a second prune on restart and distinct scoped owners for the two server instances.

The test verifies the exact isolated SQLite path and a new connection after restart. The persisted recovery marker must remain available. The original process lock, PID removal and health assertions remain intact. The independent SIGKILL recovery test still verifies lock inode reuse.

No production source changed. The repair adds no timing wait and removes no pruning assertion. No live Slack delivery or deployment occurred.

## Verification

| Check | Result | Target |
|---|---|---|
| Native Linux RED | Reproduced, 1 failed; 2 passed | Original CI failure |
| Native Linux focused GREEN | Pass, 45 tests across 3 files | Zero failures or skips |
| Native build | Pass | Zero type errors |
| Local build | Pass | Zero type errors |
| Local lint | Pass | Zero findings |

The focused GREEN run covers Linux instance recovery, two-repository isolation and server integration. Linux tests executed on Linux rather than skipping on macOS.

## Provenance

Source head is `16d409af9a970ceb694fac3f9fc0b4c422e643b6`. Both source snapshots include that tracked tree plus their recorded fixture variant. The pinned Node image digest is `sha256:7702d8aa4d5910871692af4480eb3ba86f23047a6417a44d857d06c95d060d3f`.

The runtime reports Node `v22.23.4` on Linux arm64 with kernel `7.0.12-linuxkit`. The proof uses the existing Docker-based native Linux workflow. The bootstrap and test commands have bounded timeouts. The shared heavy-check wrapper controls test capacity.

Private evidence remains in `.runs/native-linux-startup-ownership-nov23/`. `proof.json` records both archive digests and the fixture patch digest. Each variant retains its source archive and native log. `verify.sh red` and `verify.sh green` reproduce the variants with the pinned image.

The CI source logs came from enrollment run `45274058328` and combined run `45274654992`. Both reported the base-spy failure. They are retained beside the native evidence. No commit or push occurred during this repair.
