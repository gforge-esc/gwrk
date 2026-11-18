# Combined Linux rehearsal

The combined candidate passes the installed Linux container rehearsal and the complete local CI suite. Blocked: live hosted pilot remains pending.

The tested source revision was `d562dfdc`. It combines the reviewed routing changes with the ledger backup hardening and the command factory refactor.

| Check | Required result | Observed result | Verdict |
|---|---|---|---|
| Phase 4 tests on macOS | Zero failures | 243 passed, 4 platform skips | Pass |
| Complete local CI suite | Zero failures | 2938 passed, 14 skipped, 6 todo | Pass |
| Container release installation | Verified installed release | Pass | Pass |
| Credential revocation | Reject revoked fixture credentials | Pass | Pass |
| Process restart | Selected installed release healthy | Pass | Pass |
| Clean ledger restore | Persisted fixture evidence preserved | Pass | Pass |
| Guarded rollback | Reject incompatible or changed ledger | Pass | Pass |

Commands:

- `bash specs/050-linux-runner-deploy-packaging/gates/phase-04.sh`
- `CI=true pnpm test:ci`
- `node tests/linux-runner/container-harness.mjs`

The container uses synthetic credentials and an agent fixture. It does not exercise a real Google authentication gateway or authorize a production cutover. The earlier Phase 4 acceptance dispatch stopped when Antigravity exhausted its credits. This evidence supplements that failed ship record.

## Native Linux test suite

Revision `13d8eb41` passed all 230 native Linux tests across six files. The run used the pinned Linux image from the installed-release harness and pnpm 9.15.9. It included every Linux-only file and restore case.

The first native run failed 20 rollback checks before their intended assertions. The fixture inherited relative search paths from pnpm. Production rollback rejected those paths. The corrected fixture supplies an absolute service path. An added case confirms that production still rejects a relative unit path before backup or supervisor effects.

The corrected source also keeps the readiness handshake deadline and reports early child exit. Those fixture checks preserve the rollback assertions under a busy full test run.
