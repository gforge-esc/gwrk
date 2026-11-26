/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Lifecycle entry point. Node standard library only. `install-release.sh`
// extracts this file and its relative imports from the verified archive and
// runs it under the install lock before extraction or activation.

import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createReleaseRootAdapter } from "../adapters/release/retention-fs.js";
import { createFdLockProof } from "../adapters/release/retention-lock.js";
import { createSystemdServicePort } from "../adapters/release/retention-service.js";
import { runRetentionStep } from "../application/release/retention.js";
import {
  DEFAULT_RETENTION_POLICY,
  installRequiredBytes,
  isReleaseName,
} from "../domain/retention-policy.js";
import type {
  LockProofPort,
  RunningServicePort,
} from "../ports/retention-port.js";

/** Relative to the package root. The installer extracts exactly these files. */
export const LIFECYCLE_BOOTSTRAP_FILES = [
  "package.json",
  "dist/release/lifecycle.js",
  "dist/application/release/retention.js",
  "dist/adapters/release/retention-fs.js",
  "dist/adapters/release/retention-lock.js",
  "dist/adapters/release/retention-quarantine.js",
  "dist/adapters/release/retention-service.js",
  "dist/domain/retention-policy.js",
  "dist/ports/retention-port.js",
] as const;

const USAGE =
  "Usage: lifecycle.js install-preflight --release-root DIR --candidate VERSION --uncompressed-bytes N --service-unit UNIT|none --lock-fd FD";
const FLAGS = [
  "--release-root",
  "--candidate",
  "--uncompressed-bytes",
  "--service-unit",
  "--lock-fd",
];

function parseFlags(args: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (
      !name ||
      !FLAGS.includes(name) ||
      value === undefined ||
      flags.has(name)
    )
      throw new Error(USAGE);
    flags.set(name, value);
  }
  if (FLAGS.some((flag) => !flags.get(flag))) throw new Error(USAGE);
  return flags;
}

export async function main(
  argv: readonly string[],
  io: {
    now?: () => string;
    out?: (text: string) => void;
    err?: (text: string) => void;
    lockProof?: (fd: number, lockPath: string) => LockProofPort;
    service?: (unit: string, releaseRoot: string) => RunningServicePort;
  } = {},
): Promise<number> {
  const out = io.out ?? ((text) => process.stdout.write(`${text}\n`));
  const err = io.err ?? ((text) => process.stderr.write(`${text}\n`));
  try {
    const [command, ...rest] = argv;
    if (command !== "install-preflight") throw new Error(USAGE);
    const flags = parseFlags(rest);
    const candidate = flags.get("--candidate") ?? "";
    const bytesText = flags.get("--uncompressed-bytes") ?? "";
    const fdText = flags.get("--lock-fd") ?? "";
    const unit = flags.get("--service-unit") ?? "";
    if (!/^\d+$/.test(bytesText) || !/^\d+$/.test(fdText))
      throw new Error(USAGE);
    if (!isReleaseName(candidate))
      throw new Error("Invalid candidate version.");
    const releaseRoot = realpathSync(resolve(flags.get("--release-root") ?? ""));
    const service = (
      io.service ??
      ((name, root) => createSystemdServicePort({ unit: name, releaseRoot: root }))
    )(unit, releaseRoot);
    const lock = (
      io.lockProof ?? ((fd, lockPath) => createFdLockProof({ fd, lockPath }))
    )(Number(fdText), join(releaseRoot, ".install.lock"));
    const adapter = createReleaseRootAdapter(releaseRoot, { candidate, service });
    const result = await runRetentionStep({
      inventory: adapter,
      effects: adapter,
      disk: adapter,
      receipts: adapter,
      lock,
      policy: DEFAULT_RETENTION_POLICY,
      requirements: [
        {
          label: `install ${candidate}`,
          path: releaseRoot,
          requiredBytes: installRequiredBytes(Number(bytesText)),
        },
      ],
      now: io.now ?? (() => new Date().toISOString()),
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
