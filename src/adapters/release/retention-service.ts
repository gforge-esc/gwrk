/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Discovers the release the gwrk systemd unit runs now and the paths it is
// configured with. Same identity rule as rollback-release.sh. Reads only the
// MainPID command line, working directory and listed path variables. Errors
// never include process arguments or environment values.

import { execFile } from "node:child_process";
import { readFile, readlink, realpath } from "node:fs/promises";
import { join } from "node:path";
import {
  SERVICE_BUSY_STATES,
  environmentPaths,
  identifyLaunch,
  parseSystemdShow,
  unitConfiguredPaths,
} from "../../domain/retention-policy.js";
import type {
  RunningService,
  RunningServicePort,
} from "../../ports/retention-port.js";

export interface ServiceProbe {
  systemctl(args: readonly string[]): Promise<{ code: number; stdout: string }>;
  readProc(path: string): Promise<Buffer>;
  readlink(path: string): Promise<string>;
  realpath(path: string): Promise<string>;
}

const PROPERTIES = [
  "LoadState",
  "ActiveState",
  "MainPID",
  "WorkingDirectory",
  "ReadWritePaths",
  "ReadOnlyPaths",
  "StateDirectory",
  "RuntimeDirectory",
];

const UNIT = /^[a-zA-Z0-9@_.-]+\.service$/;

export const nodeServiceProbe: ServiceProbe = {
  systemctl: (args) =>
    new Promise((resolve, reject) => {
      execFile(
        "systemctl",
        [...args],
        { timeout: 15_000, maxBuffer: 1024 * 1024, env: { LC_ALL: "C", PATH: process.env.PATH ?? "" } },
        (error, stdout) => {
          if (error && typeof error.code !== "number") return reject(error);
          resolve({ code: error ? Number(error.code) : 0, stdout: String(stdout) });
        },
      );
    }),
  readProc: (path) => readFile(path),
  readlink: (path) => readlink(path),
  realpath: (path) => realpath(path),
};

const split = (buffer: Buffer) =>
  buffer
    .toString("utf8")
    .split("\0")
    .filter((part, index, all) => part !== "" || index < all.length - 1);

export function createSystemdServicePort(input: {
  unit: string;
  releaseRoot: string;
  probe?: ServiceProbe;
}): RunningServicePort {
  const { unit, releaseRoot } = input;
  if (unit !== "none" && !UNIT.test(unit))
    throw new Error("Choose a valid systemd unit name, or none.");
  const probe = input.probe ?? nodeServiceProbe;
  const unidentified = (detail: string) =>
    new Error(
      `Could not identify the running service ${unit}: ${detail}. Retention stopped.`,
    );

  return {
    async discover(): Promise<RunningService> {
      if (unit === "none") return { releases: [], configuredPaths: [] };
      let shown: { code: number; stdout: string };
      try {
        shown = await probe.systemctl([
          "show",
          "--no-pager",
          `--property=${PROPERTIES.join(",")}`,
          unit,
        ]);
      } catch {
        throw unidentified("systemctl is unavailable");
      }
      if (shown.code !== 0) throw unidentified("systemctl show failed");
      const fields = parseSystemdShow(shown.stdout);
      if (fields.LoadState === "not-found")
        return { releases: [], configuredPaths: [] };
      if (fields.LoadState !== "loaded")
        throw unidentified(`unit load state is ${fields.LoadState ?? "unknown"}`);
      const pid = fields.MainPID ?? "";
      if (!/^(0|[1-9]\d*)$/.test(pid)) throw unidentified("invalid MainPID");
      const paths = new Set(unitConfiguredPaths(fields));
      const state = fields.ActiveState ?? "";
      if (pid === "0") {
        if ((SERVICE_BUSY_STATES as readonly string[]).includes(state))
          throw new Error(
            `Running service ${unit} is ${state} with no MainPID. Retention stopped.`,
          );
        return { releases: [], configuredPaths: [...paths].sort() };
      }

      const refuse = (what: string) =>
        new Error(
          `The running service ${unit} ${what}. Retention stopped before deletion.`,
        );
      let argv: string[];
      let environment: string[];
      let cwd: string;
      try {
        argv = split(await probe.readProc(`/proc/${pid}/cmdline`));
      } catch {
        throw refuse("process command could not be inspected");
      }
      const cli = argv[1];
      const cliRealpath = cli
        ? await probe.realpath(cli).catch(() => null)
        : null;
      const launch = identifyLaunch(
        argv,
        cliRealpath,
        join(releaseRoot, "releases"),
      );
      if (!launch.ok)
        throw refuse(`does not run a canonical release under ${releaseRoot}`);
      try {
        environment = split(await probe.readProc(`/proc/${pid}/environ`));
        cwd = await probe.readlink(`/proc/${pid}/cwd`);
      } catch {
        throw refuse("environment could not be inspected");
      }
      for (const path of environmentPaths(environment)) paths.add(path);
      if (cwd.startsWith("/")) paths.add(cwd);
      return { releases: [launch.version], configuredPaths: [...paths].sort() };
    },
  };
}
