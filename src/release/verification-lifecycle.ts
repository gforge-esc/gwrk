/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Verification staging entry point. Node standard library only.
// `deploy/verification/stage-native-proof.py` extracts this file and its
// relative imports from a verified gwrk package. The driver holds the run
// lease, then the retention lock, and passes the lock descriptor here.

import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type DockerRunner,
  combineRetentionPorts,
  createDockerImageAdapter,
} from "../adapters/release/retention-docker.js";
import { createFdLockProof } from "../adapters/release/retention-lock.js";
import { createVerificationRootAdapter } from "../adapters/release/retention-verification.js";
import { runRetentionStep } from "../application/release/retention.js";
import {
  DEFAULT_RETENTION_POLICY,
  verificationRequirements,
} from "../domain/retention-policy.js";
import type { LockProofPort } from "../ports/retention-port.js";

/** Relative to the package root. The staging driver extracts exactly these files. */
export const VERIFICATION_BOOTSTRAP_FILES = [
  "package.json",
  "dist/release/verification-lifecycle.js",
  "dist/application/release/retention.js",
  "dist/adapters/release/retention-docker.js",
  "dist/adapters/release/retention-fs.js",
  "dist/adapters/release/retention-lock.js",
  "dist/adapters/release/retention-quarantine.js",
  "dist/adapters/release/retention-verification.js",
  "dist/domain/retention-policy.js",
  "dist/ports/retention-port.js",
] as const;

const USAGE =
  "Usage: verification-lifecycle.js verification-preflight --runs-root DIR --data-root DIR --run-id ID --build-bytes N --data-bytes N --lock-fd FD [--root-path DIR]";
const REQUIRED = [
  "--runs-root",
  "--data-root",
  "--run-id",
  "--build-bytes",
  "--data-bytes",
  "--lock-fd",
];
const FLAGS = [...REQUIRED, "--root-path"];

const run = (command: string, args: readonly string[]) =>
  new Promise<{ code: number; stdout: string }>((resolve) => {
    execFile(
      command,
      [...args],
      { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        const code = error
          ? typeof error.code === "number"
            ? error.code
            : 1
          : 0;
        resolve({ code, stdout: String(stdout) });
      },
    );
  });

/** Busy when `flock -n` cannot take the lease. A missing lease file has no holder. */
async function flockLeaseBusy(path: string): Promise<boolean> {
  try {
    if (!(await lstat(path)).isFile()) return true;
  } catch {
    return false;
  }
  const result = await run("flock", ["-n", "-E", "75", path, "true"]);
  if (result.code === 0) return false;
  if (result.code === 75) return true;
  throw new Error(`Could not test the run lease ${path}.`);
}

export async function main(
  argv: readonly string[],
  deps: {
    docker?: DockerRunner;
    leaseBusy?: (path: string) => Promise<boolean>;
    lockProof?: (fd: number, lockPath: string) => LockProofPort;
    now?: () => string;
    out?: (text: string) => void;
    err?: (text: string) => void;
  } = {},
): Promise<number> {
  const out = deps.out ?? ((text) => process.stdout.write(`${text}\n`));
  const err = deps.err ?? ((text) => process.stderr.write(`${text}\n`));
  try {
    const [command, ...rest] = argv;
    if (command !== "verification-preflight" || rest.length % 2 !== 0)
      throw new Error(USAGE);
    const flags = new Map<string, string>();
    for (let index = 0; index < rest.length; index += 2) {
      const name = rest[index] ?? "";
      if (!FLAGS.includes(name) || flags.has(name)) throw new Error(USAGE);
      flags.set(name, rest[index + 1] ?? "");
    }
    if (REQUIRED.some((flag) => !flags.get(flag))) throw new Error(USAGE);
    const runId = flags.get("--run-id") ?? "";
    const build = flags.get("--build-bytes") ?? "";
    const dataBytes = flags.get("--data-bytes") ?? "";
    const fd = flags.get("--lock-fd") ?? "";
    if (
      !/^[a-f0-9]{24}$/.test(runId) ||
      !/^\d+$/.test(build) ||
      !/^\d+$/.test(dataBytes) ||
      !/^\d+$/.test(fd)
    )
      throw new Error(USAGE);
    const runsRoot = await realpath(flags.get("--runs-root") ?? "");
    const dataRoot = await realpath(flags.get("--data-root") ?? "");
    const now = deps.now ?? (() => new Date().toISOString());
    const lock = (
      deps.lockProof ?? ((n, lockPath) => createFdLockProof({ fd: n, lockPath }))
    )(Number(fd), join(runsRoot, ".retention.lock"));
    const verification = createVerificationRootAdapter(runsRoot, dataRoot, {
      leaseBusy: deps.leaseBusy ?? flockLeaseBusy,
      protectedRuns: [runId],
      now,
    });
    const port = combineRetentionPorts([
      { kinds: ["verification-run"], port: verification },
      {
        kinds: ["docker-image"],
        port: createDockerImageAdapter(runsRoot, {
          docker: deps.docker ?? ((args) => run("docker", args)),
        }),
      },
    ]);
    const result = await runRetentionStep({
      inventory: port,
      effects: port,
      disk: verification,
      receipts: verification,
      lock,
      policy: DEFAULT_RETENTION_POLICY,
      requirements: verificationRequirements({
        rootPath: flags.get("--root-path") ?? "/",
        runsRoot,
        dataRoot,
        buildBytes: Number(build),
        dataBytes: Number(dataBytes),
      }),
      now,
    });
    const summary = `deleted=${result.deleted.length} skipped=${result.skipped.length} failed=${result.failed.length} unknown=${result.unknown.length} recovered=${result.quarantineRecovered.length} receipt=${result.receiptPath}`;
    if (!result.ok) {
      err(result.message);
      err(summary);
      return 1;
    }
    out(`${result.message} ${summary}`);
    return 0;
  } catch (error) {
    err(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  process.exitCode = await main(process.argv.slice(2));
}
