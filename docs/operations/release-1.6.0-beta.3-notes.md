# Release 1.6.0-beta.3 daily-driver candidate

`1.6.0-beta.3` combines scoped Slack dispatch and App Home with the portal guide repairs. Blocked: final merge, release publication and hosted Slack acceptance remain pending.

Guide links preserve their document and section. The Configuration Layering contents entry is restored. The portal now records guide navigation in browser history. Direct links, reload and Back and Forward restore the selected document and section. Public documentation works while the session endpoint returns HTTP 401.

The required `ci (22)` job regenerates the packaged HTML from Sphinx sources. It rejects stale artifacts, unmapped document references and missing section anchors. Browser checks cover all guide tabs and internal guide links against that packaged response. The test origin returns HTTP 404 for unserved paths.

The package and OpenAPI versions target `1.6.0-beta.3`. Installation examples and `release-as` use the same version. Release-please owns the published manifest and changelog. It creates the tag and release assets. The published manifest stays at `1.6.0-beta.2` until release-please creates the next release.

Follow [the release process](../DEVELOPMENT.md#releasing) after review. The previous [beta.2 release record](release-1.6.0-beta.2-notes.md) describes the architecture context, hosted authentication and Linux package changes included before this repair.

## Slack

App Home lists authorized projects and resolves status through verified project checkouts. It rechecks membership and checkout identity after asynchronous loading. Missing or changed scope cannot use the startup project as a fallback.

Slash commands support `/gwrk <command> --project <slug>` in shared channels and direct messages. Durable intake preserves the selected project and its notification recipient. Direct-message dispatch posts progress to the verified project channel. A queue without durable intake rejects foreign-project dispatch. Project operators cannot pause a shared global queue.

Failed dispatch intake acknowledges once and settles its action receipt. Feature status finds queued and running phases under the selected project. Replay protection and durable notification delivery remain in place.

Operators must apply the [Slack manifest](../../src/slack-manifest.yml) and approve its permissions before live acceptance. Added history scopes require Slack app reinstallation. Hosted provider login, project enrollment and role bindings remain separate rollout prerequisites. Verification used fixtures and sent no Slack messages.

## Linux verification

The signed [verification envelope](../../specs/051-hosted-aws-pilot/evidence/native-evidence-envelope.json) binds reviewed source `c9fc815f` to this runtime. Its [detached signature](../../specs/051-hosted-aws-pilot/evidence/native-evidence-envelope.sig.json) verifies against the existing operator trust anchor.

| Check | Target | Verdict |
|---|---|---|
| Local test run | 5,866 tests across 385 files | PASS |
| Linux Slack regression suites | 333 tests across 16 files | PASS |
| Native security cases | 15 cases | PASS |
| Legacy gateway proof | Exit 0 and complete cleanup | PASS |
| Release disk guards | 9 tests | PASS |
| Native lifecycle | 13 tests | PASS |
| Protected authentication files | 20 cases | PASS |
| Linux runner harness | Install, revoke, restart, restore and rollback | PASS |
| Receipt readback | 21 matching hashes and ownership checks | PASS |

The first native attempt stopped on a disk-usage watchdog timeout. Its failure receipts remain preserved. The final proof used a fresh staged fixture with unchanged resource limits. A rejected checkpoint reuse did not produce native acceptance.

The local run also recorded six skipped suites. It had 18 skipped tests and six todo cases.

The operator approved expanding the existing encrypted root volume to 48 GiB. Retention and disk preflight passed. Fresh staging reclaimed two eligible artifacts without cleanup failures. The root and data headroom floors remain unchanged. The prior beta.2 proof remains preserved.

The live runner stayed on beta.1 throughout verification. Fixture data was removed. Only the two gateway containers remained. The signed envelope records `livePilotAcceptance: false`. Hosted beta.3 acceptance follows deployment.

Run the native evidence gate before promotion:

```sh
node tests/hosted-pilot/gateway-production.mjs
```

After verified release installation, run the guide regression suite against the deployed portal:

```sh
GWRK_PORTAL_BASE_URL=https://gwrk.gforge.ai pnpm test:portal
```
