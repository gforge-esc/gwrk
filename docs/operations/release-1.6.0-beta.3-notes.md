# Release 1.6.0-beta.3 guide navigation repair

`1.6.0-beta.3` preserves each guide link's document and section in the portal URL. It restores the Configuration Layering contents entry and adds Chromium regression checks. Blocked: main promotion and release publication remain pending.

The portal now records guide navigation in browser history. Direct links, reload and Back and Forward restore the selected document and section. Public documentation works while the session endpoint returns HTTP 401.

The required `ci (22)` job regenerates the packaged HTML from Sphinx sources. It rejects stale artifacts, unmapped document references and missing section anchors. Browser checks cover all guide tabs and internal guide links against that packaged response. The test origin returns HTTP 404 for unserved paths.

The package and OpenAPI versions target `1.6.0-beta.3`. Installation examples and `release-as` use the same version. Release-please owns the published manifest and changelog. It creates the tag and release assets. The published manifest stays at `1.6.0-beta.2` until release-please creates the next release.

Follow [the release process](../DEVELOPMENT.md#releasing) after review. The previous [beta.2 release record](release-1.6.0-beta.2-notes.md) describes the architecture context, hosted authentication and Linux package changes included before this repair.

## Linux verification

The signed [verification envelope](../../specs/051-hosted-aws-pilot/evidence/native-evidence-envelope.json) binds reviewed source `d73fd8ff` to this runtime. Its [detached signature](../../specs/051-hosted-aws-pilot/evidence/native-evidence-envelope.sig.json) verifies against the existing operator trust anchor.

| Check | Target | Verdict |
|---|---|---|
| Native security cases | 15 cases | PASS |
| Legacy gateway proof | Exit 0 and complete cleanup | PASS |
| Release disk guards | 9 tests | PASS |
| Native lifecycle | 13 tests | PASS |
| Protected authentication files | 20 cases | PASS |
| Linux runner harness | Install, revoke, restart, restore and rollback | PASS |
| Receipt readback | 21 matching hashes and ownership checks | PASS |

The operator approved expanding the existing encrypted root volume to 48 GiB. Retention and disk preflight then passed without deletions. The root and data headroom floors remain unchanged. The prior beta.2 proof remains preserved.

The live runner stayed on beta.1 throughout verification. Fixture data was removed. Only the two gateway containers remained. The signed envelope records `livePilotAcceptance: false`. Hosted beta.3 acceptance follows deployment.

Run the native evidence gate before promotion:

```sh
node tests/hosted-pilot/gateway-production.mjs
```

After verified release installation, run the guide regression suite against the deployed portal:

```sh
GWRK_PORTAL_BASE_URL=https://gwrk.gforge.ai pnpm test:portal
```
