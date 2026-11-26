/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { createFdLockProof, parseFdinfoLock } from "./retention-lock.js";
import { type ServiceProbe, createSystemdServicePort } from "./retention-service.js";

const ROOT = "/opt/gwrk";
const show = (fields: Record<string, string>) =>
  `${Object.entries({
    LoadState: "loaded",
    ActiveState: "active",
    MainPID: "0",
    WorkingDirectory: "/var/lib/gwrk",
    ReadWritePaths: "/var/lib/gwrk /run/gwrk",
    ReadOnlyPaths: "/opt/gwrk -/etc/gwrk/secrets",
    StateDirectory: "gwrk",
    RuntimeDirectory: "gwrk",
    ...fields,
  })
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")}\n`;

const probe = (
  options: {
    show?: string;
    showCode?: number;
    missing?: boolean;
    cmdline?: string[];
    environ?: string[];
    cwd?: string;
    realpath?: Record<string, string>;
    environError?: boolean;
  } = {},
): ServiceProbe & { calls: string[][] } => {
  const calls: string[][] = [];
  return {
    calls,
    async systemctl(args) {
      calls.push([...args]);
      if (options.missing)
        throw Object.assign(new Error("spawn systemctl ENOENT"), {
          code: "ENOENT",
        });
      return { code: options.showCode ?? 0, stdout: options.show ?? show({}) };
    },
    async readProc(path) {
      if (path.endsWith("/cmdline"))
        return Buffer.from(`${(options.cmdline ?? []).join("\0")}\0`);
      if (path.endsWith("/environ")) {
        if (options.environError)
          throw Object.assign(new Error("EACCES"), { code: "EACCES" });
        return Buffer.from(`${(options.environ ?? []).join("\0")}\0`);
      }
      throw new Error(`unexpected ${path}`);
    },
    async readlink() {
      return options.cwd ?? "/var/lib/gwrk/repos/pilot";
    },
    async realpath(path) {
      return options.realpath?.[path] ?? path;
    },
  };
};

const launch = (cli: string, ...extra: string[]) => [
  "/usr/bin/node",
  cli,
  "server",
  "start",
  "--foreground",
  ...extra,
];

const port = (p: ServiceProbe, unit = "gwrk-runner.service") =>
  createSystemdServicePort({ unit, releaseRoot: ROOT, probe: p });

describe("running service discovery", () => {
  it("reports no release when the unit is not installed", async () => {
    const result = await port(
      probe({ show: "LoadState=not-found\nActiveState=inactive\nMainPID=0\n" }),
    ).discover();
    expect(result).toEqual({ releases: [], configuredPaths: [] });
  });

  it("reads configured unit paths when the service is stopped", async () => {
    const result = await port(
      probe({ show: show({ ActiveState: "inactive" }) }),
    ).discover();
    expect(result.releases).toEqual([]);
    expect(result.configuredPaths).toEqual([
      "/etc/gwrk/secrets",
      "/opt/gwrk",
      "/run/gwrk",
      "/var/lib/gwrk",
    ]);
  });

  it.each(["active", "activating", "reloading", "deactivating"])(
    "fails closed when the unit is %s with no MainPID",
    async (state) => {
      await expect(
        port(probe({ show: show({ ActiveState: state }) })).discover(),
      ).rejects.toThrow(/MainPID/);
    },
  );

  it("identifies the canonical release of the running process", async () => {
    const p = probe({
      show: show({ MainPID: "4242" }),
      cmdline: launch("/opt/gwrk/releases/1.2.0/dist/cli.js"),
      environ: [
        "GWRK_HOME=/var/lib/gwrk",
        "GWRK_DB_PATH=/var/lib/gwrk/gwrk.db",
        "GWRK_SECRETS_DIR=/etc/gwrk/secrets",
        "GWRK_PILOT_REPO=/srv/projects/pilot",
        "SLACK_BOT_TOKEN=xoxb-secret-value",
        "PATH=/usr/bin",
      ],
    });
    const result = await port(p).discover();
    expect(result.releases).toEqual(["1.2.0"]);
    expect(result.configuredPaths).toContain("/var/lib/gwrk/gwrk.db");
    expect(result.configuredPaths).toContain("/srv/projects/pilot");
    expect(result.configuredPaths).toContain("/var/lib/gwrk/repos/pilot");
    expect(result.configuredPaths.join(" ")).not.toMatch(/xoxb|usr\/bin/);
  });

  it.each([
    ["an unexpected command", launch("/opt/gwrk/releases/1.2.0/dist/cli.js", "--token=hunter2")],
    ["a non-canonical launch path", launch("/opt/gwrk/current/dist/cli.js")],
    ["a path outside the release root", launch("/tmp/hunter2/dist/cli.js")],
  ])("fails closed on %s without echoing the process arguments", async (_name, argv) => {
    const p = probe({
      show: show({ MainPID: "4242" }),
      cmdline: argv,
      realpath: {
        "/opt/gwrk/current/dist/cli.js": "/opt/gwrk/releases/1.3.0/dist/cli.js",
      },
    });
    const failure = await port(p)
      .discover()
      .then(() => null, (error: Error) => error);
    expect(failure?.message).toMatch(/running service/i);
    expect(failure?.message).not.toMatch(/hunter2|--token|current\/dist/);
  });

  it("fails closed when the process environment cannot be read", async () => {
    await expect(
      port(
        probe({
          show: show({ MainPID: "4242" }),
          cmdline: launch("/opt/gwrk/releases/1.2.0/dist/cli.js"),
          environError: true,
        }),
      ).discover(),
    ).rejects.toThrow(/running service/i);
  });

  it.each([
    ["missing systemctl", { missing: true }],
    ["a failing systemctl", { showCode: 1 }],
  ])("fails closed with %s", async (_name, options) => {
    await expect(port(probe(options)).discover()).rejects.toThrow(
      /Could not identify the running service/,
    );
  });

  it("accepts an explicit declaration that no service runs from this root", async () => {
    const p = probe({ missing: true });
    expect(await port(p, "none").discover()).toEqual({
      releases: [],
      configuredPaths: [],
    });
    expect(p.calls).toEqual([]);
  });

  it("rejects an invalid unit name", () => {
    expect(() => port(probe(), "../evil")).toThrow(/unit/);
  });
});

describe("lock proof", () => {
  const line = (kind: string, mode: string, inode: number) =>
    `pos:\t0\nflags:\t02100001\nmnt_id:\t29\nino:\t${inode}\nlock:\t1: ${kind}  ADVISORY  ${mode} 1234 08:01:${inode} 0 EOF\n`;

  it.each([
    [line("FLOCK", "WRITE", 5555), 5555, true],
    [line("FLOCK", "READ", 5555), 5555, false],
    [line("POSIX", "WRITE", 5555), 5555, false],
    [line("FLOCK", "WRITE", 5555), 6666, false],
    ["pos:\t0\nflags:\t02100001\n", 5555, false],
  ])("parses fdinfo %#", (text, inode, expected) => {
    expect(parseFdinfoLock(text, inode)).toBe(expected);
  });

  const lockProbe = (options: {
    fdIno?: number;
    pathIno?: number;
    fdinfo?: string | null;
  }) => ({
    fstat: async () => ({ dev: 1, ino: options.fdIno ?? 5555 }),
    stat: async () => ({ dev: 1, ino: options.pathIno ?? 5555 }),
    readFdinfo: async () => {
      if (options.fdinfo === null) throw new Error("ENOENT /proc");
      return options.fdinfo ?? line("FLOCK", "WRITE", 5555);
    },
  });

  it("accepts an inherited exclusive flock on the lock file", async () => {
    await expect(
      createFdLockProof({ fd: 9, lockPath: "/opt/gwrk/.install.lock", probe: lockProbe({}) }).assertHeld(),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["another file", { fdIno: 7777 }],
    ["no lock", { fdinfo: "pos:\t0\n" }],
    ["no procfs", { fdinfo: null }],
  ])("rejects %s", async (_name, options) => {
    await expect(
      createFdLockProof({ fd: 9, lockPath: "/opt/gwrk/.install.lock", probe: lockProbe(options) }).assertHeld(),
    ).rejects.toThrow(/lock/i);
  });
});
