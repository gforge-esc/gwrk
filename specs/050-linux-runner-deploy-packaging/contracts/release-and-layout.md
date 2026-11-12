# Release and layout contract

Linux releases build from a pinned Git commit. Clean Linux hosts verify and install them without a source checkout. Blocked: none.

## Release artifact and manifest

`scripts/release/build-linux-release.mjs` writes `gwrk-<version>.tgz`, `release-manifest.json` and `gwrk-<version>.tgz.sha256` from a clean build. `npm pack` supplies the files listed in `package.json`. The builder adds `pnpm-lock.yaml` to the final archive because npm excludes it. GitHub assets keep the `gwrk-<release-tag>.tgz` name used by the existing installer.

| Field | Type | Requirement | Phase |
|---|---|---|---|
| `version` | `string` | Matches `package.json` and release tag | Phase 1 and Phase 2 |
| `commitSha` | `string` | Full 40-character lowercase hexadecimal Git SHA | Phase 1 and Phase 2 |
| `builtAt` | `string` | ISO-8601 UTC timestamp injected as an input | Phase 1 and Phase 2 |
| `nodeVersion` | `string` | Node.js version from the build runtime, at least 22 | Phase 1 and Phase 2 |
| `nodeAbi` | `string` | Native module ABI from the build runtime | Phase 1 and Phase 2 |
| `platform` | `"linux"` | Explicit Linux target marker | Phase 1 and Phase 2 |
| `arch` | `"x64"` or `"arm64"` | Target CPU architecture | Phase 1 and Phase 2 |
| `tarballSha256` | `string` | 64-character Secure Hash Algorithm 256 (SHA-256) digest of tarball | Phase 1 and Phase 2 |
| `lockfileSha256` | `string` | 64-character SHA-256 digest of `pnpm-lock.yaml` | Phase 1 and Phase 2 |
| `plugins` | `PluginInventoryItem[]` | Sorted built-in agents, workflows and skills in `dist/plugins/builtins/` | Phase 1 and Phase 2 |
| `migrations` | `MigrationDigest[]` | Sorted SQL filenames and digests in `dist/db/migrations/` | Phase 1 and Phase 2 |

The release archive excludes `.gwrkrc.local.json`, `.env` and `~/.gwrk/config.json`. It also excludes SSH keys, GitHub tokens and local agent session files.

## Pure domain functions and port signatures

`src/domain/release-packaging.ts` exposes pure functions with zero filesystem, process or clock calls. `src/ports/release-ops-port.ts` declares the effectful boundaries.

```typescript
export interface PluginInventoryItem {
  readonly kind: "agent" | "channel" | "extension" | "review" | "skill" | "workflow";
  readonly name: string;
  readonly version: string;
}

export interface ReleaseManifest {
  readonly version: string;
  readonly commitSha: string;
  readonly builtAt: string;
  readonly nodeVersion: string;
  readonly nodeAbi: string;
  readonly platform: "linux";
  readonly arch: "x64" | "arm64";
  readonly tarballSha256: string;
  readonly lockfileSha256: string;
  readonly plugins: readonly PluginInventoryItem[];
  readonly migrations: readonly { name: string; sha256: string }[];
}

export interface RunnerLayout {
  readonly releaseRoot: string;
  readonly stateRoot: string;
  readonly runtimeRoot: string;
  readonly secretsRoot: string;
  readonly listenHost: string;
  readonly listenPort: number;
  readonly telegramEnabled: boolean;
  readonly credentialPaths: readonly string[];
}

export type ValidationOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly string[] };

export type RollbackCompatibility =
  | { readonly allowed: true; readonly targetVersion: string }
  | {
      readonly allowed: false;
      readonly targetVersion: string;
      readonly blockingMigrations: readonly string[];
    };

export function validateReleaseManifest(input: unknown): ValidationOutcome<ReleaseManifest>;
export function validateRunnerLayout(
  layout: RunnerLayout,
  disallowedHomes: readonly string[],
): ValidationOutcome<RunnerLayout>;
export function evaluateRollbackCompatibility(
  appliedMigrations: readonly string[],
  currentManifest: ReleaseManifest,
  targetManifest: ReleaseManifest,
): RollbackCompatibility;
```

```typescript
export interface InstanceLockHandle {
  readonly pid: number;
  readonly lockPath: string;
  release(): void;
}

export interface ReleaseOpsPort {
  acquireInstanceLock(runtimeDir: string, pid: number): InstanceLockHandle;
  readAppliedMigrations(dbPath: string): Promise<readonly string[]>;
  createConsistentBackup(input: BackupRequest): Promise<BackupManifest>;
  restoreConsistentBackup(input: RestoreRequest): Promise<RestoreVerification>;
}
```

The installer validates that the release inventory matches the archive. Rollback requires the target migration inventory to match the applied schema by filename and digest. It refuses a target that would apply a migration or lacks the digest of an applied migration. The Linux filesystem adapter resolves symbolic links before applying layout checks.

## Layout separation rules

| Root | Default Linux path | Owner and mode | Permitted contents |
|---|---|---|---|
| `releaseRoot` | `/opt/gwrk` | `root:gwrk` `0755` | Immutable `releases/<version>/` plus `current` and `previous` symlinks |
| `stateRoot` | `/var/lib/gwrk` | `gwrk:gwrk` `0750` | `gwrk.db`, `device.json`, `plugins/`, enrolled `repos/` and `backups/` |
| `runtimeRoot` | `/run/gwrk` | `gwrk:gwrk` `0750` | Ephemeral `server.lock` and `server.pid` |
| `secretsRoot` | `/etc/gwrk/secrets` | `root:gwrk` `0750` (`0640` files) | Operator-injected GitHub, headless agent and optional Slack secrets |

`validateRunnerLayout` rejects overlapping directory prefixes across the four roots. It rejects `0.0.0.0` and `::` listen addresses. It accepts loopback (`127.0.0.1` or `::1`) or an explicit private RFC1918 gateway bridge address. It rejects `telegramEnabled: true`. It also rejects paths inside laptop homes such as `~/.gwrk`, `~/.ssh` or `~/.config/gh`. Local agent folders (`~/.gemini`, `~/.claude` and `~/.codex`) also fail validation.

## Clean Linux installation procedure

`deploy/linux-runner/install-release.sh` installs a versioned tarball without a source checkout:

1. Verify `gwrk-<version>.tgz` against `gwrk-<version>.tgz.sha256` and `release-manifest.json`.
2. Check Linux platform, Node.js major `>= 22` and zero forbidden credential files inside the archive.
3. Extract into `<releaseRoot>/releases/<version>/` and run `pnpm install --prod --frozen-lockfile --ignore-scripts`.
4. Rebuild `better-sqlite3` for the target ABI and verify `<release>/dist/cli.js --version`.
5. Save the active `current` target as `previous`, then swap `current` atomically via `ln -sfn` and `mv -Tf`.
