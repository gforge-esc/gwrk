/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Verification staging entry point. `deploy/verification/stage-preflight.sh`
// runs it under the retention lock while holding the run lease.

import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  type DockerRunner,
  combineRetentionPorts,
  createDockerImageAdapter,
} from "../adapters/release/retention-docker.js";
import { createVerificationRootAdapter } from "../adapters/release/retention-verification.js";
import { runRetentionStep } from "../application/release/retention.js";
import {
  DEFAULT_RETENTION_POLICY,
  verificationRequirements,
} from "../domain/retention-policy.js";

const USAGE =
  "Usage: verification-lifecycle.js verification-preflight --runs-root DIR --data-root DIR --run-id ID --protected-images FILE --build-bytes N --data-bytes N [--root-path DIR]";
const FLAGS = [
  "--runs-root",
  "--data-root",
  "--run-id",
  "--protected-images",
  "--build-bytes",
  "--data-bytes",
  "--root-path",
];

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
    const runId = flags.get("--run-id") ?? "";
    const build = flags.get("--build-bytes") ?? "";
    const dataBytes = flags.get("--data-bytes") ?? "";
    if (
      !/^[a-f0-9]{24}$/.test(runId) ||
      !/^\d+$/.test(build) ||
      !/^\d+$/.test(dataBytes)
    )
      throw new Error(USAGE);
    const runsRoot = await realpath(flags.get("--runs-root") ?? "");
    const dataRoot = await realpath(flags.get("--data-root") ?? "");
    const protectedImagesFile = flags.get("--protected-images");
    if (!protectedImagesFile) throw new Error(USAGE);
    const verification = createVerificationRootAdapter(runsRoot, dataRoot, {
      leaseBusy: deps.leaseBusy ?? flockLeaseBusy,
      protectedRuns: [runId],
    });
    const port = combineRetentionPorts([
      { kinds: ["verification-run"], port: verification },
      {
        kinds: ["docker-image"],
        port: createDockerImageAdapter(runsRoot, {
          docker: deps.docker ?? ((args) => run("docker", args)),
          protectedImagesFile,
        }),
      },
    ]);
    const result = await runRetentionStep({
      inventory: port,
      effects: port,
      disk: verification,
      receipts: verification,
      policy: DEFAULT_RETENTION_POLICY,
      requirements: verificationRequirements({
        rootPath: flags.get("--root-path") ?? "/",
        runsRoot,
        dataRoot,
        buildBytes: Number(build),
        dataBytes: Number(dataBytes),
      }),
      now: deps.now ?? (() => new Date().toISOString()),
    });
    const summary = `deleted=${result.deleted.length} skipped=${result.skipped.length} failed=${result.failed.length} unknown=${result.unknown.length} receipt=${result.receiptPath}`;
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
