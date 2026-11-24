# Phase 2 test contract review

NO-GO for complete Phase 2 test coverage at commit `a56a0715`. Two database coverage gaps remain. The test author owns the additions before implementation proceeds.

## Scope

Read-only review covers credential crypto tests and SQLite store tests plus command tests and the gap matrix. Frozen ports and approved Phase 2 requirements supply the review boundary. No production defect is claimed because the implementation modules remain absent.

| File | Boundary | Status |
|---|---|---|
| `src/adapters/auth/credential-crypto.test.ts` | Driven crypto adapter | PASS |
| `src/adapters/sqlite/auth-store.test.ts` | Driven store and atomic grant ports | FAIL: incomplete failure and contention coverage |
| `src/commands/auth.test.ts` | CLI and application secret delivery | PASS |
| `specs/051-hosted-aws-pilot/gap-matrix.md` | Coverage claims | FAIL: session race claim exceeds assertions |

## Blocking findings

```text
REVIEW FAIL (api): Creation rollback coverage
  WHERE: src/adapters/sqlite/auth-store.test.ts:466-487
  EXPECTED: The approved spec requires a crash or rollback during creation to leave no partial credential or role rows after reopen. See spec.md TR-009 and the atomic creation requirement.
  ACTUAL: The negative creation case supplies an unenrolled project. An implementation can validate all projects before writes and pass without a transaction around subsequent inserts. Rotation has SQLite trigger failures. Creation has none.
  FIX: Add a SQLite trigger that aborts a valid grant insert for a new credential after creation starts. Require the original failure and reopen the database. Assert that the credential and every associated binding are absent. Keep valid enrollment and all existing assertions.
  GATE: MISSING (coverage hole in src/adapters/sqlite/auth-store.test.ts)
```

```text
REVIEW FAIL (api): Session contention coverage
  WHERE: src/adapters/sqlite/auth-store.test.ts:222-334
  EXPECTED: The approved plan requires real two-connection observation and revocation race tests. Atomic observation must preserve the original cap and committed revocation.
  ACTUAL: Every operation completes synchronously before the next connection acts. The test verifies visibility and reopen persistence. It cannot distinguish an atomic observation from separate read and insert operations under overlapping writers.
  FIX: Add bounded independently scheduled SQLite writers with a controlled contention boundary. Observe the same digest from competing connections and require one original row without cap extension. Exercise observation after a revocation commit while the competing operation remains pending. Keep the sequential and reopen cases.
  GATE: MISSING (coverage hole in src/adapters/sqlite/auth-store.test.ts)
```

## Verified strengths

Rotation uses real SQLite triggers at grant insertion and old-key revocation. It checks rollback and persistence after reopen. CLI tests exercise exclusive secret files outside the checkout. They check file modes and raw-secret output denial. Direct use-case delivery failures inspect orphan revocation. Frozen port calls preserve the existing role-binding authority.

## Nonblocking notes

The crypto comparison cases prove correctness on equal and malformed digests. Constant-time behavior still requires source review of the implementation. Test names alone do not establish that property.

The unreadable-directory CLI fixture assumes an unprivileged test user. Keep the direct delivery-error case for environments where root can write despite permission bits.

## Evidence limits

The coordinator retains the missing-module RED receipts. This review runs no heavy checks and changes no candidate files. These findings concern missing assertions rather than observed production behavior. No deployment or live authentication occurred.
