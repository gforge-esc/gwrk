# Native verification

The staging driver runs retention and disk preflight before copying source or calling Docker. Blocked: none.

Run this source-controlled driver on the verification host. Python 3.12 or newer and Node.js 22 must already exist. Docker and `flock` must also exist. The lifecycle package must contain the reviewed retention helper and its standard-library imports. Verify its digest against the approved package record. A verified candidate archive built elsewhere can provide this bootstrap before publication.

Create a private configuration file with canonical absolute paths. Create `runsRoot` and `dataParent` before staging. The driver creates `dataRoot` as a direct child of `dataParent`.

```json
{
  "runsRoot": "/opt/gwrk-verification",
  "dataParent": "/var/lib/gwrk",
  "dataRoot": "/var/lib/gwrk/verification-fixtures",
  "rootPath": "/",
  "stagingOwner": { "uid": 0, "gid": 0 },
  "dataParentOwner": { "uid": 0, "gid": 0, "mode": "0750" },
  "earlyBuildBytes": 17179869184,
  "earlyDataBytes": 12884901888,
  "dataBudgetBytes": 12884901888,
  "node": "node"
}
```

The early estimates reserve anticipated staging writes. They must cover the planned build and fixture data. The later archive-derived estimate must remain within `dataBudgetBytes`. Both checks preserve 8 GiB on root and the data estimate plus 4 GiB on the data filesystem.

```sh
python3 deploy/verification/stage-native-proof.py stage \
  --config /etc/gwrk/native-stage.json \
  --run-id "$RUN_ID" \
  --source-archive "$SOURCE_ARCHIVE" \
  --source-sha256 "$SOURCE_SHA256" \
  --source-commit "$SOURCE_COMMIT" \
  --runtime-manifest-sha256 "$RUNTIME_MANIFEST_SHA256" \
  --purpose acceptance \
  --lifecycle-archive "$LIFECYCLE_ARCHIVE" \
  --lifecycle-sha256 "$LIFECYCLE_SHA256"

python3 deploy/verification/stage-native-proof.py exec \
  --config /etc/gwrk/native-stage.json \
  --run-id "$RUN_ID" \
  -- node "$PROOF_ENTRYPOINT" "$PROOF_CONFIG"
```

The source archive must contain this driver without changes. Staging verifies both archive digests before creating a run. The driver extracts only the retention bootstrap files from the lifecycle package. Candidate dependencies and candidate compilation never provide that bootstrap.

Staging takes an exclusive run lease and creates the owner record. It claims fixture data only after creating a new data directory. Retention and heavy staging execute under the shared retention lock. Children inherit both descriptors. A timeout kills the owned process group before releasing protection. Commands have a one-hour timeout. The preflight timeout is fifteen minutes.

Proof execution takes the same run lease and shared retention lock. It validates the stored source identity and data estimate before measuring disk space again. A shared root and data filesystem must retain the estimate plus 8 GiB. Separate filesystems retain 8 GiB on root and the estimate plus 4 GiB on data. The lock remains held through the proof child and its outcome record.

Only the constrained heavy payload paths and positively owned verification images can expire. Proofs and source identities remain. Owner records and checkpoints also remain. Every container reference protects its image. Pinned base images remain outside owned disposable images.

A failed stage can retry only before it creates staging payloads or fixture data. Existing payloads require a new run ID and remain untouched. An unowned existing directory prevents staging. Interrupted runs become eligible for automatic retention after their leases become free. A proof interrupted after staging requires review of its retained receipts before another run.

Review the prior failure before retrying a failed proof. Add `--retry-failed` to `exec` after that review. The driver preserves the failed owner record under `proof-attempts/` before starting another attempt. It repeats the checkpoint identity checks and disk checks under both locks. Existing proofs and checkpoints remain unchanged. Completed runs cannot retry.

```sh
python3 deploy/verification/stage-native-proof.py exec \
  --config /etc/gwrk/native-stage.json \
  --run-id "$RUN_ID" \
  --retry-failed \
  -- node "$PROOF_ENTRYPOINT" "$PROOF_CONFIG"
```

# Release builds

`node scripts/release/build-linux-release.mjs OUTPUT_DIR [RELEASE_TAG]` invokes the Python standard-library supervisor before Git archive creation, dependency installation or compilation. No candidate build or dependency installation supplies this guard.

The supervisor groups workspace, pnpm store and output estimates by backing filesystem. Default estimates are 4 GiB, 2 GiB and 1 GiB. It adds 8 GiB of root headroom or 4 GiB on each separate data filesystem. Low space prevents all build child operations.

`GWRK_RELEASE_WORKSPACE_BYTES`, `GWRK_RELEASE_CACHE_BYTES` and `GWRK_RELEASE_OUTPUT_BYTES` override the three byte estimates. Use estimates that cover the planned writes.

`GWRK_RELEASE_BUILDS_ROOT` selects the owned build root. `GWRK_RELEASE_CACHE` selects the pnpm store. Both default below the system temporary directory. The builder passes that store to pnpm and keeps packing scratch files inside the guarded workspace. The supervisor retains the two newest inactive payloads. It preserves unknown entries and durable receipts. An abandoned build becomes failed only after its lease becomes free.

The shared build lock remains held through the child process. Each child also inherits its run lease. The guarded worker verifies both kernel locks and their filesystem identities. It also validates the owned workspace and successful preflight receipt. Build ownership and preflight receipts remain after the payload expires. Cache and release output files are measured but never removed by retention.
