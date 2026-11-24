# Phase 2 test repair review

GO for test-only repair `cf9deb1d8001d78668bd838fc9c7c80f724643ac`. Blocked: none in the two reviewed coverage findings. The coordinator may compose the tests before Phase 2 implementation.

Review compares the repair with parent `b4e3f35d`. It covers the SQLite test changes and their matrix and evidence. No tests reran. No dependency or source file changed.

## Creation rollback

The failure trigger requires an existing binding for the new credential before aborting the next grant insertion. Both grants refer to enrolled projects. The trigger permits either insertion order. The expected trigger error distinguishes injected failure from early input rejection.

Reopened storage must contain neither the credential nor its bindings. Existing enrolled projects must survive. The raw fixture proof includes a nontransactional negative control that leaves partial rows. This closes the prior absence of failure after writes.

## Independent contention

A separate Node process opens its own SQLite connection. The ready message precedes the parent transaction. The parent holds an uncommitted insert until the child returns its observation attempt. This creates lock contention independently of parent event-loop scheduling.

The insertion requires SQLite busy or locked denial while the parent owns the writer lock. A fresh operation after commit must retain the original cap. The revocation stage allows either contention denial or the previously committed live row. After the parent commits revocation, a fresh child operation must deny authentication. Reopen checks the cap and revocation plus a single session row.

The test requires no automatic retry policy. A short child busy timeout bounds lock waits. IPC requests have five-second deadlines. Cleanup rolls back any parent transaction and closes the child. A one-second shutdown deadline sends SIGKILL if needed.

## Evidence

The retained raw proof records five passing harness checks. It does not replace future adapter execution. The module RED accurately records an absent adapter with no collected tests. All manifest entries match their current files.

No blocking contract mismatch prevents the approved implementation. The prior sequential tests remain as controls. Native Linux and actual adapter gates remain later obligations.

Nonblocking fixture note: injected failures currently require the SQLite marker and error code to propagate. If the adapter wraps repository errors, preserve a controlled failure signal rather than weakening rollback assertions.
