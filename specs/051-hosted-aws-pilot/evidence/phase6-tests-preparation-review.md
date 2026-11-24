# Phase6 caller test preparation review

GO for test preparation commit `a3eb91523473b0de4435c92e073b230fb2dfdf74` and execution manifest `18ca0db90e07b2a731b448e24c78ac35cd229b85`. No blocking findings. This verdict permits implementation against the prepared tests. It grants no Phase6 completion or deployment clearance.

## Scope

The commit adds three caller test files and updates the gap matrix. The following commit adds only the definition execution manifest. The candidate was clean at the manifest head. All four prepared file hashes match the test commit. I reviewed the exact Phase6 plan and canonical deployment and production-auth contracts. Prepared config and reader components remain outside this diff. The prepared factory and status components also remain unchanged.

## Coverage

Startup tests run both foreground start and internal startup through the real CLI. A wrapper retains the real server and disables signal handling only for fixture cleanup. The tests require denial before listening or PID writes. They cover missing hosted mode and explicit local mode on a hosted runner. They also cover incomplete settings and conflicts across the project and registry fallback loaders.

The config case preserves typed auth separately from environment values. It rejects malformed typed data without silently stripping it. Protected-reader failures use the existing programmatic seam. They test caller refusal and static errors rather than duplicating native file-ownership proof.

Successful startup cases require hosted transport on loopback. They exercise signed Google tokens and the injected JWKS response. Real SQLite credentials must authenticate through the startup-owned auth bundle. A changed allowlist must affect the next decision. The local status fixture requires private minimal health without readiness claims. Its real redirect listener must receive no follow-up request.

Import tests reset the module cache before importing CLI and auth modules. They observe protected-file paths and process and fetch effects. The initialization control invokes the real CLI against a temporary project. Executable traps and network spies retain inference-free initialization coverage. These are controlled caller tests rather than a universal system-call audit.

Continuity uses a real file-backed SQLite ledger. It closes the first server and reopens the same database for a second server. Existing auth and operations adapters remain real. Injected worker and notification ports prevent live work. The assertions preserve operation IDs and recipient scope. They check webhook deduplication and denied cross-project access. Persisted API revocation and browser logout must deny replay without canceling previously accepted work.

## Actual RED

The fresh focused receipt reports 10 failed assertions and two passing initialization controls across three suites. Duration is 3.71 seconds. There are no suite-load failures or timeouts. The failures reach missing caller behavior rather than fixture setup exceptions.

Config parsing strips server.auth. Invalid startup cases currently return success. Loopback startup accepts forged headers. Local server status calls detailed health rather than private minimal health. Continuity stops at the factory receiving local mode because config parsing removed auth settings.

Later assertions within those cases remain unexecuted at this RED boundary. In particular, the receipt does not yet prove successful restart or post-revocation behavior. Implementation must run them through completion and preserve their assertions. I ran no duplicate heavy tests. The coordinator separately reported a fresh successful build.

## Nonblocking note

The protected-file failure case contains a stale comment saying not to mock the reader constructor, immediately above that mock. The fixture and nearby scope explanation correctly describe a caller-wiring test. Correct the comment when editing this file. It does not change test behavior or readiness.
