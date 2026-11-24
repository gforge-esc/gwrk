import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { withOwnedNestedDaemon } from "./nested-lifecycle.mjs";
import { DIND_IMAGE, RESOURCE_LIMITS } from "./runtime-policy.mjs";

// These injected metadata replies test orchestration. Native ownership proof remains
// the separate Linux checkpoint receipt, never these simulated ownership values.
function fixture({
  cancelWhenRecorded = false,
  dockerDataModeAfterStart,
} = {}) {
  let dataMode = 0o700;
  const events = [];
  const processTarget = new EventEmitter();
  const runId = "a".repeat(24);
  const id = "b".repeat(64);
  const receipt = {
    approvedPrivilegedExecution: true,
    outerImage: DIND_IMAGE,
    dataBudgetBytes: RESOURCE_LIMITS.dataBytes,
    estimatedDataBytes: 10 * 1024 ** 3,
    backingAvailableBytes: 20 * 1024 ** 3,
    rootAvailableBytes: 10 * 1024 ** 3,
    nodeImageId: `sha256:${"c".repeat(64)}`,
    sourceCommit: "d".repeat(40),
    archiveSha256: "e".repeat(64),
    purpose: "behavioral-red",
    daemonImageId: "sha256:daemon-fixture",
    dataParentDevice: 9,
    dataParentInode: 2,
    dataChildIdentity: { device: 9, inode: 3 },
  };
  const metadata = (path) => ({
    isDirectory: () => true,
    isSymbolicLink: () => false,
    uid: path === "/var/lib/gwrk" ? 997 : 0,
    gid: path === "/var/lib/gwrk" ? 988 : 0,
    mode:
      path === "/var/lib/gwrk"
        ? 0o750
        : path === `/var/lib/gwrk/verification-fixtures/${runId}`
          ? dataMode
          : 0o700,
    dev: 9,
    ino:
      path === "/var/lib/gwrk"
        ? 2
        : path.endsWith(runId) && path.startsWith("/var")
          ? 3
          : 4,
  });
  const files = {
    lstatSync: metadata,
    statSync: metadata,
    realpathSync: (value) => value,
    readlinkSync: (path) =>
      path === "/proc/self/ns/pid" ? "pid:[1]" : "pid:[2]",
    readdirSync: () => [],
    readFileSync: () => "1 0 9:1 / / rw - ext4 /dev/test rw\n",
    mkdirSync: (path) => events.push(["mkdir", path]),
    writeFileSync(path, value) {
      if (path.endsWith("native-ownership.json")) {
        const body = JSON.parse(value);
        events.push(["receipt", body.containerId ?? null]);
        if (body.containerId && cancelWhenRecorded)
          processTarget.emit("SIGTERM");
      } else events.push(["write", path]);
    },
    rmSync: (path) => events.push(["remove-data", path]),
  };
  const command = async (args) => {
    events.push(["docker", args[0], ...args.slice(1)]);
    if (args[0] === "image")
      return {
        code: 0,
        stdout: JSON.stringify({
          Id: receipt.daemonImageId,
          Architecture: "amd64",
        }),
      };
    if (["create", "run"].includes(args[0])) return { code: 0, stdout: id };
    if (args[0] === "start") {
      dataMode = dockerDataModeAfterStart ?? dataMode;
      return { code: 0, stdout: id };
    }
    if (args[0] === "inspect")
      return {
        code: 0,
        stdout: JSON.stringify({
          Id: id,
          Config: { Labels: { "gwrk.fixture.run": runId } },
          HostConfig: { PidMode: "", IpcMode: "private" },
          State: { Pid: 900 },
        }),
      };
    if (args[0] === "rm") return { code: 0, stdout: "" };
    if (args.includes("readlink")) return { code: 0, stdout: "pid:[2]\n" };
    if (args.includes("info"))
      return {
        code: 0,
        stdout: JSON.stringify({ Driver: "vfs", Architecture: "x86_64" }),
      };
    if (args.includes("du")) return { code: 0, stdout: "1024 /var/lib/docker" };
    throw new Error("unexpected injected Docker command");
  };
  const input = {
    runId,
    receipt,
    executeCases: async () => {
      events.push(["cases"]);
    },
  };
  return {
    input,
    effects: { files, platform: "linux", uid: 0, command, processTarget },
    events,
    id,
    processTarget,
  };
}

test("actual lifecycle records stopped create ID before start and removes only the owned container", async () => {
  const f = fixture();
  await withOwnedNestedDaemon(f.input, f.effects);
  const create = f.events.findIndex(
    (value) => value[0] === "docker" && value[1] === "create",
  );
  const record = f.events.findIndex(
    (value) => value[0] === "receipt" && value[1] === f.id,
  );
  const start = f.events.findIndex(
    (value) => value[0] === "docker" && value[1] === "start",
  );
  assert.ok(create >= 0, "lifecycle never created a stopped container");
  assert.ok(record > create, "container ID was not persisted after create");
  assert.ok(
    start > record,
    "privileged start happened before the ownership receipt",
  );
  assert.equal(
    f.events.some((value) => value[0] === "docker" && value[1] === "run"),
    false,
  );
  assert.ok(
    f.events.some(
      (value) =>
        value[0] === "docker" && value[1] === "rm" && value.at(-1) === f.id,
    ),
  );
  assert.ok(f.events.some((value) => value[0] === "remove-data"));
  assert.equal(f.processTarget.listenerCount("SIGTERM"), 0);
});

test("actual lifecycle cancellation after ID receipt never starts the container or executes cases", async () => {
  const f = fixture({ cancelWhenRecorded: true });
  await assert.rejects(withOwnedNestedDaemon(f.input, f.effects));
  assert.ok(
    f.events.some((value) => value[0] === "receipt" && value[1] === f.id),
  );
  assert.equal(
    f.events.some(
      (value) => value[0] === "docker" && ["start", "run"].includes(value[1]),
    ),
    false,
  );
  assert.equal(
    f.events.some((value) => value[0] === "cases"),
    false,
  );
  assert.ok(
    f.events.some(
      (value) =>
        value[0] === "docker" && value[1] === "rm" && value.at(-1) === f.id,
    ),
  );
  assert.equal(f.processTarget.listenerCount("SIGTERM"), 0);
});

test("actual lifecycle drains an active injected CLI process before container removal", async () => {
  const f = fixture();
  const baseCommand = f.effects.command;
  let pid;
  let removedAfterClose = false;
  const live = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  f.effects.command = async (args, options) => {
    if (args.includes("hold"))
      return options.spawnProcess(
        process.execPath,
        [
          "-e",
          'process.on("SIGTERM",()=>{});process.stdout.write("READY");setInterval(()=>{},1000)',
        ],
        {
          timeoutMs: 5000,
          onSpawn(child) {
            pid = child.pid;
            child.stdout.once("data", () => f.processTarget.emit("SIGTERM"));
          },
        },
      );
    if (args[0] === "rm") {
      assert.equal(
        live(),
        false,
        "container removal raced an active CLI child",
      );
      removedAfterClose = true;
    }
    return baseCommand(args, options);
  };
  f.input.executeCases = async ({ spawnDocker }) => {
    await spawnDocker(["exec", "hold"], 5000);
  };
  try {
    await assert.rejects(withOwnedNestedDaemon(f.input, f.effects));
    assert.equal(removedAfterClose, true);
    assert.equal(live(), false);
    assert.ok(f.events.some((event) => event[0] === "remove-data"));
  } finally {
    if (pid && live()) process.kill(pid, "SIGKILL");
  }
});

test("reported host PID mode fails before case execution and still cleans owned resources", async () => {
  const f = fixture();
  const baseCommand = f.effects.command;
  f.effects.command = async (args, options) => {
    const result = await baseCommand(args, options);
    if (args[0] === "inspect") {
      const metadata = JSON.parse(result.stdout);
      metadata.HostConfig.PidMode = "host";
      return { ...result, stdout: JSON.stringify(metadata) };
    }
    return result;
  };
  await assert.rejects(withOwnedNestedDaemon(f.input, f.effects));
  assert.equal(
    f.events.some((event) => event[0] === "cases"),
    false,
  );
  assert.ok(
    f.events.some((event) => event[0] === "docker" && event[1] === "rm"),
  );
});

test("matching host and outer PID namespaces fails despite empty PID mode", async () => {
  const f = fixture();
  f.effects.files.readlinkSync = () => "pid:[same]";
  await assert.rejects(
    withOwnedNestedDaemon(f.input, f.effects),
    /shared with the host/,
  );
  assert.equal(
    f.events.some((event) => event[0] === "cases"),
    false,
  );
  assert.ok(
    f.events.some((event) => event[0] === "docker" && event[1] === "rm"),
  );
});

test("removes the exact owned data child after Docker changes its mode to 0710", async () => {
  const f = fixture({ dockerDataModeAfterStart: 0o710 });
  await withOwnedNestedDaemon(f.input, f.effects);
  assert.ok(f.events.some((event) => event[0] === "remove-data"));
});

test("behavioral regression: real du vanished-entry race on a mutating temp tree recovers via bounded retry", async () => {
  const tempTree = mkdtempSync(path.join(os.tmpdir(), "gwrk-du-watchdog-"));
  let mutator;
  try {
    for (let d = 0; d < 20; d++) {
      const dir = path.join(tempTree, `d${d}`);
      mkdirSync(dir);
      for (let i = 0; i < 40; i++) {
        writeFileSync(path.join(dir, `base-${i}`), "x".repeat(64));
      }
    }
    mutator = spawn(
      process.execPath,
      [
        "-e",
        `
          const fs = require("node:fs");
          const path = require("node:path");
          const root = process.argv[1];
          let round = 0;
          const end = Date.now() + 8000;
          while (Date.now() < end) {
            const sub = path.join(root, "churn-" + (round % 12));
            try {
              fs.mkdirSync(sub, { recursive: true });
              for (let k = 0; k < 25; k++) fs.writeFileSync(path.join(sub, "f" + k), "v");
              fs.rmSync(sub, { recursive: true, force: true });
            } catch {}
            round++;
          }
        `,
        tempTree,
      ],
      { stdio: "ignore" },
    );

    const f = fixture({ dockerDataModeAfterStart: 0o710 });
    const written = new Map();
    const origWrite = f.effects.files.writeFileSync;
    f.effects.files.writeFileSync = (filePath, value) => {
      written.set(filePath, value);
      return origWrite(filePath, value);
    };
    const baseCommand = f.effects.command;
    let realRaceObserved = false;
    let recoveredAfterRace = false;
    let releaseCases;
    const done = new Promise((resolve) => {
      releaseCases = resolve;
    });

    f.effects.command = async (args, options) => {
      if (args.includes("du")) {
        const res = spawnSync("/usr/bin/du", ["-sk", tempTree], {
          encoding: "utf8",
          env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
          timeout: 5000,
        });
        if (res.status === 1 && /No such file or directory/.test(res.stderr)) {
          realRaceObserved = true;
          mutator.kill("SIGKILL");
        } else if (res.status === 0 && realRaceObserved) {
          recoveredAfterRace = true;
          releaseCases();
        }
        return {
          code: res.status ?? 1,
          stdout: res.stdout ?? "",
          stderr: res.stderr ?? "",
        };
      }
      return baseCommand(args, options);
    };
    f.effects.watchdog = {
      watchedPath: tempTree,
      sampleIntervalMs: 5,
      transientRetryDelayMs: 10,
      maxTransientRetriesPerTick: 2,
      maxConsecutiveTransientTicks: 3,
      maxValidSampleAgeMs: 15_000,
    };
    f.input.executeCases = async () => {
      f.events.push(["cases"]);
      await Promise.race([
        done,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("real du race probe timed out")),
            7000,
          ),
        ),
      ]);
    };

    await withOwnedNestedDaemon(f.input, f.effects);
    assert.equal(
      realRaceObserved,
      true,
      "real du must hit an actual vanished-entry exit-1 race on the mutating tree",
    );
    assert.equal(
      recoveredAfterRace,
      true,
      "watchdog must recover with an exit-0 sample after the transient race settles",
    );
    assert.equal(
      [...written.keys()].some((k) =>
        k.endsWith("docker-command-failure.json"),
      ),
      false,
      "recovered transient race must not leave a stale docker-command-failure receipt",
    );
    assert.ok(f.events.some((event) => event[0] === "remove-data"));
  } finally {
    mutator?.kill("SIGKILL");
    rmSync(tempTree, { recursive: true, force: true });
  }
});

test("watchdog preserves a recent valid sample across bounded transient ticks and recovers", async () => {
  const f = fixture();
  const baseCommand = f.effects.command;
  let duCalls = 0;
  let releaseCases;
  const done = new Promise((resolve) => {
    releaseCases = resolve;
  });
  let clock = 1_000_000;
  f.effects.now = () => clock;
  f.effects.sleep = async (ms) => {
    clock += ms;
  };
  f.effects.command = async (args, options) => {
    if (args.includes("du")) {
      duCalls += 1;
      // Call 1: valid sample. Calls 2..7: 2 full ticks (3 attempts each) of vanished entries. Call 8: recovered!
      if (duCalls === 1) {
        return { code: 0, stdout: "4096\t/var/lib/docker\n", stderr: "" };
      }
      if (duCalls <= 7) {
        return {
          code: 1,
          stdout: "4096\t/var/lib/docker\n",
          stderr:
            "du: cannot access '/var/lib/docker/vfs/dir/layer-tmp': No such file or directory\n",
        };
      }
      releaseCases();
      return { code: 0, stdout: "8192\t/var/lib/docker\n", stderr: "" };
    }
    return baseCommand(args, options);
  };
  f.input.executeCases = async () => {
    f.events.push(["cases"]);
    await done;
  };

  await withOwnedNestedDaemon(f.input, f.effects);
  assert.ok(duCalls >= 8);
  assert.ok(f.events.some((event) => event[0] === "remove-data"));
});

test("watchdog fails closed when persistent vanished-entry races exceed the bounded retry window", async () => {
  const f = fixture();
  const baseCommand = f.effects.command;
  const written = new Map();
  const origWrite = f.effects.files.writeFileSync;
  f.effects.files.writeFileSync = (filePath, value) => {
    written.set(filePath, value);
    return origWrite(filePath, value);
  };
  let duCalls = 0;
  let clock = 1_000_000;
  f.effects.now = () => clock;
  f.effects.sleep = async (ms) => {
    clock += ms;
  };
  const vanishedStderr =
    "du: cannot access '/var/lib/docker/vfs/dir/stuck': No such file or directory\n";
  f.effects.command = async (args, options) => {
    if (args.includes("du")) {
      duCalls += 1;
      if (duCalls === 1) {
        return { code: 0, stdout: "4096\t/var/lib/docker\n", stderr: "" };
      }
      return {
        code: 1,
        stdout: "4096\t/var/lib/docker\n",
        stderr: vanishedStderr,
      };
    }
    return baseCommand(args, options);
  };
  f.input.executeCases = async ({ signal }) => {
    f.events.push(["cases"]);
    await new Promise((resolve) => signal.addEventListener("abort", resolve));
  };

  let caught;
  try {
    await withOwnedNestedDaemon(f.input, f.effects);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, "persistent transient race must fail closed");
  assert.equal(caught.stage, "resource_watchdog");
  assert.equal(caught.category, "watchdog_transient_exhausted");
  assert.equal(caught.stderrBytes, Buffer.byteLength(vanishedStderr));
  assert.equal(
    caught.stderrSha256,
    createHash("sha256").update(vanishedStderr).digest("hex"),
  );
  assert.equal(JSON.stringify(caught).includes("/var/lib/docker"), false);
  assert.ok(
    f.events.some((event) => event[0] === "docker" && event[1] === "rm"),
  );
  assert.ok(f.events.some((event) => event[0] === "remove-data"));
});

test("watchdog fails closed immediately without retry on permission, storage, unknown, and oversized usage errors", async () => {
  const cases = [
    {
      name: "permission",
      reply: {
        code: 1,
        stdout: "1024\t/var/lib/docker\n",
        stderr:
          "du: cannot read directory '/var/lib/docker/vfs/dir/priv': Permission denied\n",
      },
      expectedCategory: "watchdog_permission_denied",
    },
    {
      name: "storage",
      reply: {
        code: 1,
        stdout: "1024\t/var/lib/docker\n",
        stderr: "du: /var/lib/docker/vfs/dir/x: No space left on device\n",
      },
      expectedCategory: "watchdog_storage_error",
    },
    {
      name: "unknown_with_secret",
      reply: {
        code: 1,
        stdout: "",
        stderr:
          "unrecognized error SECRET_CANARY_WATCHDOG /var/lib/docker/tok\n",
      },
      expectedCategory: "watchdog_measurement_failed",
    },
    {
      name: "oversized_12gib",
      reply: {
        code: 0,
        stdout: `${RESOURCE_LIMITS.dataBytes}\t/var/lib/docker\n`,
        stderr: "",
      },
      expectedCategory: "watchdog_data_budget_exceeded",
    },
  ];

  for (const tc of cases) {
    const f = fixture();
    const baseCommand = f.effects.command;
    let duCalls = 0;
    f.effects.command = async (args, options) => {
      if (args.includes("du")) {
        duCalls += 1;
        return tc.reply;
      }
      return baseCommand(args, options);
    };
    f.input.executeCases = async ({ signal }) => {
      await new Promise((resolve) => signal.addEventListener("abort", resolve));
    };

    let caught;
    try {
      await withOwnedNestedDaemon(f.input, f.effects);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, `${tc.name} must fail closed`);
    assert.equal(
      duCalls,
      1,
      `${tc.name} must fail closed immediately without retrying`,
    );
    assert.equal(caught.stage, "resource_watchdog");
    assert.equal(caught.category, tc.expectedCategory);
    assert.equal(
      JSON.stringify(caught).includes("SECRET_CANARY_WATCHDOG"),
      false,
    );
    assert.equal(
      caught.stderrSha256,
      createHash("sha256").update(tc.reply.stderr).digest("hex"),
    );
    assert.ok(f.events.some((event) => event[0] === "remove-data"));
  }
});

test("watchdog fails closed on first tick when no prior valid sample exists", async () => {
  const f = fixture();
  const baseCommand = f.effects.command;
  let duCalls = 0;
  let clock = 1_000_000;
  f.effects.now = () => clock;
  f.effects.sleep = async (ms) => {
    clock += ms;
  };
  f.effects.command = async (args, options) => {
    if (args.includes("du")) {
      duCalls += 1;
      return {
        code: 1,
        stdout: "1024\t/var/lib/docker\n",
        stderr:
          "du: cannot access '/var/lib/docker/vfs/dir/never-settles': No such file or directory\n",
      };
    }
    return baseCommand(args, options);
  };
  f.input.executeCases = async ({ signal }) => {
    await new Promise((resolve) => signal.addEventListener("abort", resolve));
  };

  let caught;
  try {
    await withOwnedNestedDaemon(f.input, f.effects);
  } catch (err) {
    caught = err;
  }
  assert.ok(
    caught,
    "first tick exhaustion without prior valid sample must fail",
  );
  assert.equal(
    duCalls,
    3,
    "initial tick gets 1 attempt plus 2 bounded retries",
  );
  assert.equal(caught.category, "watchdog_transient_exhausted");
  assert.equal(caught.watchdog?.hasValidSample, false);
});

test("watchdog fails closed when a recent valid sample exceeds its freshness window", async () => {
  const f = fixture();
  const baseCommand = f.effects.command;
  let duCalls = 0;
  let clock = 1_000_000;
  f.effects.now = () => clock;
  f.effects.sleep = async (ms) => {
    clock += ms;
  };
  f.effects.watchdog = {
    maxValidSampleAgeMs: 1_500,
    maxConsecutiveTransientTicks: 10,
  };
  f.effects.command = async (args, options) => {
    if (args.includes("du")) {
      duCalls += 1;
      if (duCalls === 1) {
        return { code: 0, stdout: "4096\t/var/lib/docker\n", stderr: "" };
      }
      return {
        code: 1,
        stdout: "4096\t/var/lib/docker\n",
        stderr:
          "du: cannot access '/var/lib/docker/vfs/dir/stale': No such file or directory\n",
      };
    }
    return baseCommand(args, options);
  };
  f.input.executeCases = async ({ signal }) => {
    await new Promise((resolve) => signal.addEventListener("abort", resolve));
  };

  let caught;
  try {
    await withOwnedNestedDaemon(f.input, f.effects);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, "stale valid sample must not bypass fail-closed bound");
  assert.equal(caught.category, "watchdog_transient_exhausted");
  assert.ok(caught.watchdog?.consecutiveTransientTicks <= 3);
});

test("watchdog fails closed when the unchanged startup plus suite wall-clock deadline elapses", async () => {
  const f = fixture();
  let clock = 1_000_000;
  f.effects.now = () => clock;
  f.effects.sleep = async () => {
    clock +=
      (RESOURCE_LIMITS.startupSeconds + RESOURCE_LIMITS.suiteSeconds) * 1000;
  };
  f.input.executeCases = async ({ signal }) => {
    await new Promise((resolve) => signal.addEventListener("abort", resolve));
  };

  let caught;
  try {
    await withOwnedNestedDaemon(f.input, f.effects);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, "elapsed suite deadline must fail closed");
  assert.equal(caught.stage, "resource_watchdog");
  assert.equal(caught.category, "watchdog_suite_deadline_exceeded");
});
