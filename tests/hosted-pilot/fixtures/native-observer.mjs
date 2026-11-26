import assert from "node:assert/strict";
import { ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import dgram from "node:dgram";
import {
  closeSync,
  existsSync,
  fchmodSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_OBSERVER_LIMITS,
  buildHealthSidecar,
  buildV1Snapshot,
  createObserverState,
  ingestPacket,
  matchBarrier,
  recordStats,
} from "./native-observer-parser.mjs";

const FIXTURES_DIR = dirname(fileURLToPath(import.meta.url));
const CAPTURE_HELPER_PATH = join(FIXTURES_DIR, "native-observer-capture.py");

export const CAPTURE_FRAME_KIND = Object.freeze({
  PACKET: 1,
  STATS_REPLY: 2,
  READY: 3,
  FAULT: 4,
});

export const CAPTURE_FAULT_CODE_MAP = Object.freeze({
  1: "TRUNCATED_FRAME_OBSERVED",
  2: "KERNEL_DROP_OBSERVED",
});

const CMD_STATS = Buffer.from([0x53]); // 'S'
const CMD_QUIT = Buffer.from([0x51]); // 'Q'
const HEADER_BYTES = 24;
const MAX_JSON_FILE_BYTES = 2 * 1024 * 1024;
const RUN_ID_RE = /^[a-f0-9]{24}$/;

export function createFrameDecoder(
  onFrame,
  { maxCapLen = DEFAULT_OBSERVER_LIMITS.maxFrameBytes } = {},
) {
  let buffer = Buffer.alloc(0);

  return {
    push(chunk) {
      const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (incoming.length === 0) return;
      buffer =
        buffer.length === 0 ? incoming : Buffer.concat([buffer, incoming]);

      while (buffer.length >= HEADER_BYTES) {
        const kind = buffer.readUInt8(0);
        const pkttype = buffer.readUInt8(1);
        const ethProto = buffer.readUInt16BE(2);
        const ifindex = buffer.readUInt32BE(4);
        const monotonicNs = buffer.readBigUInt64BE(8);
        const origLen = buffer.readUInt32BE(16);
        const capLen = buffer.readUInt32BE(20);

        if (capLen > maxCapLen) {
          buffer = Buffer.alloc(0);
          throw new Error(
            `capture frame capLen ${capLen} exceeds bound ${maxCapLen}`,
          );
        }

        const totalFrameBytes = HEADER_BYTES + capLen;
        if (buffer.length < totalFrameBytes) {
          return;
        }

        const payload = Buffer.from(
          buffer.subarray(HEADER_BYTES, totalFrameBytes),
        );
        buffer =
          buffer.length === totalFrameBytes
            ? Buffer.alloc(0)
            : Buffer.from(buffer.subarray(totalFrameBytes));

        if (kind === CAPTURE_FRAME_KIND.PACKET) {
          onFrame({
            kind,
            pkttype,
            ethProto,
            ifindex,
            monotonicNs,
            origLen,
            capLen,
            payload,
          });
        } else if (kind === CAPTURE_FRAME_KIND.STATS_REPLY) {
          if (payload.length !== 16) {
            throw new Error(
              `invalid STATS_REPLY payload length ${payload.length}`,
            );
          }
          onFrame({
            kind,
            monotonicNs,
            totalKernelPackets: Number(payload.readBigUInt64BE(0)),
            totalKernelDrops: Number(payload.readBigUInt64BE(8)),
          });
        } else if (kind === CAPTURE_FRAME_KIND.READY) {
          if (payload.length !== 16) {
            throw new Error(`invalid READY payload length ${payload.length}`);
          }
          onFrame({
            kind,
            monotonicNs,
            effectiveRcvBufBytes: payload.readUInt32BE(0),
            ignoreOutgoingKernelEnabled: payload.readUInt8(4) !== 0,
            pkttypeBpfFallbackActive: payload.readUInt8(5) !== 0,
          });
        } else if (kind === CAPTURE_FRAME_KIND.FAULT) {
          if (payload.length !== 8) {
            throw new Error(`invalid FAULT payload length ${payload.length}`);
          }
          onFrame({
            kind,
            monotonicNs,
            faultCodeId: payload.readUInt32BE(0),
            osErrno: payload.readUInt32BE(4),
          });
        } else {
          throw new Error(`unknown capture frame kind ${kind}`);
        }
      }
    },
  };
}

export function verifyObserverDirectory(
  observerDir,
  { requireRootOwnership = true } = {},
) {
  assert.ok(
    typeof observerDir === "string" && observerDir.length > 0,
    "observerDir is required",
  );
  const st = lstatSync(observerDir);
  assert.equal(st.isSymbolicLink(), false, "observerDir must not be a symlink");
  assert.equal(st.isDirectory(), true, "observerDir must be a directory");
  assert.equal(
    st.mode & 0o777,
    0o700,
    `observerDir must have mode 0700, got ${(st.mode & 0o777).toString(8)}`,
  );
  if (requireRootOwnership) {
    assert.equal(st.uid, 0, "observerDir must be owned by root uid 0");
    assert.equal(st.gid, 0, "observerDir must be owned by root gid 0");
  }
  return st;
}

export function readBarrierRequest(
  barrierPath,
  { expectedRunId, requireRootOwnership = true } = {},
) {
  const lst = lstatSync(barrierPath);
  assert.equal(
    lst.isSymbolicLink(),
    false,
    "barrier file must not be a symlink",
  );
  assert.equal(lst.isFile(), true, "barrier file must be a regular file");
  assert.equal(lst.mode & 0o777, 0o600, "barrier file must have mode 0600");
  assert.ok(
    lst.size <= MAX_JSON_FILE_BYTES,
    "barrier file exceeds 2 MiB bound",
  );
  if (requireRootOwnership) {
    assert.equal(lst.uid, 0, "barrier file must be owned by root uid 0");
  }

  const fd = openSync(
    barrierPath,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
  );
  let rawText;
  try {
    const fst = fstatSync(fd);
    assert.equal(
      fst.isFile(),
      true,
      "barrier descriptor must be a regular file",
    );
    assert.equal(fst.ino, lst.ino, "barrier file identity changed during open");
    assert.equal(fst.dev, lst.dev, "barrier device changed during open");
    assert.ok(
      fst.size <= MAX_JSON_FILE_BYTES,
      "barrier file exceeds 2 MiB bound",
    );
    rawText = readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }

  const parsed = JSON.parse(rawText);
  assert.ok(
    parsed && typeof parsed === "object" && !Array.isArray(parsed),
    "barrier request must be a JSON object",
  );
  for (const key of Object.keys(parsed)) {
    assert.ok(
      key === "version" || key === "barrierSequence" || key === "runId",
      `unexpected barrier key ${key}`,
    );
  }
  assert.equal(parsed.version, 1, "barrier version must be 1");
  assert.ok(
    Number.isSafeInteger(parsed.barrierSequence) &&
      parsed.barrierSequence >= 1 &&
      parsed.barrierSequence <= 100_000,
    "barrierSequence must be an integer in 1..100000",
  );
  if (parsed.runId !== undefined) {
    assert.match(parsed.runId, RUN_ID_RE, "barrier runId is invalid");
    if (expectedRunId !== undefined) {
      assert.equal(parsed.runId, expectedRunId, "barrier runId mismatch");
    }
  }
  return parsed;
}

export function atomicWriteSafeJson(
  observerDir,
  filename,
  value,
  { requireRootOwnership = true } = {},
) {
  verifyObserverDirectory(observerDir, { requireRootOwnership });
  const targetPath = join(observerDir, filename);
  const nextPath = `${targetPath}.next`;
  const content = Buffer.from(JSON.stringify(value, null, 2), "utf8");
  assert.ok(
    content.length <= MAX_JSON_FILE_BYTES,
    `${filename} exceeds 2 MiB bound`,
  );

  const fd = openSync(
    nextPath,
    fsConstants.O_WRONLY |
      fsConstants.O_CREAT |
      fsConstants.O_TRUNC |
      fsConstants.O_NOFOLLOW,
    0o600,
  );
  try {
    fchmodSync(fd, 0o600);
    writeSync(fd, content);
  } finally {
    closeSync(fd);
  }
  renameSync(nextPath, targetPath);
}

function defaultSpawnHelper(sentinelPort) {
  return spawn("python3", [CAPTURE_HELPER_PATH, String(sentinelPort)], {
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function defaultCreateUdpSocket() {
  return dgram.createSocket("udp4");
}

function defaultRandomNonceHex() {
  return randomBytes(8).toString("hex");
}

export function createNativeObserverSupervisor({
  provenance,
  observerDir,
  requireRootOwnership = true,
  barrierTimeoutMs = 3000,
  pollIntervalMs = 10,
  drainTimeoutMs = 800,
  limits,
  createUdpSocket = defaultCreateUdpSocket,
  spawnHelper = defaultSpawnHelper,
  randomNonceHex = defaultRandomNonceHex,
} = {}) {
  let state = null;
  let udpSocket = null;
  let helper = null;
  let sentinelPort = null;
  let pollTimer = null;
  let stopped = false;
  let expectingHelperStop = false;
  let helperExited = true;
  let helperClosed = true;
  let helperClosePromise = Promise.resolve();
  let resolveHelperClose = null;
  let barrierInFlight = false;
  let lastHandledBarrier = 0;

  let readyResolve = null;
  let readyReject = null;
  let pendingSentinel = null;
  let pendingStats = null;

  const healthFileName = "native-observer-health.json";
  const snapshotFileName = "native-observation.json";
  const barrierFileName = "native-observation-barrier.json";

  function raceWithTimeout(promise, timeoutMs) {
    return new Promise((resolvePromise) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolvePromise();
      };
      const timer = setTimeout(done, timeoutMs);
      timer.unref?.();
      promise.then(done, done);
    });
  }

  function isProcessAlive(proc) {
    return (
      !helperExited &&
      !helperClosed &&
      proc.exitCode == null &&
      proc.signalCode == null
    );
  }

  function rejectPendingWaiters(error) {
    if (readyReject) {
      const rej = readyReject;
      readyResolve = null;
      readyReject = null;
      rej(error);
    }
    if (pendingSentinel) {
      const waiter = pendingSentinel;
      pendingSentinel = null;
      waiter.reject(error);
    }
    if (pendingStats) {
      const waiter = pendingStats;
      pendingStats = null;
      waiter.reject(error);
    }
  }

  function failUnexpectedHelper(message) {
    if (stopped || expectingHelperStop) return;
    const error = new Error(message);
    const wasWaitingReady = readyReject !== null;
    rejectPendingWaiters(error);
    if (!wasWaitingReady && state) {
      recordStats(state, { integrityFaultCode: "BARRIER_TIMEOUT" });
      try {
        writeHealth();
      } catch {}
    }
  }

  async function drainHelper(proc) {
    if (!proc) return;
    if (!helperClosed && isProcessAlive(proc)) {
      if (proc.stdin && !proc.stdin.destroyed && !proc.stdin.writableEnded) {
        try {
          proc.stdin.write(CMD_QUIT);
          proc.stdin.end();
        } catch {}
      }
      await raceWithTimeout(helperClosePromise, drainTimeoutMs);
    }
    if (!helperClosed && isProcessAlive(proc)) {
      try {
        proc.kill("SIGTERM");
      } catch {}
      await raceWithTimeout(helperClosePromise, drainTimeoutMs);
    }
    if (!helperClosed && isProcessAlive(proc)) {
      try {
        proc.kill("SIGKILL");
      } catch {}
      await raceWithTimeout(helperClosePromise, Math.max(drainTimeoutMs, 500));
    }
    if (!helperClosed) {
      await raceWithTimeout(helperClosePromise, drainTimeoutMs);
    }
  }

  async function closeUdpSocket() {
    if (!udpSocket) return;
    const sock = udpSocket;
    udpSocket = null;
    try {
      await new Promise((res) => sock.close(() => res()));
    } catch {}
  }

  async function cleanupResources() {
    expectingHelperStop = true;
    rejectPendingWaiters(new Error("observer supervisor stopped"));
    const proc = helper;
    helper = null;
    await drainHelper(proc);
    await closeUdpSocket();
  }

  function writeHealth() {
    if (!state) return;
    atomicWriteSafeJson(
      observerDir,
      healthFileName,
      buildHealthSidecar(state),
      {
        requireRootOwnership,
      },
    );
  }

  function writeSnapshot() {
    if (!state) return;
    atomicWriteSafeJson(observerDir, snapshotFileName, buildV1Snapshot(state), {
      requireRootOwnership,
    });
  }

  function onDecodedFrame(frame) {
    if (frame.kind === CAPTURE_FRAME_KIND.READY) {
      if (state) {
        recordStats(state, {
          effectiveRcvBufBytes: frame.effectiveRcvBufBytes,
          ignoreOutgoingKernelEnabled: frame.ignoreOutgoingKernelEnabled,
          pkttypeBpfFallbackActive: frame.pkttypeBpfFallbackActive,
        });
      }
      if (readyResolve) {
        const res = readyResolve;
        readyResolve = null;
        readyReject = null;
        res(frame);
      }
      return;
    }

    if (frame.kind === CAPTURE_FRAME_KIND.PACKET) {
      if (!state) return;
      const beforeFault = state.captureStats.integrityFaultCode;
      ingestPacket(state, {
        pkttype: frame.pkttype,
        ethProto: frame.ethProto,
        monotonicNs: frame.monotonicNs,
        origLen: frame.origLen,
        payload: frame.payload,
      });
      if (
        beforeFault === null &&
        state.captureStats.integrityFaultCode !== null
      ) {
        writeHealth();
      }
      if (
        pendingSentinel &&
        state.observedSentinels.includes(pendingSentinel.expectedPayload)
      ) {
        const waiter = pendingSentinel;
        pendingSentinel = null;
        waiter.resolve();
      }
      return;
    }

    if (frame.kind === CAPTURE_FRAME_KIND.STATS_REPLY) {
      if (state) {
        recordStats(state, {
          kernelPackets: frame.totalKernelPackets,
          kernelDrops: frame.totalKernelDrops,
        });
      }
      if (pendingStats) {
        const waiter = pendingStats;
        pendingStats = null;
        waiter.resolve(frame);
      }
      return;
    }

    if (frame.kind === CAPTURE_FRAME_KIND.FAULT) {
      const faultCode =
        CAPTURE_FAULT_CODE_MAP[frame.faultCodeId] ?? "TRUNCATED_FRAME_OBSERVED";
      if (state) {
        recordStats(state, { integrityFaultCode: faultCode });
        writeHealth();
      }
    }
  }

  function awaitWithTimeout(executor, timeoutMs, timeoutErrorMessage) {
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        rejectPromise(new Error(timeoutErrorMessage));
      }, timeoutMs);
      timer.unref?.();
      executor(
        (value) => {
          clearTimeout(timer);
          resolvePromise(value);
        },
        (err) => {
          clearTimeout(timer);
          rejectPromise(err);
        },
      );
    });
  }

  async function runBarrier(barrierSequence) {
    assert.ok(state && udpSocket && helper, "observer supervisor not started");
    const nonce = randomNonceHex();
    const expectedPayload = `GWRK051:${state.provenance.runId}:${barrierSequence}:${nonce}`;
    const startMs = Date.now();

    try {
      if (!isProcessAlive(helper)) {
        throw new Error("capture helper is not running");
      }
      // Wait for passive capture of the loopback UDP sentinel
      const sentinelPromise = awaitWithTimeout(
        (res, rej) => {
          pendingSentinel = { expectedPayload, resolve: res, reject: rej };
        },
        barrierTimeoutMs,
        "BARRIER_TIMEOUT: sentinel not observed",
      );
      sentinelPromise.catch(() => {});

      await new Promise((res, rej) => {
        udpSocket.send(
          Buffer.from(expectedPayload, "ascii"),
          sentinelPort,
          "127.0.0.1",
          (err) => (err ? rej(err) : res()),
        );
      });

      await sentinelPromise;

      if (
        !helper ||
        !isProcessAlive(helper) ||
        !helper.stdin ||
        helper.stdin.destroyed ||
        helper.stdin.writableEnded
      ) {
        throw new Error("capture helper is not running");
      }

      // Send 'S' (0x53) to drain non-blocking frames and read PACKET_STATISTICS
      const remainingMs = Math.max(
        1,
        barrierTimeoutMs - (Date.now() - startMs),
      );
      const statsPromise = awaitWithTimeout(
        (res, rej) => {
          pendingStats = { resolve: res, reject: rej };
        },
        remainingMs,
        "BARRIER_TIMEOUT: STATS_REPLY not received",
      );
      statsPromise.catch(() => {});

      helper.stdin.write(CMD_STATS);
      await statsPromise;
    } catch (error) {
      pendingSentinel = null;
      pendingStats = null;
      recordStats(state, { integrityFaultCode: "BARRIER_TIMEOUT" });
      writeHealth();
      if (barrierSequence === 0) {
        throw error;
      }
      return {
        advanced: false,
        faultCode: state.captureStats.integrityFaultCode,
        barrierSequence: state.barrierSequence,
      };
    }

    const matched = matchBarrier(state, { barrierSequence, expectedPayload });
    writeHealth();
    if (!matched.matched) {
      return {
        advanced: false,
        faultCode: matched.faultCode ?? state.captureStats.integrityFaultCode,
        barrierSequence: state.barrierSequence,
      };
    }

    if (barrierSequence >= 1 && state.proxyRequests.length > 0) {
      writeSnapshot();
    }
    return {
      advanced: true,
      faultCode: null,
      barrierSequence: state.barrierSequence,
    };
  }

  async function start() {
    verifyObserverDirectory(observerDir, { requireRootOwnership });
    expectingHelperStop = false;
    udpSocket = createUdpSocket();
    try {
      // Drain matched datagrams so the kernel does not emit ICMP port-unreachable
      udpSocket.on("message", () => {});

      await new Promise((res, rej) => {
        const onBindError = (err) => rej(err);
        udpSocket.once?.("error", onBindError);
        if (!udpSocket.once) udpSocket.on("error", onBindError);
        udpSocket.bind(0, "127.0.0.1", () => {
          udpSocket.off?.("error", onBindError);
          res();
        });
      });
      udpSocket.on("error", () => {});
      const addr = udpSocket.address();
      sentinelPort = addr.port;
      state = createObserverState({ provenance, sentinelPort, limits });

      const decoder = createFrameDecoder(onDecodedFrame, {
        maxCapLen: state.limits.maxFrameBytes,
      });

      const readyPromise = awaitWithTimeout(
        (res, rej) => {
          readyResolve = res;
          readyReject = rej;
        },
        barrierTimeoutMs,
        "BARRIER_TIMEOUT: capture helper READY not received",
      );
      readyPromise.catch(() => {});

      const proc = spawnHelper(sentinelPort);
      helper = proc;
      const isRealChild = proc instanceof ChildProcess;
      helperExited = false;
      helperClosed = false;
      helperClosePromise = new Promise((res) => {
        resolveHelperClose = res;
      });
      const markClosed = () => {
        helperExited = true;
        helperClosed = true;
        const done = resolveHelperClose;
        resolveHelperClose = null;
        done?.();
      };

      proc.on("error", (err) => {
        if (proc.pid == null) {
          markClosed();
        }
        failUnexpectedHelper(
          `capture helper spawn error: ${err?.code ?? err?.message ?? "unknown"}`,
        );
      });

      proc.stdin?.on("error", (err) => {
        failUnexpectedHelper(
          `capture helper stdin error: ${err?.code ?? err?.message ?? "unknown"}`,
        );
      });

      proc.stdout?.on("error", (err) => {
        failUnexpectedHelper(
          `capture helper stdout error: ${err?.code ?? err?.message ?? "unknown"}`,
        );
      });

      proc.stderr?.on("error", () => {});
      proc.stderr?.on("data", () => {});

      proc.stdout.on("data", (chunk) => {
        try {
          decoder.push(chunk);
        } catch {
          recordStats(state, {
            integrityFaultCode: "TRUNCATED_FRAME_OBSERVED",
          });
          writeHealth();
        }
      });

      proc.on("exit", (code, signal) => {
        helperExited = true;
        if (!isRealChild) {
          markClosed();
        }
        if (readyReject) {
          failUnexpectedHelper(
            `capture helper exited before READY (code=${code}, signal=${signal})`,
          );
          return;
        }
        failUnexpectedHelper(
          `capture helper exited unexpectedly (code=${code}, signal=${signal})`,
        );
      });

      proc.on("close", (code, signal) => {
        markClosed();
        if (!stopped && !expectingHelperStop) {
          failUnexpectedHelper(
            `capture helper closed unexpectedly (code=${code}, signal=${signal})`,
          );
        }
      });

      const ready = await readyPromise;
      if (ready.effectiveRcvBufBytes < state.limits.minRcvBufBytes) {
        throw new Error(
          `effective SO_RCVBUF ${ready.effectiveRcvBufBytes} below required ${state.limits.minRcvBufBytes}`,
        );
      }

      const selfTest = await runBarrier(0);
      if (!selfTest.advanced) {
        throw new Error(
          `observer startup self-test failed: ${selfTest.faultCode ?? "unknown"}`,
        );
      }
      return buildHealthSidecar(state);
    } catch (error) {
      await cleanupResources();
      throw error;
    }
  }

  async function processBarrierFile() {
    if (barrierInFlight || stopped) {
      return { advanced: false, skipped: true };
    }
    const barrierPath = join(observerDir, barrierFileName);
    if (!existsSync(barrierPath)) {
      return { advanced: false, skipped: true };
    }
    verifyObserverDirectory(observerDir, { requireRootOwnership });
    let req;
    try {
      req = readBarrierRequest(barrierPath, {
        expectedRunId: state.provenance.runId,
        requireRootOwnership,
      });
    } catch (error) {
      if (
        error &&
        (error.code === "ENOENT" ||
          /identity changed during open/.test(String(error.message)))
      ) {
        return { advanced: false, skipped: true };
      }
      throw error;
    }
    if (req.barrierSequence <= lastHandledBarrier) {
      return {
        advanced: false,
        faultCode: state.captureStats.integrityFaultCode,
        barrierSequence: state.barrierSequence,
      };
    }
    if (state.captureStats.integrityFaultCode !== null) {
      lastHandledBarrier = req.barrierSequence;
      writeHealth();
      return {
        advanced: false,
        faultCode: state.captureStats.integrityFaultCode,
        barrierSequence: state.barrierSequence,
      };
    }
    barrierInFlight = true;
    try {
      const result = await runBarrier(req.barrierSequence);
      lastHandledBarrier = req.barrierSequence;
      return result;
    } finally {
      barrierInFlight = false;
    }
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      processBarrierFile().catch(() => {
        if (state) {
          recordStats(state, { integrityFaultCode: "BARRIER_TIMEOUT" });
          try {
            writeHealth();
          } catch {}
        }
      });
    }, pollIntervalMs);
    pollTimer.unref?.();
  }

  async function stop() {
    if (stopped) return;
    stopped = true;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    await cleanupResources();
  }

  return {
    start,
    startPolling,
    processBarrierFile,
    runBarrier,
    stop,
    getState: () => state,
  };
}

async function runCli() {
  const observerDir = process.env.GWRK_051_OBSERVER_DIR || "/fixture/observer";
  const provenance = {
    runId: process.env.GWRK_051_RUN_ID,
    proxyImageId: process.env.GWRK_051_PROXY_IMAGE_ID,
    traefikImageId: process.env.GWRK_051_TRAEFIK_IMAGE_ID,
    runtimeReceiptSha256: process.env.GWRK_051_RUNTIME_RECEIPT_SHA256,
  };
  const supervisor = createNativeObserverSupervisor({
    provenance,
    observerDir,
    requireRootOwnership: true,
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await supervisor.stop();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await supervisor.start();
  supervisor.startPolling();
  // Keep event loop alive until SIGTERM/SIGINT
  const keepAlive = setInterval(() => {}, 60_000);
  process.on("exit", () => clearInterval(keepAlive));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runCli().catch((error) => {
    process.stderr.write(`native-observer fatal: ${error.message}\n`);
    process.exit(1);
  });
}
