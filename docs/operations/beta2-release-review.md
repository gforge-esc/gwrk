> Superseded by the new automatic retention requirement. Core PR #243 is draft. The earlier signed candidate below remains preserved baseline evidence, not approval readiness for the new scope.

# Beta 2 release review

The reviewed candidate is ready for David's final merge approval. The new release has not been published. The live service remains at accepted commit bb15497b. Blocked: final merge approval, owned by David.

## Review candidates

| Repository | PR | Final head | State |
|---|---|---|---|
| gwrk | https://github.com/gforge-esc/gwrk/pull/243 | cbeacfcc7a3a206a53844a448e8dc0bbf610214c | Ready for review |
| gwrk-plugins | https://github.com/gforge-esc/gwrk-plugins/pull/5 | c8e0b432a5b8a2b840beda0f0e31dc24c9c76d2b | Ready for review |

GitHub reports both PRs mergeable. The final core commit has a valid GitHub signature. Code and native-evidence reviews report no blocking findings.

## Verified outcomes

| Gate | Result |
|---|---|
| Final signed-head CI, Node 20 | PASS |
| Final signed-head CI, Node 22 | PASS |
| Build, lint and ADR checks | PASS |
| Focused portal, auth-session and install-shell tests | PASS: 42 tests |
| Consumer documentation contracts | PASS: 31 tests |
| Real extracted CLI executable regression | PASS |
| Fresh native Linux package and isolated install | PASS |
| Direct CLI and fresh/existing project smokes | PASS: 13 smokes and 25 checks |
| Native gateway scenarios | PASS: 15 cases |
| Legacy sign-in proof | PASS |
| Native protected authentication-file cases | PASS: 20 cases |
| Linux runner installation, revocation, restart, restore and rollback | PASS |
| Independent native remote-file verification | PASS: 17 main and 3 auxiliary files |
| Independent package remote-file verification | PASS: 51 files |
| Signature and current-runtime binding | PASS |
| Companion adapter tests | PASS: 9 tests |
| Companion author manifest examples | PASS: 2 examples |
| Companion registry integrity | PASS: 16 entries |

Final CI: https://github.com/gforge-esc/gwrk/actions/runs/45780552399

Reviewed source is 2f83893005d1d0638d58c936a1d2185108a6a48c. Only the two canonical evidence files changed in signed head cbeacfcc. Runtime manifest is 5e71a1cb5c9704d4b947927981bf9ad68b618297b56e40991861539f110409d0. Envelope SHA256 is f9dc44c21f1ab8adc4c7e2ad6310c2de0e12919057ab288a28f4e20970ba1b0b. Linux package SHA256 is 7936286d9b2146a463f9fbba8ada55b754e8a16b0b1257598a79a32dcda3cf2f.

The isolated proof correctly records livePilotAcceptance:false. It does not claim a live beta 2 deployment. The first local full run on Node 26 exceeded its bounded worker window. Its reported assertions are retained but do not count as a completed gate. Final supported Node 20 and Node 22 CI supplies the full-suite gate.

## Storage finding

The failure came from retained verification images on the same host as production. Root free space was 7.3 GiB against an 8 GiB staging requirement. Parent archived seven unused images with their exact OCI manifests and then evicted their Docker cache. This recovered 6.3 GiB and raised free space to 13.6 GiB. Live, accepted rollback and current candidate images stayed present. No database or storage architecture change occurred.

Automated retention, earlier capacity checks and eventual separation of heavy verification from production are operational follow-ups. They do not block this release after the verified capacity repair.

## Approval and execution order

1. Merge reviewed core PR #243 into develop.
2. Promote the reviewed source to main with required CI. Stop if unrelated source drift appears.
3. Review the generated release PR for 1.6.0-beta.2 and require actual CI. Publish the prerelease with its package, checksum, source manifest and installer.
4. Merge companion PR #5 once core main provides the new guide paths.
5. Reconcile main into develop and remove the temporary release override through the normal reviewed process.
6. Verify the actual public download and installation. Roll out the signed runtime and verify live Google login, logout and scoped API access.
7. Deliver at most two tested starting URLs: the public portal and versioned repository agent guide.

David's approval is required because he retained final merge authority. No repeat Google policy, OAuth client or ADR approval is needed. A real interactive login challenge may require David. No live project enrollment or Slack message is part of this release completion.

## Preserved evidence

Detailed local records remain under /Users/gonzo/Code/gwrk/.runs/handoff-audit-nov25/. Public canonical evidence and signature are in core PR #243 under specs/051-hosted-aws-pilot/evidence/. Original failures, RED/GREEN tests and review history remain preserved.
