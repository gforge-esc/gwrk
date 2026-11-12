# Linux runner test evidence

The Linux release and layout policy passes its scoped tests. Blocked for live rollout until the hosted sign-in proof and Linux runner identity are available.

| Requirement | Evidence |
|---|---|
| Pinned release metadata | Tests reject malformed digests, missing runtime metadata, unsupported runtime versions and duplicate inventory entries. |
| Isolated paths and private bind | Tests reject overlapping roots, paths outside the secret directory, invalid addresses and Telegram activation. |
| Rollback compatibility | Tests reject changed, missing and unapplied migrations. The same tests allow an identical applied schema. |
| Linux artifact installation, supervision and restore | Pending implementation. |

The first suite run exposed seven failures against the scaffold. A second run reproduced acceptance of Node.js 20 and rollback to a release that would add a migration. All 28 release policy tests and 10 architecture tests now pass.
