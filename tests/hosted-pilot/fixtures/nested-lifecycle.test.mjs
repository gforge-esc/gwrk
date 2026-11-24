import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "vitest";
import { withOwnedNestedDaemon } from "./nested-lifecycle.mjs";
import { DIND_IMAGE, RESOURCE_LIMITS } from "./runtime-policy.mjs";

// These injected metadata replies test orchestration. Native ownership proof remains
// the separate Linux checkpoint receipt, never these simulated ownership values.
function fixture({ cancelWhenRecorded = false } = {}) {
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
    mode: path === "/var/lib/gwrk" ? 0o750 : 0o700,
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
    readdirSync: () => [],
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
    if (args[0] === "start") return { code: 0, stdout: id };
    if (args[0] === "inspect")
      return {
        code: 0,
        stdout: JSON.stringify({
          Id: id,
          Config: { Labels: { "gwrk.fixture.run": runId } },
        }),
      };
    if (args[0] === "rm") return { code: 0, stdout: "" };
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
