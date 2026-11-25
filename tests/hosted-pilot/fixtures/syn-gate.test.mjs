import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import { withOwnedNestedDaemon } from "./nested-lifecycle.mjs";
import { DIND_IMAGE, RESOURCE_LIMITS } from "./runtime-policy.mjs";
import {
  createSynGateClient,
  verifySynGateDirectory,
} from "./syn-gate-client.mjs";
import {
  HARDCODED_IPTABLES_RULE,
  MAX_ARMED_TTL_MS,
  MAX_REMOVE_DURATION_MS,
  SYN_GATE_STATE,
  validateArmRequest,
  validateIptablesArgs,
  validateReleaseRequest,
  validateRunId,
  validateScenarioBCausality,
  validateTimingReceipt,
} from "./syn-gate-policy.mjs";

const FIXTURES_DIR = dirname(fileURLToPath(import.meta.url));
const HELPER_SCRIPT_PATH = join(FIXTURES_DIR, "syn-gate-helper.sh");
const VALID_RUN_ID = "0123456789abcdef01234567";

function createTempDir(prefix = "syn-gate-test-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  chmodSync(dir, 0o700);
  return dir;
}

function createFakeIptables(
  dir,
  { failInstallCode = 0, failRemoveCode = 0, rulePresentOnCheck = false } = {},
) {
  const binDir = join(dir, "bin");
  mkdirSync(binDir, { recursive: true });
  const scriptPath = join(binDir, "iptables");
  const logPath = join(dir, "iptables.log");
  const statePath = join(dir, "iptables-rule-installed");

  const script = `#!/usr/bin/env bash
set -e
LOG="${logPath}"
STATE="${statePath}"
echo "$@" >> "$LOG"

if [ "$1" = "-I" ]; then
  if [ "${failInstallCode}" != "0" ]; then
    exit ${failInstallCode}
  fi
  touch "$STATE"
  exit 0
elif [ "$1" = "-D" ]; then
  if [ "${failRemoveCode}" != "0" ]; then
    exit ${failRemoveCode}
  fi
  rm -f "$STATE"
  exit 0
elif [ "$1" = "-C" ]; then
  if [ "${rulePresentOnCheck}" = "true" ] || [ -f "$STATE" ]; then
    exit 0
  else
    exit 1
  fi
fi
exit 0
`;
  writeFileSync(scriptPath, script, { mode: 0o755 });
  return { scriptPath, logPath, statePath };
}

describe("CAP-02: Network Namespace Isolation", () => {
  test("nested-lifecycle rejects outer container sharing host network namespace", async () => {
    const dataMode = 0o700;
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
      readlinkSync: (path) => {
        if (path === "/proc/self/ns/pid") return "pid:[1]";
        if (path.endsWith("/ns/pid")) return "pid:[2]";
        // Sharing host network namespace!
        if (path === "/proc/self/ns/net" || path.endsWith("/ns/net")) {
          return "net:[host-identical]";
        }
        return "ns:[unknown]";
      },
      readdirSync: () => [],
      readFileSync: () => "1 0 9:1 / / rw - ext4 /dev/test rw\n",
      mkdirSync: () => {},
      writeFileSync: () => {},
      rmSync: () => {},
    };
    const command = async (args) => {
      if (args[0] === "image") {
        return {
          code: 0,
          stdout: JSON.stringify({
            Id: receipt.daemonImageId,
            Architecture: "amd64",
          }),
        };
      }
      if (["create", "run", "start"].includes(args[0]))
        return { code: 0, stdout: id };
      if (args[0] === "inspect") {
        return {
          code: 0,
          stdout: JSON.stringify({
            Id: id,
            Config: { Labels: { "gwrk.fixture.run": runId } },
            HostConfig: {
              PidMode: "",
              IpcMode: "private",
              NetworkMode: "none",
            },
            State: { Pid: 900 },
          }),
        };
      }
      if (args[0] === "rm") return { code: 0, stdout: "" };
      if (args.includes("readlink")) {
        const target = args[args.indexOf("readlink") + 1];
        if (target?.includes("/ns/net"))
          return { code: 0, stdout: "net:[host-identical]\n" };
        return { code: 0, stdout: "pid:[2]\n" };
      }
      if (args.includes("info")) {
        return {
          code: 0,
          stdout: JSON.stringify({ Driver: "vfs", Architecture: "x86_64" }),
        };
      }
      if (args.includes("du"))
        return { code: 0, stdout: "1024 /var/lib/docker" };
      throw new Error("unexpected command");
    };

    await assert.rejects(
      withOwnedNestedDaemon(
        { runId, receipt, executeCases: async () => {} },
        { files, platform: "linux", uid: 0, command },
      ),
      /network namespace is shared with the host/,
    );
  });

  test("syn-gate-helper exits non-zero if host and outer network namespaces are identical", () => {
    const tempDir = createTempDir("syn-gate-netns-");
    try {
      const result = execFileSync("bash", [HELPER_SCRIPT_PATH], {
        env: {
          ...process.env,
          RUN_ID: VALID_RUN_ID,
          SYN_GATE_DIR: tempDir,
          HOST_NETNS_INODE: "4026531992",
          OUTER_NETNS_INODE: "4026531992",
        },
        stdio: "pipe",
      });
      assert.fail("helper should have failed on identical netns");
    } catch (err) {
      assert.notEqual(err.status, 0);
      const stderr = err.stderr ? err.stderr.toString() : "";
      assert.match(stderr, /network namespace/i);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("CAP-03: Policy and IPC Validation (Fail Closed)", () => {
  test("validateRunId enforces exact 24-char hex format", () => {
    assert.equal(validateRunId(VALID_RUN_ID), true);
    assert.throws(() => validateRunId("short"), /runId/i);
    assert.throws(() => validateRunId("0123456789abcdef0123456g"), /runId/i);
    assert.throws(() => validateRunId(null), /runId/i);
  });

  test("validateArmRequest rejects opId !== 1 and ttlMs > 1000", () => {
    // Valid
    const valid = validateArmRequest(
      {
        version: 1,
        runId: VALID_RUN_ID,
        opId: 1,
        ttlMs: 1000,
      },
      { expectedRunId: VALID_RUN_ID },
    );
    assert.equal(valid.opId, 1);
    assert.equal(valid.ttlMs, 1000);

    // opId > 1 fails
    assert.throws(
      () =>
        validateArmRequest({
          version: 1,
          runId: VALID_RUN_ID,
          opId: 2,
          ttlMs: 1000,
        }),
      /opId must be exactly 1/,
    );

    // ttlMs > 1000 fails
    assert.throws(
      () =>
        validateArmRequest({
          version: 1,
          runId: VALID_RUN_ID,
          opId: 1,
          ttlMs: 1001,
        }),
      /ttlMs exceeds maximum bound of 1000/,
    );

    // ttlMs <= 0 fails
    assert.throws(
      () =>
        validateArmRequest({
          version: 1,
          runId: VALID_RUN_ID,
          opId: 1,
          ttlMs: 0,
        }),
      /ttlMs must be a positive integer/,
    );

    // mismatched runId fails
    assert.throws(
      () =>
        validateArmRequest(
          { version: 1, runId: "f".repeat(24), opId: 1, ttlMs: 500 },
          { expectedRunId: VALID_RUN_ID },
        ),
      /runId mismatch/,
    );

    // extra unexpected fields fail closed
    assert.throws(
      () =>
        validateArmRequest({
          version: 1,
          runId: VALID_RUN_ID,
          opId: 1,
          ttlMs: 500,
          extra: "malicious",
        }),
      /unexpected key/,
    );
  });

  test("validateReleaseRequest enforces single opId and action", () => {
    const valid = validateReleaseRequest(
      {
        version: 1,
        runId: VALID_RUN_ID,
        opId: 1,
        action: "release",
      },
      { expectedRunId: VALID_RUN_ID },
    );
    assert.equal(valid.action, "release");

    assert.throws(
      () =>
        validateReleaseRequest({
          version: 1,
          runId: VALID_RUN_ID,
          opId: 2,
          action: "release",
        }),
      /opId must be exactly 1/,
    );
    assert.throws(
      () =>
        validateReleaseRequest({
          version: 1,
          runId: VALID_RUN_ID,
          opId: 1,
          action: "flush",
        }),
      /action must be "release"/,
    );
  });

  test("validateIptablesArgs accepts ONLY hardcoded rule and rejects -w, -F, or extra arguments", () => {
    // Valid check
    assert.doesNotThrow(() =>
      validateIptablesArgs(
        [
          "-C",
          "INPUT",
          "-i",
          "lo",
          "-p",
          "tcp",
          "-s",
          "127.0.0.1",
          "-d",
          "127.0.0.1",
          "--dport",
          "18790",
          "--tcp-flags",
          "SYN,RST,ACK,FIN",
          "SYN",
          "-j",
          "DROP",
        ],
        "check",
      ),
    );

    // Valid install
    assert.doesNotThrow(() =>
      validateIptablesArgs(
        [
          "-I",
          "INPUT",
          "1",
          "-i",
          "lo",
          "-p",
          "tcp",
          "-s",
          "127.0.0.1",
          "-d",
          "127.0.0.1",
          "--dport",
          "18790",
          "--tcp-flags",
          "SYN,RST,ACK,FIN",
          "SYN",
          "-j",
          "DROP",
        ],
        "install",
      ),
    );

    // Valid remove
    assert.doesNotThrow(() =>
      validateIptablesArgs(
        [
          "-D",
          "INPUT",
          "-i",
          "lo",
          "-p",
          "tcp",
          "-s",
          "127.0.0.1",
          "-d",
          "127.0.0.1",
          "--dport",
          "18790",
          "--tcp-flags",
          "SYN,RST,ACK,FIN",
          "SYN",
          "-j",
          "DROP",
        ],
        "remove",
      ),
    );

    // Reject -w or -w 2 (coordinator correction)
    assert.throws(
      () =>
        validateIptablesArgs(
          [
            "-w",
            "2",
            "-I",
            "INPUT",
            "1",
            "-i",
            "lo",
            "-p",
            "tcp",
            "-s",
            "127.0.0.1",
            "-d",
            "127.0.0.1",
            "--dport",
            "18790",
            "--tcp-flags",
            "SYN,RST,ACK,FIN",
            "SYN",
            "-j",
            "DROP",
          ],
          "install",
        ),
      /prohibited/,
    );

    // Reject table flush -F
    assert.throws(
      () => validateIptablesArgs(["-F", "INPUT"], "remove"),
      /prohibited/,
    );

    // Reject modified chain or port
    assert.throws(
      () =>
        validateIptablesArgs(
          [
            "-I",
            "OUTPUT",
            "1",
            "-i",
            "lo",
            "-p",
            "tcp",
            "-s",
            "127.0.0.1",
            "-d",
            "127.0.0.1",
            "--dport",
            "18790",
            "--tcp-flags",
            "SYN,RST,ACK,FIN",
            "SYN",
            "-j",
            "DROP",
          ],
          "install",
        ),
      /(prohibited|differs)/,
    );
  });

  test("validateTimingReceipt rejects removeDurationMs > 1000 or unverified removal", () => {
    // Valid receipt
    assert.doesNotThrow(() =>
      validateTimingReceipt({
        version: 1,
        runId: VALID_RUN_ID,
        opId: 1,
        state: SYN_GATE_STATE.RELEASED,
        installDurationMs: 5,
        armedDurationMs: 80,
        removeDurationMs: 4,
        ruleRemovedVerified: true,
      }),
    );

    // removeDurationMs > 1000 fails
    assert.throws(
      () =>
        validateTimingReceipt({
          version: 1,
          runId: VALID_RUN_ID,
          opId: 1,
          state: SYN_GATE_STATE.RELEASED,
          installDurationMs: 5,
          armedDurationMs: 80,
          removeDurationMs: 1001,
          ruleRemovedVerified: true,
        }),
      /removal duration exceeds 1000 ms/,
    );

    // ruleRemovedVerified === false fails
    assert.throws(
      () =>
        validateTimingReceipt({
          version: 1,
          runId: VALID_RUN_ID,
          opId: 1,
          state: SYN_GATE_STATE.RELEASED,
          installDurationMs: 5,
          armedDurationMs: 80,
          removeDurationMs: 5,
          ruleRemovedVerified: false,
        }),
      /rule removal not verified/,
    );

    // armedDurationMs > 1000 fails
    assert.throws(
      () =>
        validateTimingReceipt({
          version: 1,
          runId: VALID_RUN_ID,
          opId: 1,
          state: SYN_GATE_STATE.TIMED_OUT,
          installDurationMs: 5,
          armedDurationMs: 1005,
          removeDurationMs: 5,
          ruleRemovedVerified: true,
        }),
      /armed duration exceeds 1000 ms/,
    );
  });

  test("verifySynGateDirectory enforces mode 0700 and rejects symlinks", () => {
    const tempDir = createTempDir("syn-gate-dir-");
    const symlinkPath = `${tempDir}-symlink`;
    try {
      // Valid directory
      verifySynGateDirectory(tempDir, { requireRootOwnership: false });

      // Bad mode (0755)
      chmodSync(tempDir, 0o755);
      assert.throws(
        () => verifySynGateDirectory(tempDir, { requireRootOwnership: false }),
        /mode 0700/,
      );

      // Symlink directory
      chmodSync(tempDir, 0o700);
      symlinkSync(tempDir, symlinkPath);
      assert.throws(
        () =>
          verifySynGateDirectory(symlinkPath, { requireRootOwnership: false }),
        /symlink/,
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
      rmSync(symlinkPath, { recursive: true, force: true });
    }
  });
});

describe("CAP-04: Helper Lifecycle, Locks, Deadline Expiry, and Clean Drain", () => {
  test("helper fails closed on busy lock without waiting or retrying", async () => {
    const tempDir = createTempDir("syn-gate-lock-");
    const fake = createFakeIptables(tempDir, { failInstallCode: 4 }); // 4 = resource temporarily unavailable
    try {
      const helperProc = spawn("bash", [HELPER_SCRIPT_PATH], {
        env: {
          ...process.env,
          RUN_ID: VALID_RUN_ID,
          SYN_GATE_DIR: tempDir,
          IPTABLES_CMD: fake.scriptPath,
          HOST_NETNS_INODE: "1",
          OUTER_NETNS_INODE: "2",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Write arm.json
      const client = createSynGateClient({
        synGateDir: tempDir,
        runId: VALID_RUN_ID,
        requireRootOwnership: false,
      });
      client.writeArmRequest({ ttlMs: 1000 });

      const exitCode = await new Promise((resolve) => {
        helperProc.on("exit", (code) => resolve(code));
      });

      assert.notEqual(
        exitCode,
        0,
        "busy lock must cause helper to exit non-zero",
      );

      // Verify ruleInstalled is never true
      const status = client.readStatusSafe();
      assert.ok(
        !status || status.ruleInstalled !== true,
        "busy lock must not report ruleInstalled",
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("helper independent expiry deletes rule and writes TIMED_OUT receipt when client stalls past deadline", async () => {
    const tempDir = createTempDir("syn-gate-expiry-");
    const fake = createFakeIptables(tempDir);
    const mockUptimeFile = join(tempDir, "proc-uptime");
    writeFileSync(mockUptimeFile, "100.00 200.00\n", "utf8");

    try {
      const helperProc = spawn("bash", [HELPER_SCRIPT_PATH], {
        env: {
          ...process.env,
          RUN_ID: VALID_RUN_ID,
          SYN_GATE_DIR: tempDir,
          IPTABLES_CMD: fake.scriptPath,
          PROC_UPTIME_PATH: mockUptimeFile,
          HOST_NETNS_INODE: "1",
          OUTER_NETNS_INODE: "2",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      const client = createSynGateClient({
        synGateDir: tempDir,
        runId: VALID_RUN_ID,
        requireRootOwnership: false,
      });

      // Write arm.json with 200ms ttl
      client.writeArmRequest({ ttlMs: 200 });

      // Wait for status to show ARMED
      let armed = false;
      for (let i = 0; i < 50; i++) {
        const st = client.readStatusSafe();
        if (
          st &&
          st.state === SYN_GATE_STATE.ARMED &&
          st.ruleInstalled === true
        ) {
          armed = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.ok(armed, "helper failed to arm");

      // Advance mock uptime by 300ms (> 200ms ttl)
      writeFileSync(mockUptimeFile, "100.30 200.00\n", "utf8");

      // Wait for helper to exit and receipt to be written
      const exitCode = await new Promise((resolve) => {
        helperProc.on("exit", (code) => resolve(code));
      });
      assert.equal(
        exitCode,
        0,
        "helper should exit cleanly on single op completion",
      );

      const receipt = client.readReceiptSafe();
      assert.ok(receipt, "receipt was not written");
      assert.equal(receipt.state, SYN_GATE_STATE.TIMED_OUT);
      assert.equal(receipt.ruleRemovedVerified, true);
      assert.ok(receipt.armedDurationMs <= 1000);

      // Verify rule was removed from iptables
      const log = readFileSync(fake.logPath, "utf8");
      assert.match(log, /-D INPUT/);
      assert.match(log, /-C INPUT/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("helper normal release path arms, deletes rule upon release request, and exits", async () => {
    const tempDir = createTempDir("syn-gate-normal-");
    const fake = createFakeIptables(tempDir);
    const mockUptimeFile = join(tempDir, "proc-uptime");
    writeFileSync(mockUptimeFile, "100.00 200.00\n", "utf8");

    try {
      const helperProc = spawn("bash", [HELPER_SCRIPT_PATH], {
        env: {
          ...process.env,
          RUN_ID: VALID_RUN_ID,
          SYN_GATE_DIR: tempDir,
          IPTABLES_CMD: fake.scriptPath,
          PROC_UPTIME_PATH: mockUptimeFile,
          HOST_NETNS_INODE: "1",
          OUTER_NETNS_INODE: "2",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      const client = createSynGateClient({
        synGateDir: tempDir,
        runId: VALID_RUN_ID,
        requireRootOwnership: false,
      });

      // Write arm.json
      client.writeArmRequest({ ttlMs: 1000 });

      let armed = false;
      for (let i = 0; i < 50; i++) {
        const st = client.readStatusSafe();
        if (st && st.state === SYN_GATE_STATE.ARMED) {
          armed = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.ok(armed, "helper failed to reach ARMED state");

      // Advance clock slightly (50ms)
      writeFileSync(mockUptimeFile, "100.05 200.00\n", "utf8");

      // Client writes release request
      client.writeReleaseRequest();

      const exitCode = await new Promise((resolve) => {
        helperProc.on("exit", (code) => resolve(code));
      });
      assert.equal(exitCode, 0);

      const receipt = client.readReceiptSafe();
      assert.ok(receipt);
      assert.equal(receipt.state, SYN_GATE_STATE.RELEASED);
      assert.equal(receipt.ruleRemovedVerified, true);
      assert.ok(receipt.armedDurationMs <= 1000);
      assert.ok(receipt.removeDurationMs <= 1000);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("helper cleans up rule on stdin STOP / EOF or SIGTERM", async () => {
    const tempDir = createTempDir("syn-gate-term-");
    const fake = createFakeIptables(tempDir);
    const mockUptimeFile = join(tempDir, "proc-uptime");
    writeFileSync(mockUptimeFile, "100.00 200.00\n", "utf8");

    try {
      const helperProc = spawn("bash", [HELPER_SCRIPT_PATH], {
        env: {
          ...process.env,
          RUN_ID: VALID_RUN_ID,
          SYN_GATE_DIR: tempDir,
          IPTABLES_CMD: fake.scriptPath,
          PROC_UPTIME_PATH: mockUptimeFile,
          HOST_NETNS_INODE: "1",
          OUTER_NETNS_INODE: "2",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      const client = createSynGateClient({
        synGateDir: tempDir,
        runId: VALID_RUN_ID,
        requireRootOwnership: false,
      });
      client.writeArmRequest({ ttlMs: 1000 });

      // Wait for armed
      for (let i = 0; i < 50; i++) {
        const st = client.readStatusSafe();
        if (st && st.state === SYN_GATE_STATE.ARMED) break;
        await new Promise((r) => setTimeout(r, 20));
      }

      // Send SIGTERM to helper
      helperProc.kill("SIGTERM");

      const exitCode = await new Promise((resolve) => {
        helperProc.on("exit", (code) => resolve(code));
      });
      // Handled termination via trap exits cleanly or with signal code
      assert.ok(exitCode === 0 || exitCode === 143);

      // Verify trap executed exact -D rule deletion
      const log = readFileSync(fake.logPath, "utf8");
      assert.match(log, /-D INPUT/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("failed rule removal causes helper to fail closed without reporting ruleRemovedVerified", async () => {
    const tempDir = createTempDir("syn-gate-faildel-");
    const fake = createFakeIptables(tempDir, { failRemoveCode: 1 });
    const mockUptimeFile = join(tempDir, "proc-uptime");
    writeFileSync(mockUptimeFile, "100.00 200.00\n", "utf8");

    try {
      const helperProc = spawn("bash", [HELPER_SCRIPT_PATH], {
        env: {
          ...process.env,
          RUN_ID: VALID_RUN_ID,
          SYN_GATE_DIR: tempDir,
          IPTABLES_CMD: fake.scriptPath,
          PROC_UPTIME_PATH: mockUptimeFile,
          HOST_NETNS_INODE: "1",
          OUTER_NETNS_INODE: "2",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      const client = createSynGateClient({
        synGateDir: tempDir,
        runId: VALID_RUN_ID,
        requireRootOwnership: false,
      });
      client.writeArmRequest({ ttlMs: 1000 });

      // Wait for armed
      for (let i = 0; i < 50; i++) {
        const st = client.readStatusSafe();
        if (st && st.state === SYN_GATE_STATE.ARMED) break;
        await new Promise((r) => setTimeout(r, 20));
      }

      // Client requests release
      client.writeReleaseRequest();

      const exitCode = await new Promise((resolve) => {
        helperProc.on("exit", (code) => resolve(code));
      });
      assert.notEqual(exitCode, 0, "failed delete must exit non-zero");

      const receipt = client.readReceiptSafe();
      assert.ok(
        !receipt || receipt.ruleRemovedVerified !== true,
        "must not report ruleRemovedVerified: true on failed delete",
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("CAP-05: Scenario B Causality Verification", () => {
  const validScenarioB = {
    synSentOriginFlowId: "flow-1234-syn",
    zeroPriorParkedFlowId: "flow-1234-syn",
    lastZeroPriorReusedFlowId: "flow-1234-syn",
    zeroPriorRequestReusedConnections: 1,
    unusedDialObserved: true,
    armedOriginHttpAttempts: 0,
    armedProxyDelta: 0,
  };

  test("validateScenarioBCausality passes for valid Scenario B execution proof", () => {
    assert.doesNotThrow(() => validateScenarioBCausality(validScenarioB));
  });

  test("validateScenarioBCausality rejects HTTP reaching origin during armed period", () => {
    assert.throws(
      () =>
        validateScenarioBCausality({
          ...validScenarioB,
          armedOriginHttpAttempts: 1,
        }),
      /origin HTTP was attempted while armed/,
    );
  });

  test("validateScenarioBCausality rejects non-zero proxy delta during armed period", () => {
    assert.throws(
      () =>
        validateScenarioBCausality({ ...validScenarioB, armedProxyDelta: 1 }),
      /proxy requests observed while armed/,
    );
  });

  test("validateScenarioBCausality rejects missing or null synSentOriginFlowId", () => {
    assert.throws(
      () =>
        validateScenarioBCausality({
          ...validScenarioB,
          synSentOriginFlowId: null,
        }),
      /synSentOriginFlowId is required/,
    );
  });

  test("validateScenarioBCausality rejects reused flow differing from parked flow", () => {
    assert.throws(
      () =>
        validateScenarioBCausality({
          ...validScenarioB,
          lastZeroPriorReusedFlowId: "flow-different-5678",
        }),
      /reused flow does not match parked flow/,
    );
  });

  test("validateScenarioBCausality rejects 0 reused connections or missing unusedDialObserved", () => {
    assert.throws(
      () =>
        validateScenarioBCausality({
          ...validScenarioB,
          zeroPriorRequestReusedConnections: 0,
        }),
      /zeroPriorRequestReusedConnections must be at least 1/,
    );
    assert.throws(
      () =>
        validateScenarioBCausality({
          ...validScenarioB,
          unusedDialObserved: false,
        }),
      /unusedDialObserved must be true/,
    );
  });
});

describe("Independent Review Regressions (SYN-B01..SYN-B05)", () => {
  test("SYN-B01: helper fails closed when iptables -C exits 4 (busy lock) instead of 1", async () => {
    const tempDir = createTempDir("syn-gate-c-lock-");
    const binDir = join(tempDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const fakeCmd = join(binDir, "iptables");
    writeFileSync(
      fakeCmd,
      '#!/usr/bin/env bash\nif [ "$1" = "-C" ]; then exit 4; fi\nexit 0\n',
      { mode: 0o755 },
    );
    const uptime = join(tempDir, "proc-uptime");
    writeFileSync(uptime, "100.00 0.00\n", "utf8");
    try {
      const proc = spawn("bash", [HELPER_SCRIPT_PATH], {
        env: {
          ...process.env,
          RUN_ID: VALID_RUN_ID,
          SYN_GATE_DIR: tempDir,
          IPTABLES_CMD: fakeCmd,
          PROC_UPTIME_PATH: uptime,
          HOST_NETNS_INODE: "1",
          OUTER_NETNS_INODE: "2",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const client = createSynGateClient({
        synGateDir: tempDir,
        runId: VALID_RUN_ID,
        requireRootOwnership: false,
      });
      client.writeArmRequest({ ttlMs: 1000 });
      for (let i = 0; i < 50; i++) {
        if (client.readStatusSafe()?.state === SYN_GATE_STATE.ARMED) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      writeFileSync(uptime, "100.05 0.00\n", "utf8");
      client.writeReleaseRequest();
      const code = await new Promise((r) => proc.on("exit", r));
      assert.notEqual(code, 0, "-C exit 4 must fail closed");
      const receipt = client.readReceiptSafe();
      assert.ok(!receipt || receipt.ruleRemovedVerified !== true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("SYN-B02: helper never reports ruleRemovedVerified: true when armedDurationMs > 1000", async () => {
    const tempDir = createTempDir("syn-gate-over1000-");
    const binDir = join(tempDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const fakeCmd = join(binDir, "iptables");
    const uptime = join(tempDir, "proc-uptime");
    writeFileSync(uptime, "100.00 0.00\n", "utf8");
    writeFileSync(
      fakeCmd,
      `#!/usr/bin/env bash\nif [ "$1" = "-D" ]; then printf "101.05 0.00\\n" > "${uptime}"; exit 0; fi\nif [ "$1" = "-C" ]; then exit 1; fi\nexit 0\n`,
      { mode: 0o755 },
    );
    try {
      const proc = spawn("bash", [HELPER_SCRIPT_PATH], {
        env: {
          ...process.env,
          RUN_ID: VALID_RUN_ID,
          SYN_GATE_DIR: tempDir,
          IPTABLES_CMD: fakeCmd,
          PROC_UPTIME_PATH: uptime,
          HOST_NETNS_INODE: "1",
          OUTER_NETNS_INODE: "2",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const client = createSynGateClient({
        synGateDir: tempDir,
        runId: VALID_RUN_ID,
        requireRootOwnership: false,
      });
      client.writeArmRequest({ ttlMs: 1000 });
      for (let i = 0; i < 50; i++) {
        if (client.readStatusSafe()?.state === SYN_GATE_STATE.ARMED) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      writeFileSync(uptime, "101.00 0.00\n", "utf8");
      const code = await new Promise((r) => proc.on("exit", r));
      assert.notEqual(code, 0, "armedDurationMs > 1000 must fail closed");
      const receipt = client.readReceiptSafe();
      assert.ok(!receipt || receipt.ruleRemovedVerified !== true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("SYN-B03: helper fails closed when HOST_NETNS_INODE is omitted", () => {
    const tempDir = createTempDir("syn-gate-nonetns-");
    try {
      const {
        HOST_NETNS_INODE: _unusedHost,
        OUTER_NETNS_INODE: _unusedOuter,
        ...env
      } = {
        ...process.env,
        RUN_ID: VALID_RUN_ID,
        SYN_GATE_DIR: tempDir,
      };
      assert.throws(() =>
        execFileSync("bash", [HELPER_SCRIPT_PATH], { env, stdio: "pipe" }),
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("SYN-B04: helper rejects symlinks and client fails closed on dangling symlink", async () => {
    const tempDir = createTempDir("syn-gate-symlink-");
    const outsideDir = createTempDir("syn-gate-outside-");
    try {
      // Client must reject dangling symlink instead of returning null
      symlinkSync("/nonexistent/dangling", join(tempDir, "status.json"));
      const client = createSynGateClient({
        synGateDir: tempDir,
        runId: VALID_RUN_ID,
        requireRootOwnership: false,
      });
      assert.throws(() => client.readStatusSafe(), /symlink/i);
      rmSync(join(tempDir, "status.json"));

      // Helper must not follow status.json.next symlink
      const victim = join(outsideDir, "victim.txt");
      writeFileSync(victim, "ORIGINAL", "utf8");
      symlinkSync(victim, join(tempDir, "status.json.next"));
      const fake = createFakeIptables(tempDir);
      const uptime = join(tempDir, "proc-uptime");
      writeFileSync(uptime, "100.00 0.00\n", "utf8");
      const proc = spawn("bash", [HELPER_SCRIPT_PATH], {
        env: {
          ...process.env,
          RUN_ID: VALID_RUN_ID,
          SYN_GATE_DIR: tempDir,
          IPTABLES_CMD: fake.scriptPath,
          PROC_UPTIME_PATH: uptime,
          HOST_NETNS_INODE: "1",
          OUTER_NETNS_INODE: "2",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      client.writeArmRequest({ ttlMs: 1000 });
      const code = await new Promise((r) => {
        const t = setTimeout(() => {
          proc.stdin.end("STOP\n");
        }, 300);
        proc.on("exit", (c) => {
          clearTimeout(t);
          r(c);
        });
      });
      assert.notEqual(code, 0);
      assert.equal(readFileSync(victim, "utf8"), "ORIGINAL");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  test("SYN-B05: validateScenarioBCausality rejects parked flow differing from synSentOriginFlowId", () => {
    assert.throws(() =>
      validateScenarioBCausality({
        synSentOriginFlowId: "flow-syn-A",
        zeroPriorParkedFlowId: "flow-parked-B",
        lastZeroPriorReusedFlowId: "flow-parked-B",
        zeroPriorRequestReusedConnections: 1,
        unusedDialObserved: true,
        armedOriginHttpAttempts: 0,
        armedProxyDelta: 0,
      }),
    );
  });
});
