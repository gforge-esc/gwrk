# Phase 5 rate admission

Use one bounded origin store with request reservations before authentication. The coordinator approved this component after independent architecture review. Blocked: Phase 7 must verify proxy-login admission before public acceptance.

## Authority

| Source | Status |
|---|---|
| Parent source `1f4e454c80d0270519f94988ea02ce189ec3e85d` | Clean design base |
| Approved Phase 5 plan | Bounds before authentication and operational handlers |
| Frozen security policy | 60 login/IP, 60 unauthenticated API/IP, 120 verified API/credential per 60 seconds |
| Frozen storage policy | 1000 total buckets, 120 seconds idle retention |
| Existing plugin probes | Default storage, bare refunds and response-time accounting fail required cases |

The existing probe receipts are in `/Users/gonzo/Code/gwrk/.runs/aws-hosted-pilot-nov23/rate-limit-prep-evidence/`. They use stub authentication. They do not establish production authentication acceptance.

## Admission sequence

| Stage | Operation | Denial effect |
|---|---|---|
| Login serving boundary | Consume login/IP quota | No login work |
| API before expensive verification | Reserve unauthenticated IP slot synchronously | No verifier call |
| Authentication failure or abort | Finalize reservation without refund | Original IP charge remains |
| Verified context available | Finalize once, refund its original charge if still current, consume verified quota | No operational handler if quota denied |
| Reply cleanup | Drop request reference to finalized handle | No second accounting operation |

The 61st simultaneous unverified attempt from one IP receives a denial before authentication. A successful verification releases its temporary IP charge. This permits 120 valid sequential requests to reach the credential quota. Request 121 fails that quota before intake.

Authentication failure consumes the IP allowance regardless of HTTP response timing. A missing or conflicting credential never selects a credential bucket. The verified key comes only from `VerifiedAuthContext.authMethod` and `credentialId`. Google context already uses a token digest as its credential ID.

## Admission boundary

The component uses this boundary in `src/ports/rate-admission-port.ts`. Existing authentication ports remain unchanged.

```ts
type Reservation = OpaqueStoreOwnedHandle;
type Decision =
  | { allowed: true }
  | { allowed: false; reason: "quota" | "capacity" | "reservation_invalid" | "closed" | "store_error";
      retryAfterMs?: number };

type Reserved =
  | { allowed: true; reservation: Reservation }
  | Exclude<Decision, { allowed: true }>;

interface RateAdmissionPort {
  consumeLogin(input: { trustedIp: string }): Decision;
  reserveApi(input: { trustedIp: string }): Reserved;
  completeVerified(input: {
    reservation: Reservation;
    credential: Pick<VerifiedAuthContext, "authMethod" | "credentialId">;
  }): Decision;
  completeUnverified(input: { reservation: Reservation }):
    { settled: boolean };
  expire(): void;
  close(): void;
}
```

The adapter reads its injected clock for each operation. Admission and finalization commit synchronously without an intervening await. Verification occurs between `reserveApi` and one terminal completion. A denied or throwing operation cannot authorize the handler. The HTTP adapter maps decisions to the approved error contract. These proposed internal reasons are not new HTTP error codes.

No caller supplies a clock value through the port. Pure policy receives the adapter's observed time explicitly.

The store owns opaque handles. It binds each to its original IP bucket and immutable window generation. Handle validation compares its recorded original generation. It does not require that generation to remain the bucket's current generation. Finalization requires an existing handle with matching private identity and original generation. It removes the handle once. Duplicate calls fail closed without another refund or credential charge. An unverified terminal completion cannot later become verified. No completed-handle tombstone or result cache is required.

A successful identity check releases the reservation even when the verified quota denies the request. Invalid authentication and abandonment retain their original IP charge. Handler success, failure and response hooks do not alter this accounting.

## Generations and bounds

| State | Bound and ownership |
|---|---|
| Bucket map | One shared maximum of 1000 entries across all three classes |
| Current counter | At most its configured quota; denied attempts do not grow it |
| Current window | Fixed 60-second deadline plus immutable generation identity |
| Live reservations per IP | At most 60 across all generations |
| Store-owned live handles | At most 60000, derived from 1000 buckets times 60 |
| Reservation lifetime | At most 120 seconds from creation, derived from existing idle retention |
| Completed result | No completed-handle cache or tombstones |
| Cleanup | At most one owned scheduler, bounded scan of at most 1000 buckets |
| Store children | Share the same map, capacity and handle ownership |

Pending reservations pin their IP bucket until completion or their fixed expiration. They remain subject to the 60-inflight bound after a window rollover. Each expires 120 seconds after creation. Later traffic cannot extend that deadline. Cleanup removes expired handles and releases their pins even if the caller omits cleanup. No history caches are added.

Each request retains only its own handle until cleanup. The limiter does not retain completed or expired handles. This bounds limiter-owned state. It does not claim a bound on unrelated Fastify request memory or application work.

At rollover, the bucket gets a new counter and generation. An unexpired old successful completion can consume the verified quota at completion time. It cannot decrement the new IP generation. Old failure finalization also cannot mutate the new counter. Retain only each live handle's original generation identity. Keep no historical counter map. An expired or missing handle fails closed. It cannot refund any IP generation or consume a new credential quota. Every completion checks expiry independently of scheduler timing.

A bucket with live reservations is active. Never evict it or another active bucket to admit a new key. An idle bucket without reservations is removed after 120 seconds. Saturation denies new keys while retaining existing counts. Failed quota attempts do not increase stored counters beyond their limit. A plugin callback may report an exceeded sentinel without storing a growing overflow count. Cleanup scans at most 1000 buckets and their bounded reservation slots. Every entry point checks relevant handle deadlines. Close clears the single owned scheduler and all state. An abandoned reservation can reduce availability only until its fixed expiry. A pending verifier still completing after expiry receives a denial. The handler never runs for that result.

Keys contain only normalized trusted IPs or verified credential identifiers with a fixed class namespace. Trusted IP normalization admits at most 45 ASCII characters. API identifiers retain the existing 1-to-64-character format. Google identifiers use 64 hexadecimal characters. Generation IDs and private reservation IDs use fixed-size 36-character UUIDs from the standard crypto adapter. No token material becomes an ID. Reject an oversized internal identity instead of allocating it. Do not retain raw credentials or request headers as keys.

## Pure policy and effects

Pure domain functions take validated policy and current state facts. Time is an explicit input. They return decisions and state transitions. They perform no clock or map effects. They import neither Fastify nor the plugin.

The in-memory adapter applies those transitions to the single owned map. Its constructor receives policy and clock. The server adapter gets the trusted IP from the configured proxy boundary. It uses that normalized full address without an implicit IPv6 subnet grouping. It gets credential identity from the existing verified-context reader. This adds no authentication authority.

Use `src/domain/auth-rate-policy.ts` for pure transitions. Use `src/ports/rate-admission-port.ts` for the boundary. Use `src/adapters/auth/rate-admission.ts` for state ownership. The planned `src/server/auth-bounds.ts` owns HTTP integration. Component tests run in the Phase 5 and Phase 8 gates.

## Maintained plugin boundary

Pin the reviewed maintained plugin version 11.3.0. Its custom store exposes `incr` and `child`. It also permits `read` and `decr`. Its manual limiter does not return a reservation generation or handle. A bare key-based refund cannot establish ownership. [Official types](https://github.com/fastify/fastify-rate-limit/blob/v11.3.0/types/index.d.ts), [official implementation](https://github.com/fastify/fastify-rate-limit/blob/v11.3.0/index.js).

Use a custom store wrapper backed by the same state owner for plugin children. Reservation operations use the typed extension above. Do not use the plugin's bare refund as the verification transition. Unsupported bare decrement fails closed. Ordinary plugin consumption and reservation transitions share one counter implementation. One path charges each request. There is no second shadow limiter or response-time failure counter.

The plugin remains infrastructure. Its callbacks and HTTP types do not enter the pure policy or admission port. A store failure never becomes an allowance. No queue or automatic retry is introduced.

## Concurrent admission

A 120-request valid burst from one IP can arrive before any identity has been verified. The first 60 reserve admission. The remaining requests receive 429 even if their credentials would later verify. They do not wait. The same behavior follows if 60 failed attempts already consumed the current IP allowance.

The proposal therefore guarantees the verified quota for sequential valid traffic within the minute. It does not guarantee a 120-request concurrent burst from one IP. The coordinator adopted this conservative admission consequence for the pilot. Increasing the initial allowance or trusting unverified credential hints would contradict the current unauthenticated limit.

## Behavioral verification

| Case | Observable assertion |
|---|---|
| 61 concurrent invalid attempts with a verifier barrier | Exactly 60 verifier calls, attempt 61 denied before verifier, zero handler effects |
| 120 sequential valid requests within one minute | 120 handler effects, request 121 denied by credential quota |
| 120 concurrent valid requests before verifier release | At most 60 initial verifier calls; excess requests denied without a queue |
| Failed authentication and aborted verification | Original IP charge remains; duplicate cleanup never changes counters |
| Valid request at credential exhaustion | IP reservation finalized once; no handler effect; duplicate finalization cannot charge twice |
| Delayed completion after rollover | New-generation failure count unchanged; verified quota charged at completion time |
| Replay handle against another store or credential | Fail closed, no refund and no new accepted work |
| Old generations with stalled verification | Per-IP pending count stays at most 60; live handle count stays within the derived global bound |
| Abandoned reservation at 120 seconds | Cleanup releases handle and pin without caller cooperation; late completion refunds nothing and charges no credential |
| Completion before scheduler has swept an expired handle | Expiry check fails closed; zero handler effects and no quota mutation |
| Oversized IP, credential or handle identity | Rejected before state allocation; existing key length bounds remain intact |
| Mixed login, IP and credential buckets | One combined capacity of 1000, including plugin children |
| 1001st active key | Denied while existing counts survive; no active eviction |
| Idle expiry and cleanup | Capacity reclaimed after 120 idle seconds; pending buckets remain active; close clears scheduler |
| Repeated denials and finalization | Counters and auxiliary state remain bounded without per-denial records |
| Forged public identity and malformed credentials | No verified bucket selected and no browser fallback |
| Store failure or close | Denial with zero accepted work |

Use a fake injected clock and explicit verifier barriers. Use real Fastify injection for hook ordering and plugin child sharing. Assert verifier calls and handler effects separately. Add real local parser tests for header bounds in the later Phase 5 implementation. This proposal runs no heavy test or live request. The coordinator approved the conservative direction and the TTL-derived stale-handle rule during preparation. Independent architecture review approved the origin component. The proposal digest is `12e80caf3c489e4cb7a0572b5caf08dedc49faae356821b9ee7daa96128f404c`.

## Gateway handoff

The origin limiter does not protect proxy-owned `/oauth2/start` or callback traffic by itself. `consumeLogin` may remain unwired during component preparation. Phase 7 must review and test the actual gateway admission boundary before public acceptance. This contract does not approve a new private endpoint or claim that separate processes share this map. Phase 5 cannot claim proxy-login protection from the origin limiter alone.
