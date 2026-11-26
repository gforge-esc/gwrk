# Proxy logout adapter review

GO for commit `e10c8714955f76970974a38cccc69e7621ec94bd`. No blocking findings. Blocked: none within this adapter review.

## Scope

Review covers only `src/adapters/auth/proxy-logout.ts` and its tests. The frozen ProxySessionLogoutPort and deployment boundary commit `7353b33d` define the contract. Origin revocation remains in application orchestration. HTTP integration owns later origin cookie clearing.

| File | Layer or port | Bounded context | Status |
|---|---|---|---|
| `src/adapters/auth/proxy-logout.ts` | Driven adapter | Hosted authentication | PASS |
| `src/adapters/auth/proxy-logout.test.ts` | Adapter behavior | Hosted authentication | PASS |

## Verification

| Evidence | Result | Review action |
|---|---|---|
| Manifest | PASS: 16 matching hashes | Recomputed every listed hash |
| Adapter cases | PASS: 31 | Inspected assertions and receipt |
| Related cases | PASS: 121 across four files | Read final related receipt |
| Build and lint | PASS | Read retained receipts |
| Linux Node 20 smoke | PASS | Read isolated runtime receipt |
| Linux Node 22 smoke | PASS | Read isolated runtime receipt |

Candidate receipts reside under `.runs/proxy-logout-prep/` in its worktree. This review repeats no heavy baseline check. The Linux smokes cover the adapter with local Responses and disabled networking. They do not prove a deployed proxy configuration.

## Boundaries

The adapter calls the fixed loopback sign-out URL. Its request contains Cookie only and disables redirect following. It returns no Location or upstream error text. Imports and construction perform no transport request or filesystem read. Frozen port types remain unchanged.

Success accepts a 302 response only when validated clearing headers cover every supplied production session-cookie name. Separate chunk headers retain their values and Expires commas. The adapter requires empty cookie values and effective deletion attributes. It rejects missing chunks and duplicate or unexpected clearing names. Positive Max-Age cannot produce a false clearing result. Header bounds and unsafe input checks run before successful return.

A shared-policy timeout bounds transports that ignore cancellation. Immediate and late response bodies receive cancellation. Failure paths return a fixed code and message. The tests retain behavioral RED receipts for numeric Expires parsing and injected clock receiver handling.

## Blocking findings

None. No missing assertion establishes a blocking defect within the reviewed adapter scope.

## Nonblocking notes

The adapter also accepts 303 with validated clearing headers. A direct positive case would document that branch alongside the existing 200 and 302 cases.

The deletion-header parser rejects contradictory Expires even when Max-Age would take precedence in a browser. This is conservative failure behavior. The production proxy configuration must still produce the approved clearing headers during later integration.

## Limits

This verdict covers adapter preparation. It does not complete Phase 3 or claim live logout acceptance. The candidate worktree and frozen operator remain unchanged. No cloud operation or authentication request occurred.
