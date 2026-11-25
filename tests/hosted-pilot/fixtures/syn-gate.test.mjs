import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
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
import { REQUIRED_PILOT_CASES } from "../native-evidence/evidence-schema.mjs";
import { withOwnedNestedDaemon } from "./nested-lifecycle.mjs";
import { runNativeFixture } from "./run-native.mjs";
import { DIND_IMAGE, RESOURCE_LIMITS } from "./runtime-policy.mjs";
import {
  PILOT_CASE_INVENTORY,
  prepareScenarioBWithSynGate,
  verifyScenarioBAfterDrop,
} from "./scenario-b-driver.mjs";
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
if [ "$1" = "--warmup" ]; then
  exit 0
fi
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
  // Warm freshly created wrapper once so macOS cold-exec scanning does not trip tight 200ms ttlMs bounds.
  execFileSync(scriptPath, ["--warmup"], { stdio: "ignore", timeout: 5000 });
  return { scriptPath, logPath, statePath };
}

function attachStderrCapture(proc) {
  const chunks = [];
  proc.stderr?.on("data", (chunk) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  return () => Buffer.concat(chunks).toString("utf8").trim();
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
          CONTAINER_LABEL: `gwrk.fixture.run=${VALID_RUN_ID}`,
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
    const mockUptimeFile = join(tempDir, "proc-uptime");
    writeFileSync(mockUptimeFile, "100.00 200.00\n", "utf8");
    try {
      const helperProc = spawn("bash", [HELPER_SCRIPT_PATH], {
        env: {
          ...process.env,
          RUN_ID: VALID_RUN_ID,
          CONTAINER_LABEL: `gwrk.fixture.run=${VALID_RUN_ID}`,
          SYN_GATE_DIR: tempDir,
          IPTABLES_CMD: fake.scriptPath,
          PROC_UPTIME_PATH: mockUptimeFile,
          HOST_NETNS_INODE: "1",
          OUTER_NETNS_INODE: "2",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const readStderr = attachStderrCapture(helperProc);

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
        `busy lock must cause helper to exit non-zero (stderr: ${readStderr()})`,
      );
      assert.match(
        readStderr(),
        /status 4/,
        `busy lock stderr must report exit status 4 (stderr: ${readStderr()})`,
      );
      assert.match(
        readFileSync(fake.logPath, "utf8"),
        /-I INPUT 1/,
        "busy lock test must actually invoke iptables -I",
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
          CONTAINER_LABEL: `gwrk.fixture.run=${VALID_RUN_ID}`,
          SYN_GATE_DIR: tempDir,
          IPTABLES_CMD: fake.scriptPath,
          PROC_UPTIME_PATH: mockUptimeFile,
          HOST_NETNS_INODE: "1",
          OUTER_NETNS_INODE: "2",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const readStderr = attachStderrCapture(helperProc);

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
        if (helperProc.exitCode !== null) {
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.ok(
        armed,
        `helper failed to arm (exitCode=${helperProc.exitCode}, stderr=${readStderr()})`,
      );

      // Advance mock uptime by 300ms (> 200ms ttl)
      writeFileSync(mockUptimeFile, "100.30 200.00\n", "utf8");

      // Wait for helper to exit and receipt to be written
      const exitCode = await new Promise((resolve) => {
        helperProc.on("exit", (code) => resolve(code));
      });
      assert.equal(
        exitCode,
        0,
        `helper should exit cleanly on single op completion (stderr=${readStderr()})`,
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
          CONTAINER_LABEL: `gwrk.fixture.run=${VALID_RUN_ID}`,
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
          CONTAINER_LABEL: `gwrk.fixture.run=${VALID_RUN_ID}`,
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
          CONTAINER_LABEL: `gwrk.fixture.run=${VALID_RUN_ID}`,
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
    zeroPriorRequestParkedConnections: 1,
    armedHandshakeDelta: 0,
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

  test("SYN-R2-01: validateScenarioBCausality rejects missing or invalid zeroPriorRequestParkedConnections", () => {
    assert.throws(
      () =>
        validateScenarioBCausality({
          ...validScenarioB,
          zeroPriorRequestParkedConnections: undefined,
        }),
      /zeroPriorRequestParkedConnections must be at least 1/,
    );
    assert.throws(
      () =>
        validateScenarioBCausality({
          ...validScenarioB,
          zeroPriorRequestParkedConnections: 0,
        }),
      /zeroPriorRequestParkedConnections must be at least 1/,
    );
    assert.throws(
      () =>
        validateScenarioBCausality({
          ...validScenarioB,
          zeroPriorRequestParkedConnections: 1.5,
        }),
      /zeroPriorRequestParkedConnections must be at least 1/,
    );
  });

  test("SYN-R2-01: validateScenarioBCausality rejects missing or invalid armedHandshakeDelta", () => {
    assert.throws(
      () =>
        validateScenarioBCausality({
          ...validScenarioB,
          armedHandshakeDelta: undefined,
        }),
      /armed handshake delta must be 0/,
    );
    assert.throws(
      () =>
        validateScenarioBCausality({
          ...validScenarioB,
          armedHandshakeDelta: 1,
        }),
      /armed handshake delta must be 0/,
    );
    assert.throws(
      () =>
        validateScenarioBCausality({
          ...validScenarioB,
          armedHandshakeDelta: 0.5,
        }),
      /armed handshake delta must be 0/,
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
          CONTAINER_LABEL: `gwrk.fixture.run=${VALID_RUN_ID}`,
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
          CONTAINER_LABEL: `gwrk.fixture.run=${VALID_RUN_ID}`,
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
        CONTAINER_LABEL: `gwrk.fixture.run=${VALID_RUN_ID}`,
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
          CONTAINER_LABEL: `gwrk.fixture.run=${VALID_RUN_ID}`,
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
        zeroPriorRequestParkedConnections: 1,
        armedHandshakeDelta: 0,
        unusedDialObserved: true,
        armedOriginHttpAttempts: 0,
        armedProxyDelta: 0,
      }),
    );
  });
});

describe("Independent Review 2 Regressions (SYN-R2-01..SYN-R2-04)", () => {
  test("SYN-R2-02: helper exits non-zero if CONTAINER_LABEL is omitted or invalid", () => {
    const tempDir = createTempDir("syn-gate-label-");
    try {
      const {
        CONTAINER_LABEL: _unusedLabel,
        GWRK_CONTAINER_LABEL: _unusedGwrkLabel,
        FIXTURE_LABEL: _unusedFixtureLabel,
        GWRK_FIXTURE_RUN: _unusedRun,
        ...env
      } = {
        ...process.env,
        RUN_ID: VALID_RUN_ID,
        SYN_GATE_DIR: tempDir,
        HOST_NETNS_INODE: "1",
        OUTER_NETNS_INODE: "2",
      };
      assert.throws(() =>
        execFileSync("bash", [HELPER_SCRIPT_PATH], { env, stdio: "pipe" }),
      );
      assert.throws(() =>
        execFileSync("bash", [HELPER_SCRIPT_PATH], {
          env: { ...env, CONTAINER_LABEL: "invalid-label" },
          stdio: "pipe",
        }),
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("SYN-R2-03: helper rejects malformed arm.json with garbage wrapper and fractional numbers", async () => {
    const tempDir = createTempDir("syn-gate-malformed-");
    const fake = createFakeIptables(tempDir);
    const uptime = join(tempDir, "proc-uptime");
    writeFileSync(uptime, "100.00 0.00\n", "utf8");
    try {
      const proc = spawn("bash", [HELPER_SCRIPT_PATH], {
        env: {
          ...process.env,
          RUN_ID: VALID_RUN_ID,
          CONTAINER_LABEL: `gwrk.fixture.run=${VALID_RUN_ID}`,
          SYN_GATE_DIR: tempDir,
          IPTABLES_CMD: fake.scriptPath,
          PROC_UPTIME_PATH: uptime,
          HOST_NETNS_INODE: "1",
          OUTER_NETNS_INODE: "2",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const malformedArm = `NOT_JSON {"version":1.9,"runId":"${VALID_RUN_ID}","opId":1.5,"ttlMs":500.99} GARBAGE\n`;
      writeFileSync(join(tempDir, "arm.json"), malformedArm, { mode: 0o600 });

      const code = await new Promise((r) => {
        const timer = setTimeout(() => {
          proc.stdin.end("STOP\n");
        }, 500);
        proc.on("exit", (c) => {
          clearTimeout(timer);
          r(c);
        });
      });
      assert.notEqual(code, 0, "malformed arm.json must exit non-zero");
      const client = createSynGateClient({
        synGateDir: tempDir,
        runId: VALID_RUN_ID,
        requireRootOwnership: false,
      });
      const status = client.readStatusSafe();
      assert.ok(
        !status || status.state !== SYN_GATE_STATE.ARMED,
        "must not arm on malformed arm.json",
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("SYN-R2-03: helper rejects unknown keys, duplicate keys, and glob characters in arm.json", async () => {
    const tempDir = createTempDir("syn-gate-keys-");
    const fake = createFakeIptables(tempDir);
    const uptime = join(tempDir, "proc-uptime");
    writeFileSync(uptime, "100.00 0.00\n", "utf8");
    try {
      const proc = spawn("bash", [HELPER_SCRIPT_PATH], {
        env: {
          ...process.env,
          RUN_ID: VALID_RUN_ID,
          CONTAINER_LABEL: `gwrk.fixture.run=${VALID_RUN_ID}`,
          SYN_GATE_DIR: tempDir,
          IPTABLES_CMD: fake.scriptPath,
          PROC_UPTIME_PATH: uptime,
          HOST_NETNS_INODE: "1",
          OUTER_NETNS_INODE: "2",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      writeFileSync(
        join(tempDir, "arm.json"),
        JSON.stringify({
          version: 1,
          runId: VALID_RUN_ID,
          opId: 1,
          ttlMs: 500,
          "extra*glob": 1,
        }),
        { mode: 0o600 },
      );
      const code = await new Promise((r) => proc.on("exit", r));
      assert.notEqual(code, 0, "unknown/glob key must exit non-zero");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("SYN-R2-04: helper slow install abort runs bounded cleanup() and fails closed when -D exits 4", async () => {
    const tempDir = createTempDir("syn-gate-slow-abort-");
    const binDir = join(tempDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const fakeCmd = join(binDir, "iptables");
    const logFile = join(tempDir, "iptables.log");
    const uptime = join(tempDir, "proc-uptime");
    writeFileSync(uptime, "100.00 0.00\n", "utf8");
    writeFileSync(
      fakeCmd,
      `#!/usr/bin/env bash\nif [ "$1" = "--warmup" ]; then exit 0; fi\necho "$@" >> "${logFile}"\nif [ "$1" = "-I" ]; then printf "100.60 0.00\\n" > "${uptime}"; exit 0; fi\nif [ "$1" = "-D" ]; then exit 4; fi\nif [ "$1" = "-C" ]; then exit 4; fi\nexit 0\n`,
      { mode: 0o755 },
    );
    execFileSync(fakeCmd, ["--warmup"], { stdio: "ignore", timeout: 5000 });
    try {
      const proc = spawn("bash", [HELPER_SCRIPT_PATH], {
        env: {
          ...process.env,
          RUN_ID: VALID_RUN_ID,
          CONTAINER_LABEL: `gwrk.fixture.run=${VALID_RUN_ID}`,
          SYN_GATE_DIR: tempDir,
          IPTABLES_CMD: fakeCmd,
          PROC_UPTIME_PATH: uptime,
          HOST_NETNS_INODE: "1",
          OUTER_NETNS_INODE: "2",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const readStderr = attachStderrCapture(proc);
      const client = createSynGateClient({
        synGateDir: tempDir,
        runId: VALID_RUN_ID,
        requireRootOwnership: false,
      });
      client.writeArmRequest({ ttlMs: 200 });
      const code = await new Promise((r) => proc.on("exit", r));
      assert.notEqual(
        code,
        0,
        `slow install abort must exit non-zero (stderr=${readStderr()})`,
      );

      const logContent = existsSync(logFile)
        ? readFileSync(logFile, "utf8")
        : "";
      assert.ok(
        logContent.includes("-C INPUT"),
        `slow install abort must trigger cleanup() to verify rule removal with -C (stderr=${readStderr()}, log=${logContent})`,
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("SYN-R2-04B: helper install timeout (exit 124) triggers bounded cleanup() to remove raced rule", async () => {
    const tempDir = createTempDir("syn-gate-install-timeout-");
    const fake = createFakeIptables(tempDir, { failInstallCode: 124 });
    const uptime = join(tempDir, "proc-uptime");
    writeFileSync(uptime, "100.00 0.00\n", "utf8");
    try {
      const proc = spawn("bash", [HELPER_SCRIPT_PATH], {
        env: {
          ...process.env,
          RUN_ID: VALID_RUN_ID,
          CONTAINER_LABEL: `gwrk.fixture.run=${VALID_RUN_ID}`,
          SYN_GATE_DIR: tempDir,
          IPTABLES_CMD: fake.scriptPath,
          PROC_UPTIME_PATH: uptime,
          HOST_NETNS_INODE: "1",
          OUTER_NETNS_INODE: "2",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const readStderr = attachStderrCapture(proc);
      const client = createSynGateClient({
        synGateDir: tempDir,
        runId: VALID_RUN_ID,
        requireRootOwnership: false,
      });
      client.writeArmRequest({ ttlMs: 200 });
      const code = await new Promise((r) => proc.on("exit", r));
      assert.notEqual(
        code,
        0,
        `install timeout must exit non-zero (stderr=${readStderr()})`,
      );
      assert.match(readStderr(), /status 124/);
      const logContent = readFileSync(fake.logPath, "utf8");
      assert.match(logContent, /-D INPUT/);
      assert.match(logContent, /-C INPUT/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("SYN-R3-01: helper rejects arm.json with embedded spaces inside keys or values and never arms", async () => {
    const tempDir = createTempDir("syn-gate-arm-spaces-");
    const fake = createFakeIptables(tempDir);
    const uptime = join(tempDir, "proc-uptime");
    writeFileSync(uptime, "100.00 0.00\n", "utf8");
    try {
      const proc = spawn("bash", [HELPER_SCRIPT_PATH], {
        env: {
          ...process.env,
          RUN_ID: VALID_RUN_ID,
          CONTAINER_LABEL: `gwrk.fixture.run=${VALID_RUN_ID}`,
          SYN_GATE_DIR: tempDir,
          IPTABLES_CMD: fake.scriptPath,
          PROC_UPTIME_PATH: uptime,
          HOST_NETNS_INODE: "1",
          OUTER_NETNS_INODE: "2",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const invalidArm = `{"ver sion": 1, "run Id": "0123 456789abcdef01234567", "op Id": 1, "ttl Ms": 5 0 0}\n`;
      writeFileSync(join(tempDir, "arm.json"), invalidArm, { mode: 0o600 });

      const code = await new Promise((r) => {
        const timer = setTimeout(() => {
          proc.stdin.end("STOP\n");
        }, 500);
        proc.on("exit", (c) => {
          clearTimeout(timer);
          r(c);
        });
      });
      assert.notEqual(
        code,
        0,
        "arm.json with embedded spaces must exit non-zero",
      );
      const client = createSynGateClient({
        synGateDir: tempDir,
        runId: VALID_RUN_ID,
        requireRootOwnership: false,
      });
      const status = client.readStatusSafe();
      assert.ok(
        !status || status.state !== SYN_GATE_STATE.ARMED,
        "must not arm on arm.json with embedded spaces",
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("SYN-R3-01: helper rejects arm.json with embedded newline inside string or number and never arms", async () => {
    const tempDir = createTempDir("syn-gate-arm-newline-");
    const fake = createFakeIptables(tempDir);
    const uptime = join(tempDir, "proc-uptime");
    writeFileSync(uptime, "100.00 0.00\n", "utf8");
    try {
      const proc = spawn("bash", [HELPER_SCRIPT_PATH], {
        env: {
          ...process.env,
          RUN_ID: VALID_RUN_ID,
          CONTAINER_LABEL: `gwrk.fixture.run=${VALID_RUN_ID}`,
          SYN_GATE_DIR: tempDir,
          IPTABLES_CMD: fake.scriptPath,
          PROC_UPTIME_PATH: uptime,
          HOST_NETNS_INODE: "1",
          OUTER_NETNS_INODE: "2",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const invalidArm = `{"version": 1, "runId": "0123\n456789abcdef01234567", "opId": 1, "ttlMs": 5\n00}\n`;
      writeFileSync(join(tempDir, "arm.json"), invalidArm, { mode: 0o600 });

      const code = await new Promise((r) => {
        const timer = setTimeout(() => {
          proc.stdin.end("STOP\n");
        }, 500);
        proc.on("exit", (c) => {
          clearTimeout(timer);
          r(c);
        });
      });
      assert.notEqual(
        code,
        0,
        "arm.json with embedded newline must exit non-zero",
      );
      const client = createSynGateClient({
        synGateDir: tempDir,
        runId: VALID_RUN_ID,
        requireRootOwnership: false,
      });
      const status = client.readStatusSafe();
      assert.ok(
        !status || status.state !== SYN_GATE_STATE.ARMED,
        "must not arm on arm.json with embedded newline",
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("SYN-R3-01: helper rejects release.json with malformed text or embedded spaces fail-closed", async () => {
    // Subcase A: embedded spaces in release.json
    {
      const tempDir = createTempDir("syn-gate-rel-spaces-");
      const fake = createFakeIptables(tempDir);
      const uptime = join(tempDir, "proc-uptime");
      writeFileSync(uptime, "100.00 0.00\n", "utf8");
      try {
        const proc = spawn("bash", [HELPER_SCRIPT_PATH], {
          env: {
            ...process.env,
            RUN_ID: VALID_RUN_ID,
            CONTAINER_LABEL: `gwrk.fixture.run=${VALID_RUN_ID}`,
            SYN_GATE_DIR: tempDir,
            IPTABLES_CMD: fake.scriptPath,
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

        // Write release.json with embedded spaces
        writeFileSync(
          join(tempDir, "release.json"),
          `{"ver sion": 1, "runId": "0123 456789abcdef01234567", "opId": 1, "ac tion": "re lease"}\n`,
          { mode: 0o600 },
        );

        const code = await new Promise((r) => {
          const timer = setTimeout(() => {
            proc.stdin.end("STOP\n");
          }, 500);
          proc.on("exit", (c) => {
            clearTimeout(timer);
            r(c);
          });
        });
        assert.notEqual(
          code,
          0,
          "release.json with embedded spaces must exit non-zero fail-closed",
        );
        const receipt = client.readReceiptSafe();
        assert.ok(
          !receipt || receipt.state !== SYN_GATE_STATE.RELEASED,
          "must not release on release.json with embedded spaces",
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }

    // Subcase B: malformed text wrapper NOT_JSON {...} GARBAGE in release.json
    {
      const tempDir = createTempDir("syn-gate-rel-garbage-");
      const fake = createFakeIptables(tempDir);
      const uptime = join(tempDir, "proc-uptime");
      writeFileSync(uptime, "100.00 0.00\n", "utf8");
      try {
        const proc = spawn("bash", [HELPER_SCRIPT_PATH], {
          env: {
            ...process.env,
            RUN_ID: VALID_RUN_ID,
            CONTAINER_LABEL: `gwrk.fixture.run=${VALID_RUN_ID}`,
            SYN_GATE_DIR: tempDir,
            IPTABLES_CMD: fake.scriptPath,
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

        // Write release.json with NOT_JSON wrapper
        writeFileSync(
          join(tempDir, "release.json"),
          `NOT_JSON {"version": 1, "runId": "${VALID_RUN_ID}", "opId": 1, "action": "release"} GARBAGE\n`,
          { mode: 0o600 },
        );

        const code = await new Promise((r) => {
          const timer = setTimeout(() => {
            proc.stdin.end("STOP\n");
          }, 500);
          proc.on("exit", (c) => {
            clearTimeout(timer);
            r(c);
          });
        });
        assert.notEqual(
          code,
          0,
          "release.json with malformed wrapper must exit non-zero fail-closed",
        );
        const receipt = client.readReceiptSafe();
        assert.ok(
          !receipt || receipt.state !== SYN_GATE_STATE.RELEASED,
          "must not release on release.json with malformed wrapper",
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });
});

describe("Scenario B Driver-to-Helper and Controller Integration", () => {
  test("PILOT_CASE_INVENTORY matches REQUIRED_PILOT_CASES exactly", () => {
    assert.deepEqual([...PILOT_CASE_INVENTORY], [...REQUIRED_PILOT_CASES]);
  });

  test("Scenario B driver wires real syn-gate-helper.sh arm/release and proves same-flow causality", async () => {
    const tempDir = createTempDir("syn-gate-driver-e2e-");
    const fake = createFakeIptables(tempDir);
    const uptime = join(tempDir, "proc-uptime");
    writeFileSync(uptime, "100.00 0.00\n", "utf8");
    const controls = [];
    const flowId = "127.0.0.1:42424->127.0.0.1:18790#1";
    let phase = "baseline";

    try {
      const helperProc = spawn("bash", [HELPER_SCRIPT_PATH], {
        env: {
          ...process.env,
          RUN_ID: VALID_RUN_ID,
          CONTAINER_LABEL: `gwrk.fixture.run=${VALID_RUN_ID}`,
          SYN_GATE_DIR: tempDir,
          IPTABLES_CMD: fake.scriptPath,
          PROC_UPTIME_PATH: uptime,
          HOST_NETNS_INODE: "1001",
          OUTER_NETNS_INODE: "2002",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const readStderr = attachStderrCapture(helperProc);
      const exitPromise = new Promise((resolve) => {
        helperProc.once("exit", resolve);
      });

      const prep = await prepareScenarioBWithSynGate({
        runId: VALID_RUN_ID,
        synGateDir: tempDir,
        requireRootOwnership: false,
        sendControl: (cmd) => {
          controls.push(cmd);
        },
        observe: () => ({ loginAttempts: 10 }),
        barrier: () => {
          if (phase === "armed" && existsSync(join(tempDir, "release.json"))) {
            phase = "parked";
          }
          return { proxyRequests: [] };
        },
        readHealth: () => {
          if (phase === "baseline") {
            return {
              originTcpSummary: {
                handshakesCompleted: 2,
                zeroPriorRequestParkedConnections: 0,
                zeroPriorRequestReusedConnections: 0,
                unusedDialObserved: false,
                lastSynSentOriginFlowId: "127.0.0.1:40000->127.0.0.1:18790#1",
                lastZeroPriorParkedFlowId: null,
                lastZeroPriorReusedFlowId: null,
              },
            };
          }
          if (phase === "armed") {
            return {
              originTcpSummary: {
                handshakesCompleted: 2,
                zeroPriorRequestParkedConnections: 0,
                zeroPriorRequestReusedConnections: 0,
                unusedDialObserved: false,
                lastSynSentOriginFlowId: flowId,
                lastZeroPriorParkedFlowId: null,
                lastZeroPriorReusedFlowId: null,
              },
            };
          }
          return {
            originTcpSummary: {
              handshakesCompleted: 3,
              zeroPriorRequestParkedConnections: 1,
              zeroPriorRequestReusedConnections: 0,
              unusedDialObserved: false,
              lastSynSentOriginFlowId: flowId,
              lastZeroPriorParkedFlowId: flowId,
              lastZeroPriorReusedFlowId: null,
            },
          };
        },
        sendCancelledDial: async () => {
          phase = "armed";
          writeFileSync(uptime, "100.12 0.00\n", "utf8");
          return { cancelled: true };
        },
        parkPollTimeoutMs: 500,
        parkPollIntervalMs: 10,
      });

      const exitCode = await exitPromise;
      assert.equal(
        exitCode,
        0,
        `helper must exit cleanly after single op release (stderr=${readStderr()})`,
      );
      assert.deepEqual(controls, [{ closeIdleConnections: true }]);
      assert.equal(prep.synSentOriginFlowId, flowId);
      assert.equal(prep.zeroPriorParkedFlowId, flowId);
      assert.equal(prep.releaseReceipt.ruleRemovedVerified, true);
      assert.ok(prep.releaseReceipt.armedDurationMs <= 1000);

      const causality = verifyScenarioBAfterDrop({
        preparation: prep,
        afterDropHealth: {
          originTcpSummary: {
            zeroPriorRequestParkedConnections: 1,
            zeroPriorRequestReusedConnections: 1,
            unusedDialObserved: true,
            lastZeroPriorReusedFlowId: flowId,
          },
        },
      });
      assert.equal(causality.lastZeroPriorReusedFlowId, flowId);

      // Negative control: reused flow differing from parked/SYN flow fails closed
      assert.throws(
        () =>
          verifyScenarioBAfterDrop({
            preparation: prep,
            afterDropHealth: {
              originTcpSummary: {
                zeroPriorRequestParkedConnections: 1,
                zeroPriorRequestReusedConnections: 1,
                unusedDialObserved: true,
                lastZeroPriorReusedFlowId: "127.0.0.1:59999->127.0.0.1:18790#1",
              },
            },
          }),
        /reused flow does not match parked flow/,
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("runNativeFixture starts outer SYN-gate helper without granting controller NET_ADMIN and drains it in finally", async () => {
    const runId = VALID_RUN_ID;
    const root = `/opt/gwrk-verification/${runId}`;
    const store = new Map();
    const files = {
      existsSync: (p) => store.has(p),
      readFileSync: (p) => store.get(p),
      writeFileSync: (p, value) => store.set(p, value),
    };
    const images = {
      node: `sha256:${"1".repeat(64)}`,
      traefik: `sha256:${"2".repeat(64)}`,
      proxy: `sha256:${"3".repeat(64)}`,
      nginx: `sha256:${"4".repeat(64)}`,
      issuerNode: `sha256:${"5".repeat(64)}`,
      rootfs: {
        node: [`sha256:${"a".repeat(64)}`],
        traefik: [`sha256:${"b".repeat(64)}`],
        proxy: [`sha256:${"c".repeat(64)}`],
        nginx: [`sha256:${"d".repeat(64)}`],
        issuerNode: [`sha256:${"e".repeat(64)}`],
      },
    };
    let helperSpawned = null;
    let helperStopped = false;
    let capturedControllerArgs = null;

    await runNativeFixture({
      runId,
      root,
      receipt: {
        purpose: "acceptance",
        reviewedSource: true,
        approvedPassiveNetRaw: true,
        approvedScenarioBSynGate: true,
      },
      images,
      files,
      spawnSynGateHelper: (opts) => {
        helperSpawned = opts;
        const listeners = new Map();
        const fakeProc = {
          exitCode: null,
          signalCode: null,
          stdin: {
            destroyed: false,
            write: (chunk) => {
              if (String(chunk).includes("STOP")) helperStopped = true;
            },
            end: () => {
              fakeProc.exitCode = 0;
              const cb = listeners.get("close");
              if (cb) cb(0, null);
            },
          },
          stdout: { resume: () => {} },
          stderr: { resume: () => {} },
          once: (ev, cb) => listeners.set(ev, cb),
          kill: () => {},
        };
        return fakeProc;
      },
      withLifecycle: async ({ executeCases }) => {
        await executeCases({
          containerId: "f".repeat(64),
          hostNetNamespace: "net:[4026531840]",
          outerNetNamespace: "net:[4026532999]",
          docker: async (args) => {
            if (args.includes("inspect")) {
              const target = args.at(-1);
              const key = Object.entries(images).find(
                ([, value]) => value === target,
              )[0];
              return JSON.stringify({
                Id: target,
                RootFS: { Layers: images.rootfs[key] },
              });
            }
            if (args.includes("mkdir") || args.includes("chmod")) return "";
            if (args.includes("/fixture/syn-gate/receipt.json")) {
              return JSON.stringify({
                version: 1,
                runId,
                opId: 1,
                state: "RELEASED",
                installDurationMs: 4,
                armedDurationMs: 120,
                removeDurationMs: 5,
                ruleRemovedVerified: true,
              });
            }
            if (args.includes("/fixture/bootstrap-stage.json")) {
              return JSON.stringify({ stage: "completed_combined_proofs" });
            }
            if (args.includes("/fixture/traefik-version.json")) {
              return JSON.stringify({
                traefikVersion: "3.7.18",
                goVersion: "go1.25.0",
              });
            }
            if (args.includes("/fixture/pilot-proof-result.json")) {
              return JSON.stringify({
                event: "gateway_native_suite_passed",
                nativeSuiteStatus: "passed",
                livePilotAcceptance: false,
                runId,
                cases: [...REQUIRED_PILOT_CASES],
                captureDrops: 0,
                captureFaults: 0,
                leakedSecrets: 0,
              });
            }
            if (args.includes("/fixture/legacy-proof-result.json")) {
              return JSON.stringify({
                exitCode: 0,
                scriptSha256: "9".repeat(64),
                successMarker: "Hosted sign-in fixture passed",
                cleanupComplete: true,
                rawReceipt: "Hosted sign-in fixture passed\n",
              });
            }
            throw new Error(`unexpected docker args: ${args.join(" ")}`);
          },
          spawnDocker: async (args) => {
            if (args.includes("load")) {
              return { code: 0, stdout: "Loaded\n", stderr: "" };
            }
            if (args.includes("/input/fixtures/bootstrap.mjs")) {
              capturedControllerArgs = args;
              return { code: 0, stdout: "ok\n", stderr: "" };
            }
            throw new Error(`unexpected spawnDocker args: ${args.join(" ")}`);
          },
        });
      },
    });

    assert.ok(helperSpawned, "outer SYN-gate helper must be started");
    assert.equal(helperStopped, true, "outer SYN-gate helper must be drained");
    assert.equal(
      capturedControllerArgs.includes("NET_ADMIN"),
      false,
      "controller container must NEVER gain NET_ADMIN",
    );
    assert.equal(
      capturedControllerArgs.includes(
        "GWRK_051_SYN_GATE_DIR=/fixture/syn-gate",
      ),
      true,
      "controller must receive GWRK_051_SYN_GATE_DIR",
    );
    assert.equal(
      capturedControllerArgs.includes("GWRK_051_RUN_LEGACY_PROOF=1"),
      true,
      "acceptance run must execute unchanged legacy proof",
    );
    const nativeResult = JSON.parse(store.get(`${root}/native-result.json`));
    assert.equal(nativeResult.nativeSuiteStatus, "passed");
    assert.equal(nativeResult.livePilotAcceptance, false);
    assert.equal(nativeResult.pilotProof.cases.length, 15);
    assert.equal(nativeResult.legacyProof.cleanupComplete, true);
    assert.equal(nativeResult.synGateReceipt.ruleRemovedVerified, true);
  });
});
