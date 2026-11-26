# Release 1.6.0-beta.3 guide navigation repair

`1.6.0-beta.3` preserves each guide link's document and section in the portal URL. It restores the Configuration Layering contents entry and adds Chromium regression checks. Blocked: reviewed merge and release publication remain pending.

The portal now records guide navigation in browser history. Direct links, reload and Back and Forward restore the selected document and section. Public documentation works while the session endpoint returns HTTP 401.

The required `ci (22)` job regenerates the packaged HTML from Sphinx sources. It rejects stale artifacts, unmapped document references and missing section anchors. Browser checks cover all guide tabs and internal guide links against that packaged response. The test origin returns HTTP 404 for unserved paths.

The package and OpenAPI versions target `1.6.0-beta.3`. Installation examples and `release-as` use the same version. Release-please owns the published manifest and changelog. It creates the tag and release assets. The published manifest stays at `1.6.0-beta.2` until release-please creates the next release.

Follow [the release process](../DEVELOPMENT.md#releasing) after review. The previous [beta.2 release record](release-1.6.0-beta.2-notes.md) describes the architecture context, hosted authentication and Linux package changes included before this repair.
