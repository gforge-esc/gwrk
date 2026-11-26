# Webhook authentication repair review

GO for the core webhook repair at `89ac728b`. Both ingress boundaries require configured authentication before durable writes or legacy effects. Blocked: none for this repair. Hosted public exposure still requires pilot security clearance.

## Classification and scope

| Surface | Pattern | Files | Review |
|---|---|---|---|
| API | Hexagonal ingress and application ports | Five TypeScript files | API specialist rubric |

The review compares `07cb062a` with `89ac728b`. It covers two production guards and three test suites. It also checks Phase 6 gate coverage and preservation of task history. Production Google session verification and API credential verification remain outside this repair.

## Mechanical baseline

| Check | Command | Result | Target |
|---|---|---|---|
| Build | `pnpm build` | PASS | Zero type errors |
| Lint | `pnpm lint` | PASS | Zero findings |
| Focused suites | GitHub route, scoped handler and harvest service | PASS, 48 tests | Zero failures |
| Task history | Decoded ledger comparison | PASS | Earlier phases and statuses preserved |

The independent run used the private heavy-check wrapper. Its log is `/tmp/gwrk-nov23-webhook-auth-independent-review.log`. All three complete suites passed. No full repository suite ran during this focused review.

## Boundary checks

| Boundary | Verified behavior | Source |
|---|---|---|
| HTTP ingress | Rejects absent or blank configured secret before event effects | `src/server/github.ts:244` |
| Application intake | Rejects absent or blank configured secret before persistence | `src/application/harvest/index.ts:1067` |
| Signature verification | Validates raw bytes with the original nonblank secret | `src/server/github.ts:255` |
| Legacy handlers | Positive fixtures supply valid signatures | `src/server/github.scoped.test.ts:115` |
| Phase gate | Requires HTTP and direct application regressions | `specs/049-durable-dispatch-harvest/gates/phase-06.sh:7` |

The guards use trimmed content only to detect a blank secret. Signature verification receives the original secret bytes. Missing or invalid signatures still deny processing.

The nine new cases cover absent and empty secrets plus whitespace secrets. Route tests require zero operation and delivery rows. Application tests also require zero Git and gate effects. Legacy cases prohibit issue updates and notifications. The root's retained RED matrix records seven failures before repair. Two cases already denied correctly.

The signed positive fixtures preserve existing harvest and repository-scope assertions. Their helper retains an explicit invalid signature when the test supplies one. Existing raw-body signature and delivery-replay coverage remains active.

Decoded ledger comparison confirms that every earlier phase remains identical. Every task status remains intact. Startup task T035 adds the authentication regression coverage. The shared Phase 6 gate includes the HTTP and application test files.

## Blocking findings

None within this repair scope.

## Gate coverage holes

The original missing-secret hole now has route and application regressions. Legacy event effects have separate negative cases. No additional blocking hole found.

## Nonblocking notes

None added. The safe-exposure gate still requires production login and API credentials. It also requires private-origin and detailed-health protection. This verdict clears the reproduced core authentication bypass only. Final candidate integration and required CI remain the coordinator's responsibility.
