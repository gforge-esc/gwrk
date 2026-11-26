# Ingress and enrollment composition review

GO for composition at `07cb062a`. The reviewed merge preserves project authorization and durable receipt behavior. Blocked: none within this review scope.

## Classification and scope

| Surface | Pattern | Files | Review |
|---|---|---|---|
| API | Hexagonal adapters | Five TypeScript files | API specialist rubric |

This review covers the manual composition in merge `23010f7f`. Its parents are durable ingress `c748517a` and enrollment `11e52fc9`. Those parent implementations already have independent review clearance. This review also checks the private-field collision repair and the adapted integration tests.

The five files are the dispatch route and server composition. They also include the dispatch route tests and durable ingress tests plus the two-repository isolation tests. Earlier phase implementation remains outside this review. Hosted production authentication remains pilot work.

## Mechanical baseline

| Check | Command | Result | Target |
|---|---|---|---|
| Build | `pnpm build` | PASS | Zero type errors |
| Lint | `pnpm lint` | PASS | Zero findings |
| Focused tests | Four relevant Vitest suites | PASS, 27 tests | Zero failures |
| Pending case | Existing test todo | One todo | Unchanged coverage marker |

The independent run used the private heavy-check wrapper. Its log is `/tmp/gwrk-nov23-independent-composition-baseline.log`. The suites cover dispatch routes and durable ingress plus server startup and two-repository isolation. All four files passed.

## Port and boundary checks

| File | Boundary | Context | Result |
|---|---|---|---|
| `src/server/routes/dispatch.ts` | HTTP adapter | Dispatch intake and reads | PASS |
| `src/server/index.ts` | Composition adapter | Project-specific sandbox ownership | PASS |
| `src/server/routes/dispatch.test.ts` | Boundary tests | Authorization and receipt projection | PASS |
| `src/server/durable-ingress.test.ts` | Integration tests | Durable acceptance and acknowledgment | PASS |
| `src/server/two-repo-isolation.test.ts` | Integration tests | Project roots and notification threads | PASS |

Authorization completes before the route calls durable acceptance. The route keeps the canonical authorized project ID. Explicit null recipients remain distinct from omitted recipients. The acceptance result retains the durable operation identity and deduplication status.

Scoped reads authorize the requested project before looking up its operation. A missing durable operation may fall back to a legacy record within the same project. The fallback passes the canonical project ID into `getDispatch`. It does not query another project's default record.

The sandbox field rename changes the subclass's private field name only. Its Git options override remains intact. Child managers retain the same factory behavior. The execution regression verifies separate worktree roots for both projects and cleanup without error.

The two-repository harvest test uses the real durable coordinator and SQLite operations store. Synthetic effect ports retain the root and thread assertions. The network guard remains active. The test isolates global configuration before constructing server transports.

## Blocking findings

None within the composition scope.

## Gate coverage holes

No new blocking coverage hole found. The producer retained hosted and local null-recipient RED evidence before repair. Its focused composition evidence records 288 passing tests. The independent review reran the four suites listed above.

## Nonblocking notes

None added. This verdict does not authorize deployment or certify production login and API credential security.
