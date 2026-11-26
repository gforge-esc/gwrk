/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Behavioural tests for the source-controlled native staging driver. Docker
// and the lifecycle helper are fakes. Every root is an isolated temp tree.

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VERIFICATION_BOOTSTRAP_FILES } from "../../src/release/verification-lifecycle.js";

const DRIVER = resolve("deploy/verification/stage-native-proof.py");
const RUN = "0123456789abcdef01234567";
const COMMIT = "a".repeat(40);
const MANIFEST = "b".repeat(64);

let base: string;
let runs: string;
let dataParent: string;
let config: string;
let fakeBin: string;
let stubLog: string;
let dockerLog: string;
let sourceArchive: string;
let lifecycleArchive: string;
const holders: ChildProcess[] = [];

const sha256 = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

const STUB = String.raw`import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const args = process.argv.slice(2);
const get = (flag) => args[args.indexOf(flag) + 1];
const runs = get("--runs-root");
const run = get("--run-id");
const probe = (path) => execFileSync("python3", ["-c",
  "import fcntl,sys\nf=open(sys.argv[1],'a')\ntry:\n fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);print('free')\nexcept BlockingIOError:\n print('busy')",
  path], { encoding: "utf8" }).trim();
const owner = JSON.parse(readFileSync(runs + "/" + run + "/gwrk-run-owner.json", "utf8"));
appendFileSync(process.env.STUB_LOG, JSON.stringify({
  args,
  ownerState: owner.state,
  heavy: owner.heavy,
  images: owner.images,
  lease: probe(runs + "/" + run + "/.lease"),
  retentionLock: probe(runs + "/.retention.lock"),
  sourcePresent: existsSync(runs + "/" + run + "/source.tar"),
}) + "\n");
process.exit(Number(process.env.STUB_EXIT ?? "0"));
`;

const PROBE = String.raw`import fcntl, sys
def state(path):
    f = open(path, "a")
    try:
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return "free"
    except BlockingIOError:
        return "busy"
open(sys.argv[3], "w").write(state(sys.argv[1]) + " " + state(sys.argv[2]))
raise SystemExit(int(sys.argv[4]))
`;

function tarFrom(directory: string, archive: string, gzip: boolean) {
  const result = spawnSync(
    "tar",
    [gzip ? "-czf" : "-cf", archive, "-C", directory, "."],
    {
      encoding: "utf8",
    },
  );
  if (result.status !== 0) throw new Error(result.stderr);
}

function makeSource(driverText = readFileSync(DRIVER, "utf8")) {
  const tree = join(base, "source-tree");
  rmSync(tree, { recursive: true, force: true });
  mkdirSync(join(tree, "deploy/verification"), { recursive: true });
  writeFileSync(
    join(tree, "deploy/verification/stage-native-proof.py"),
    driverText,
  );
  writeFileSync(join(tree, "package.json"), '{"name":"@gwrk/cli"}\n');
  sourceArchive = join(base, "upload", "source.tar");
  mkdirSync(dirname(sourceArchive), { recursive: true });
  tarFrom(tree, sourceArchive, false);
}

function makeLifecycle() {
  const tree = join(base, "lifecycle-tree");
  for (const file of VERIFICATION_BOOTSTRAP_FILES) {
    const path = join(tree, "package", file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      file === "package.json" ? '{"type":"module"}\n' : "export {};\n",
    );
  }
  writeFileSync(
    join(tree, "package/dist/release/verification-lifecycle.js"),
    STUB,
  );
  lifecycleArchive = join(base, "upload", "gwrk.tgz");
  const result = spawnSync(
    "tar",
    ["-czf", lifecycleArchive, "-C", tree, "package"],
    {
      encoding: "utf8",
    },
  );
  if (result.status !== 0) throw new Error(result.stderr);
}

const stageArgs = (overrides: Record<string, string> = {}) => {
  const values: Record<string, string> = {
    "--config": config,
    "--run-id": RUN,
    "--source-archive": sourceArchive,
    "--source-sha256": sha256(sourceArchive),
    "--source-commit": COMMIT,
    "--runtime-manifest-sha256": MANIFEST,
    "--purpose": "acceptance",
    "--lifecycle-archive": lifecycleArchive,
    "--lifecycle-sha256": sha256(lifecycleArchive),
    ...overrides,
  };
  return ["stage", ...Object.entries(values).flat()];
};

const driver = (args: string[], env: Record<string, string> = {}) =>
  spawnSync("python3", [DRIVER, ...args], {
    encoding: "utf8",
    timeout: 30_000,
    input: "",
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      STUB_LOG: stubLog,
      DOCKER_LOG: dockerLog,
      ...env,
    },
  });

const runDir = () => join(runs, RUN);
const owner = () =>
  JSON.parse(readFileSync(join(runDir(), "gwrk-run-owner.json"), "utf8"));
const stubEvents = () =>
  existsSync(stubLog)
    ? readFileSync(stubLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
    : [];

function holdLease(path: string): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn("python3", [
      "-c",
      "import fcntl,sys,time\nf=open(sys.argv[1],'a')\nfcntl.flock(f,fcntl.LOCK_EX)\nprint('held',flush=True)\ntime.sleep(60)",
      path,
    ]);
    holders.push(child);
    child.stdout.on("data", () => done());
    child.on("error", fail);
  });
}

function writeOwner(state: string, extra: Record<string, unknown> = {}) {
  mkdirSync(runDir(), { recursive: true, mode: 0o700 });
  writeFileSync(
    join(runDir(), "gwrk-run-owner.json"),
    JSON.stringify({
      schema: 1,
      runId: RUN,
      state,
      startedAt: "2026-11-26T16:00:00Z",
      heavy: [],
      images: [],
      ...extra,
    }),
  );
}

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "gwrk-stage-driver-")));
  runs = join(base, "opt-gwrk-verification");
  dataParent = join(base, "var-lib-gwrk");
  mkdirSync(runs, { mode: 0o700 });
  mkdirSync(dataParent);
  chmodSync(dataParent, 0o750);
  fakeBin = join(base, "bin");
  mkdirSync(fakeBin);
  dockerLog = join(base, "docker.log");
  stubLog = join(base, "stub.log");
  writeFileSync(
    join(fakeBin, "docker"),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$DOCKER_LOG"\nexit 1\n',
  );
  chmodSync(join(fakeBin, "docker"), 0o755);
  config = join(base, "stage.json");
  const uid = process.getuid?.() ?? 0;
  const gid = process.getgid?.() ?? 0;
  writeFileSync(
    config,
    JSON.stringify({
      runsRoot: runs,
      dataParent,
      dataRoot: join(dataParent, "verification-fixtures"),
      requireRoot: false,
      stagingOwner: { uid, gid },
      dataParentOwner: { uid, gid, mode: "0750" },
      earlyBuildBytes: 1,
      earlyDataBytes: 0,
    }),
  );
  makeSource();
  makeLifecycle();
});
afterEach(() => {
  for (const child of holders.splice(0)) child.kill("SIGKILL");
  rmSync(base, { recursive: true, force: true });
});

describe("native staging driver", () => {
  it("takes the lease and records ownership, then runs preflight before any heavy work", () => {
    const result = driver(stageArgs(), { STUB_EXIT: "1" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/preflight/i);
    const [event, ...rest] = stubEvents();
    expect(rest).toEqual([]);
    expect(event).toMatchObject({
      ownerState: "staging",
      lease: "busy",
      retentionLock: "busy",
      sourcePresent: false,
    });
    expect(event.args).toEqual(
      expect.arrayContaining([
        "verification-preflight",
        "--run-id",
        RUN,
        "--lock-fd",
      ]),
    );
    expect(event.heavy).toContainEqual({ root: "data-run" });
    expect(event.heavy).toContainEqual({ root: "run", path: "source.tar" });
    expect(event.images.map((i: { tag: string }) => i.tag).sort()).toEqual([
      `gwrk-verification:${RUN}-build`,
      `gwrk-verification:${RUN}-flat`,
    ]);
    expect(existsSync(dockerLog)).toBe(false);
    expect(existsSync(join(runDir(), "source.tar"))).toBe(false);
    expect(owner().state).toBe("failed");
  });

  it("copies the source only after preflight passes and marks a later failure", () => {
    const result = driver(stageArgs(), { STUB_EXIT: "0" });
    expect(result.status).not.toBe(0);
    expect(stubEvents()[0]).toMatchObject({ sourcePresent: false });
    expect(sha256(join(runDir(), "source.tar"))).toBe(sha256(sourceArchive));
    expect(owner()).toMatchObject({ state: "failed" });
    expect(typeof owner().completedAt).toBe("string");
  });

  it("refuses when another job holds the run lease", async () => {
    writeOwner("staging");
    await holdLease(join(runDir(), ".lease"));
    const result = driver(stageArgs());
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/lease/i);
    expect(stubEvents()).toEqual([]);
    expect(owner().state).toBe("staging");
  });

  it("refuses a run directory that has no owner record", () => {
    mkdirSync(runDir());
    writeFileSync(join(runDir(), "legacy.txt"), "keep");
    const result = driver(stageArgs());
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/owner record/i);
    expect(readFileSync(join(runDir(), "legacy.txt"), "utf8")).toBe("keep");
    expect(stubEvents()).toEqual([]);
  });

  it.each([
    ["source", { "--source-sha256": "0".repeat(64) }],
    ["lifecycle", { "--lifecycle-sha256": "0".repeat(64) }],
  ])(
    "rejects a %s archive digest mismatch before creating the run",
    (_name, override) => {
      const result = driver(stageArgs(override));
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/digest/i);
      expect(existsSync(runDir())).toBe(false);
    },
  );

  it("rejects a driver that differs from the reviewed source archive", () => {
    makeSource("# altered driver\n");
    const result = driver(stageArgs());
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/driver/i);
    expect(existsSync(runDir())).toBe(false);
  });

  it("holds the lease through the proof command and records completion", () => {
    writeOwner("staged", { stagedAt: "2026-11-26T16:10:00Z" });
    const probe = join(base, "probe.py");
    const out = join(base, "probe.out");
    writeFileSync(probe, PROBE);
    const result = driver([
      "exec",
      "--config",
      config,
      "--run-id",
      RUN,
      "--",
      "python3",
      probe,
      join(runDir(), ".lease"),
      join(runs, ".retention.lock"),
      out,
      "0",
    ]);
    expect(result.status).toBe(0);
    expect(readFileSync(out, "utf8")).toBe("busy free");
    expect(owner()).toMatchObject({ state: "completed" });
  });

  it("passes a failing proof exit code through and records failure", () => {
    writeOwner("staged", { stagedAt: "2026-11-26T16:10:00Z" });
    const probe = join(base, "probe.py");
    writeFileSync(probe, PROBE);
    const result = driver([
      "exec",
      "--config",
      config,
      "--run-id",
      RUN,
      "--",
      "python3",
      probe,
      join(runDir(), ".lease"),
      join(runs, ".retention.lock"),
      join(base, "probe.out"),
      "3",
    ]);
    expect(result.status).toBe(3);
    expect(owner().state).toBe("failed");
  });

  it("refuses to execute a proof for a run that was not staged", () => {
    writeOwner("failed", { completedAt: "2026-11-26T16:10:00Z" });
    const result = driver([
      "exec",
      "--config",
      config,
      "--run-id",
      RUN,
      "--",
      "true",
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/staged/);
  });
});

describe("native staging driver source", () => {
  const text = readFileSync(DRIVER, "utf8");

  it("extracts the same bootstrap files as the TypeScript entry point", () => {
    const block = /BOOTSTRAP_FILES = \(([\s\S]*?)\)/.exec(text)?.[1] ?? "";
    const listed = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(listed).toEqual([...VERIFICATION_BOOTSTRAP_FILES]);
  });

  it("holds no credentials, operator identity or machine-specific host IDs", () => {
    for (const forbidden of [
      "469351852979",
      "i-0e1e1453967c7c1c8",
      "gonzodbg",
      "operator-key",
      "/Users/",
      "known_hosts",
      "protected-images",
    ])
      expect(text).not.toContain(forbidden);
  });

  it("never prunes Docker or forces image removal", () => {
    expect(text).not.toMatch(
      /"(system|image|builder|volume)", "prune"|"rmi"|"image", "rm", "-f"/,
    );
  });

  it("is documented with the runnable command the parent uses", () => {
    const readme = readFileSync("deploy/verification/README.md", "utf8");
    for (const flag of [
      "stage-native-proof.py stage",
      "--source-sha256",
      "--lifecycle-archive",
      "--lifecycle-sha256",
      "stage-native-proof.py exec",
    ])
      expect(readme).toContain(flag);
  });
});
