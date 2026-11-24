import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import {
  BOOTSTRAP_STAGES,
  STATIC_CONSTRUCTION_CATEGORIES,
  STATIC_OPERATION_NAMES,
  classifyBootstrapFailure,
} from "./bootstrap-diagnostics.mjs";
import {
  createObserverProcessLifecycle,
  executeObserverSelftest,
  isAllowedFixtureScriptName,
  resolveComposeContainer,
} from "./bootstrap-observer.mjs";
import {
  buildHealthSidecar,
  buildV1Snapshot,
  createObserverState,
  ingestPacket,
  matchBarrier,
  recordStats,
} from "./native-observer-parser.mjs";
import {
  CAPTURE_FRAME_KIND,
  createNativeObserverSupervisor,
} from "./native-observer.mjs";
import {
  assertProxyWireMatch,
  assertScenarioBReuseProof,
  readNativeObservationBarrier,
  readNativeObserverHealth,
  readSafeJson,
  validateNativeObserverHealth,
  verifyObserverDirectory,
} from "./raw-https.mjs";

const FIXTURES_DIR = fileURLToPath(new URL(".", import.meta.url));
const RAW_HTTPS_URL = new URL("./raw-https.mjs", import.meta.url).href;

const VALID_RUN_ID = "0123456789abcdef01234567";
const VALID_PROVENANCE = Object.freeze({
  runId: VALID_RUN_ID,
  proxyImageId: `sha256:${"a".repeat(64)}`,
  traefikImageId: `sha256:${"b".repeat(64)}`,
  runtimeReceiptSha256: "c".repeat(64),
});

function createValidHealth(overrides = {}) {
  return {
    version: 1,
    provenance: {
      ...VALID_PROVENANCE,
      source: "passive_tcp",
      namespace: "owned_nested",
    },
    barrierSequence: 4,
    sentinelPort: 49152,
    startupSelfTestPassed: true,
    captureStats: {
      kernelPackets: 418,
      kernelDrops: 0,
      truncatedFrames: 0,
      parserErrors: 0,
      bufferOverflows: 0,
      ipv4Fragments: 0,
      effectiveRcvBufBytes: 1048576,
      ignoreOutgoingKernelEnabled: true,
      pkttypeBpfFallbackActive: false,
      integrityFaultCode: null,
    },
    originTcpSummary: {
      port: 18790,
      handshakesCompleted: 82,
      reusedConnections: 4,
      zeroPriorRequestParkedConnections: 0,
      zeroPriorRequestReusedConnections: 0,
      zeroByteClosedConnections: 0,
      rstClosedConnections: 2,
      abortedBeforeHeadersConnections: 0,
      synGateActive: false,
      unusedDialObserved: false,
    },
    ...overrides,
  };
}

function buildIpv4Packet(proto, srcIp, dstIp, l4Payload) {
  const header = Buffer.alloc(20);
  header[0] = 0x45;
  header.writeUInt16BE(20 + l4Payload.length, 2);
  header[8] = 64;
  header[9] = proto;
  const src = srcIp.split(".").map(Number);
  const dst = dstIp.split(".").map(Number);
  for (let i = 0; i < 4; i++) {
    header[12 + i] = src[i];
    header[16 + i] = dst[i];
  }
  return Buffer.concat([header, l4Payload]);
}

function buildUdpIpv4(srcIp, srcPort, dstIp, dstPort, payloadBuf) {
  const udp = Buffer.alloc(8 + payloadBuf.length);
  udp.writeUInt16BE(srcPort, 0);
  udp.writeUInt16BE(dstPort, 2);
  udp.writeUInt16BE(8 + payloadBuf.length, 4);
  payloadBuf.copy(udp, 8);
  return buildIpv4Packet(17, srcIp, dstIp, udp);
}

function buildTcpIpv4(
  srcIp,
  srcPort,
  dstIp,
  dstPort,
  seq,
  flags,
  payloadBuf = Buffer.alloc(0),
  ack = 0,
) {
  const tcp = Buffer.alloc(20 + payloadBuf.length);
  tcp.writeUInt16BE(srcPort, 0);
  tcp.writeUInt16BE(dstPort, 2);
  tcp.writeUInt32BE(seq >>> 0, 4);
  tcp.writeUInt32BE(ack >>> 0, 8);
  tcp[12] = 0x50;
  tcp[13] = flags;
  tcp.writeUInt16BE(65535, 14);
  payloadBuf.copy(tcp, 20);
  return buildIpv4Packet(6, srcIp, dstIp, tcp);
}

function encodeFrame(
  kind,
  payload,
  { pkttype = 0, ethProto = 0, origLen } = {},
) {
  const header = Buffer.alloc(24);
  header.writeUInt8(kind, 0);
  header.writeUInt8(pkttype, 1);
  header.writeUInt16BE(ethProto, 2);
  header.writeUInt32BE(1, 4);
  header.writeBigUInt64BE(BigInt(Date.now()) * 1_000_000n, 8);
  header.writeUInt32BE(origLen ?? payload.length, 16);
  header.writeUInt32BE(payload.length, 20);
  return Buffer.concat([header, payload]);
}

function encodeReady(rcvBuf = 1048576, ignoreOut = 1, bpfFallback = 0) {
  const payload = Buffer.alloc(16);
  payload.writeUInt32BE(rcvBuf, 0);
  payload.writeUInt8(ignoreOut, 4);
  payload.writeUInt8(bpfFallback, 5);
  return encodeFrame(CAPTURE_FRAME_KIND.READY, payload);
}

function encodeStats(packets, drops) {
  const payload = Buffer.alloc(16);
  payload.writeBigUInt64BE(BigInt(packets), 0);
  payload.writeBigUInt64BE(BigInt(drops), 8);
  return encodeFrame(CAPTURE_FRAME_KIND.STATS_REPLY, payload);
}

function createFakeCaptureHelper() {
  const proc = new EventEmitter();
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.exitCode = null;
  proc.signalCode = null;
  proc.packets = 0;
  proc.drops = 0;

  proc.stdin.on("data", (chunk) => {
    for (const byte of chunk) {
      if (byte === 0x53) {
        proc.stdout.write(encodeStats(Math.max(1, proc.packets), proc.drops));
      } else if (byte === 0x51) {
        proc.exitCode = 0;
        proc.emit("exit", 0, null);
        proc.emit("close", 0, null);
      }
    }
  });

  proc.kill = (sig) => {
    proc.signalCode = sig;
    proc.emit("exit", null, sig);
    proc.emit("close", null, sig);
  };

  proc.emitPacket = (ipv4Buf) => {
    proc.packets += 1;
    proc.stdout.write(
      encodeFrame(CAPTURE_FRAME_KIND.PACKET, ipv4Buf, {
        pkttype: 0,
        ethProto: 0x0800,
      }),
    );
  };

  return proc;
}

function runBarrierInChild(opts) {
  return new Promise((resolvePromise) => {
    const script = `
      import { readNativeObservationBarrier } from ${JSON.stringify(RAW_HTTPS_URL)};
      try {
        const res = readNativeObservationBarrier(${JSON.stringify(opts)});
        process.stdout.write(JSON.stringify({ ok: true, res }));
      } catch (err) {
        process.stdout.write(JSON.stringify({ ok: false, message: err.message }));
      }
    `;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    child.on("close", (code) => {
      try {
        resolvePromise({ code, ...JSON.parse(out), stderr: err });
      } catch {
        resolvePromise({ code, ok: false, rawOut: out, stderr: err });
      }
    });
  });
}

function buildTrackAStateWithBarrier1() {
  const state = createObserverState({
    provenance: VALID_PROVENANCE,
    sentinelPort: 49200,
  });
  recordStats(state, {
    kernelPackets: 5,
    kernelDrops: 0,
    effectiveRcvBufBytes: 1048576,
    ignoreOutgoingKernelEnabled: true,
    pkttypeBpfFallbackActive: false,
  });
  const s0 = `GWRK051:${VALID_PROVENANCE.runId}:0:0123456789abcdef`;
  const p0 = buildUdpIpv4(
    "127.0.0.1",
    55000,
    "127.0.0.1",
    49200,
    Buffer.from(s0),
  );
  ingestPacket(state, {
    pkttype: 0,
    ethProto: 0x0800,
    monotonicNs: 1n,
    origLen: p0.length,
    payload: p0,
  });
  assert.equal(
    matchBarrier(state, { barrierSequence: 0, expectedPayload: s0 }).matched,
    true,
  );

  const req1 =
    "GET /oauth2/start?rd=%2F HTTP/1.1\r\nHost: gwrk.gforge.ai\r\nX-Forwarded-For: 172.31.51.11\r\n\r\n";
  for (const pkt of [
    buildTcpIpv4("127.0.0.1", 40001, "127.0.0.1", 4180, 100, 0x02),
    buildTcpIpv4(
      "127.0.0.1",
      4180,
      "127.0.0.1",
      40001,
      200,
      0x12,
      Buffer.alloc(0),
      101,
    ),
    buildTcpIpv4(
      "127.0.0.1",
      40001,
      "127.0.0.1",
      4180,
      101,
      0x10,
      Buffer.alloc(0),
      201,
    ),
    buildTcpIpv4(
      "127.0.0.1",
      40001,
      "127.0.0.1",
      4180,
      101,
      0x18,
      Buffer.from(req1),
      201,
    ),
  ]) {
    ingestPacket(state, {
      pkttype: 0,
      ethProto: 0x0800,
      monotonicNs: 2n,
      origLen: pkt.length,
      payload: pkt,
    });
  }
  const s1 = `GWRK051:${VALID_PROVENANCE.runId}:1:fedcba9876543210`;
  const p1 = buildUdpIpv4(
    "127.0.0.1",
    55000,
    "127.0.0.1",
    49200,
    Buffer.from(s1),
  );
  ingestPacket(state, {
    pkttype: 0,
    ethProto: 0x0800,
    monotonicNs: 3n,
    origLen: p1.length,
    payload: p1,
  });
  assert.equal(
    matchBarrier(state, { barrierSequence: 1, expectedPayload: s1 }).matched,
    true,
  );
  return state;
}

describe("Track B passive observer wiring and diagnostics", () => {
  test("bootstrap diagnostics stages and categories include observer_start and observer_startup_failed", () => {
    assert.ok(
      BOOTSTRAP_STAGES.includes("observer_start"),
      "BOOTSTRAP_STAGES must declare observer_start",
    );
    const observerIndex = BOOTSTRAP_STAGES.indexOf("observer_start");
    const gatewayStartupIndex = BOOTSTRAP_STAGES.indexOf("gateway_startup");
    assert.ok(
      observerIndex < gatewayStartupIndex,
      "observer_start must precede gateway_startup",
    );

    assert.ok(
      STATIC_CONSTRUCTION_CATEGORIES.includes("observer_startup_failed"),
      "STATIC_CONSTRUCTION_CATEGORIES must include observer_startup_failed",
    );
    assert.ok(
      STATIC_OPERATION_NAMES.includes("start_native_observer"),
      "STATIC_OPERATION_NAMES must include start_native_observer",
    );
    assert.ok(
      STATIC_OPERATION_NAMES.includes("observer_self_test"),
      "STATIC_OPERATION_NAMES must include observer_self_test",
    );
    assert.ok(
      STATIC_OPERATION_NAMES.includes("stop_native_observer"),
      "STATIC_OPERATION_NAMES must include stop_native_observer",
    );
  });

  test("Erratum 3: classifyBootstrapFailure classifies observer_start EPERM as observer_startup_failed", () => {
    const epermError = new Error("operation not permitted");
    epermError.code = "EPERM";

    const classified = classifyBootstrapFailure("observer_start", epermError, {
      operation: "start_native_observer",
      elapsedMs: 120,
    });

    assert.equal(
      classified.category,
      "observer_startup_failed",
      "EPERM in observer_start must classify as observer_startup_failed instead of filesystem_permission",
    );
    assert.equal(classified.failureClassification, "fixture_construction");
    assert.equal(classified.stage, "observer_start");
    assert.equal(classified.operation, "start_native_observer");
  });

  test("validateNativeObserverHealth enforces exact Appendix 1.4 schema and safe boundaries", () => {
    const valid = createValidHealth();
    assert.doesNotThrow(() =>
      validateNativeObserverHealth(valid, VALID_PROVENANCE),
    );

    assert.throws(
      () =>
        validateNativeObserverHealth(
          { ...valid, unexpectedField: "bad" },
          VALID_PROVENANCE,
        ),
      /unexpected top-level field/,
    );

    const { originTcpSummary: _, ...missingField } = valid;
    assert.throws(
      () => validateNativeObserverHealth(missingField, VALID_PROVENANCE),
      /missing required top-level field/,
    );

    assert.throws(
      () =>
        validateNativeObserverHealth(
          { ...valid, startupSelfTestPassed: false },
          VALID_PROVENANCE,
        ),
      /startup self test/,
    );

    assert.throws(
      () =>
        validateNativeObserverHealth(
          {
            ...valid,
            captureStats: { ...valid.captureStats, kernelDrops: 1 },
          },
          VALID_PROVENANCE,
        ),
      /kernelDrops/,
    );

    assert.throws(
      () =>
        validateNativeObserverHealth(
          {
            ...valid,
            captureStats: {
              ...valid.captureStats,
              integrityFaultCode: "KERNEL_DROP_OBSERVED",
            },
          },
          VALID_PROVENANCE,
        ),
      /sticky fault/,
    );

    assert.throws(
      () =>
        validateNativeObserverHealth(
          {
            ...valid,
            captureStats: {
              ...valid.captureStats,
              effectiveRcvBufBytes: 262144,
            },
          },
          VALID_PROVENANCE,
        ),
      /effectiveRcvBufBytes/,
    );

    assert.throws(
      () =>
        validateNativeObserverHealth(
          {
            ...valid,
            originTcpSummary: {
              ...valid.originTcpSummary,
              zeroPriorRequestReusedConnections: 1,
              unusedDialObserved: false,
            },
          },
          VALID_PROVENANCE,
        ),
      /unusedDialObserved/,
    );
  });

  test("readNativeObserverHealth verifies safe directory and file descriptors with O_NOFOLLOW", () => {
    const parent = mkdtempSync(join(tmpdir(), "gwrk-track-b-health-"));
    try {
      const goodDir = mkdtempSync(join(parent, "good-obs-"));
      chmodSync(goodDir, 0o700);

      const healthFile = join(goodDir, "native-observer-health.json");
      writeFileSync(healthFile, JSON.stringify(createValidHealth(), null, 2), {
        mode: 0o600,
      });
      chmodSync(healthFile, 0o600);

      const read = readNativeObserverHealth({
        observerDir: goodDir,
        healthPath: healthFile,
        expected: VALID_PROVENANCE,
        requireRootOwnership: false,
      });
      assert.equal(read.startupSelfTestPassed, true);
      assert.equal(read.sentinelPort, 49152);

      const linkFile = join(goodDir, "symlink-health.json");
      symlinkSync(healthFile, linkFile);
      assert.throws(
        () =>
          readNativeObserverHealth({
            observerDir: goodDir,
            healthPath: linkFile,
            expected: VALID_PROVENANCE,
            requireRootOwnership: false,
          }),
        /symlink|O_NOFOLLOW|ELOOP|regular/i,
      );

      chmodSync(healthFile, 0o644);
      assert.throws(
        () =>
          readNativeObserverHealth({
            observerDir: goodDir,
            healthPath: healthFile,
            expected: VALID_PROVENANCE,
            requireRootOwnership: false,
          }),
        /0600/,
      );
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  test("REVIEW-B-01: readNativeObservationBarrier fails closed on missing health sidecar, dangling symlink, and stale health sequence", () => {
    const dir = mkdtempSync(join(tmpdir(), "gwrk-track-b-r01-"));
    chmodSync(dir, 0o700);
    try {
      const state = buildTrackAStateWithBarrier1();
      const obsPath = join(dir, "native-observation.json");
      const barrierPath = join(dir, "native-observation-barrier.json");
      const healthPath = join(dir, "native-observer-health.json");
      writeFileSync(obsPath, JSON.stringify(buildV1Snapshot(state)), {
        mode: 0o600,
      });
      chmodSync(obsPath, 0o600);

      // Missing health file must fail closed
      assert.throws(
        () =>
          readNativeObservationBarrier({
            observerDir: dir,
            observationPath: obsPath,
            barrierPath,
            healthPath,
            expected: VALID_PROVENANCE,
            barrierSequence: 1,
            timeoutMs: 80,
            pollMs: 10,
            requireRootOwnership: false,
          }),
        /failed closed|ENOENT/i,
      );

      // Dangling symlink at healthPath must fail closed
      symlinkSync("/nonexistent/gwrk-dangling-health-target", healthPath);
      assert.throws(
        () =>
          readNativeObservationBarrier({
            observerDir: dir,
            observationPath: obsPath,
            barrierPath,
            healthPath,
            expected: VALID_PROVENANCE,
            barrierSequence: 1,
            timeoutMs: 80,
            pollMs: 10,
            requireRootOwnership: false,
          }),
        /failed closed|symlink/i,
      );
      rmSync(healthPath, { force: true });

      // Stale health sidecar (barrierSequence 0 < 1) must fail closed
      writeFileSync(
        healthPath,
        JSON.stringify({ ...buildHealthSidecar(state), barrierSequence: 0 }),
        { mode: 0o600 },
      );
      chmodSync(healthPath, 0o600);
      assert.throws(
        () =>
          readNativeObservationBarrier({
            observerDir: dir,
            observationPath: obsPath,
            barrierPath,
            healthPath,
            expected: VALID_PROVENANCE,
            barrierSequence: 1,
            timeoutMs: 80,
            pollMs: 10,
            requireRootOwnership: false,
          }),
        /barrierSequence|failed closed/i,
      );

      // Current valid health sidecar passes
      writeFileSync(healthPath, JSON.stringify(buildHealthSidecar(state)), {
        mode: 0o600,
      });
      chmodSync(healthPath, 0o600);
      const snapshot = readNativeObservationBarrier({
        observerDir: dir,
        observationPath: obsPath,
        barrierPath,
        healthPath,
        expected: VALID_PROVENANCE,
        barrierSequence: 1,
        timeoutMs: 100,
        pollMs: 10,
        requireRootOwnership: false,
      });
      assert.equal(snapshot.barrierSequence, 1);
      assert.equal(snapshot.proxyRequests.length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("REVIEW-B-02: production GWRK_051_OWNED_CONTROLLER=1 and non-boolean options cannot bypass root ownership", () => {
    const dir = mkdtempSync(join(tmpdir(), "gwrk-track-b-r02-own-"));
    chmodSync(dir, 0o700);
    const jsonFile = join(dir, "native-observer-health.json");
    writeFileSync(jsonFile, JSON.stringify(createValidHealth()), {
      mode: 0o600,
    });
    chmodSync(jsonFile, 0o600);

    const prev = process.env.GWRK_051_OWNED_CONTROLLER;
    try {
      process.env.GWRK_051_OWNED_CONTROLLER = "1";
      assert.throws(
        () => verifyObserverDirectory(dir, { requireRootOwnership: false }),
        /production|root ownership/i,
      );
      assert.throws(
        () => readSafeJson(jsonFile, { requireRootOwnership: false }),
        /production|root ownership/i,
      );
      assert.throws(
        () =>
          readNativeObserverHealth({
            observerDir: dir,
            healthPath: jsonFile,
            expected: VALID_PROVENANCE,
            requireRootOwnership: false,
          }),
        /production|root ownership/i,
      );
      assert.throws(
        () =>
          readNativeObservationBarrier({
            observerDir: dir,
            observationPath: join(dir, "native-observation.json"),
            barrierPath: join(dir, "native-observation-barrier.json"),
            healthPath: jsonFile,
            expected: VALID_PROVENANCE,
            barrierSequence: 1,
            timeoutMs: 50,
            pollMs: 10,
            requireRootOwnership: false,
          }),
        /production|root ownership/i,
      );

      Reflect.deleteProperty(process.env, "GWRK_051_OWNED_CONTROLLER");
      for (const badOpt of [null, 0, "", "false", Number.NaN]) {
        assert.throws(
          () => verifyObserverDirectory(dir, { requireRootOwnership: badOpt }),
          /boolean/i,
        );
        assert.throws(
          () => readSafeJson(jsonFile, { requireRootOwnership: badOpt }),
          /boolean/i,
        );
      }
    } finally {
      if (prev === undefined) {
        Reflect.deleteProperty(process.env, "GWRK_051_OWNED_CONTROLLER");
      } else {
        process.env.GWRK_051_OWNED_CONTROLLER = prev;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("REVIEW-B-02: barrier .next write refuses symlinks and readers enforce observerDir containment plus fstat checks", () => {
    const goodDir = mkdtempSync(join(tmpdir(), "gwrk-track-b-r02-good-"));
    const badDir = mkdtempSync(join(tmpdir(), "gwrk-track-b-r02-bad-"));
    chmodSync(goodDir, 0o700);
    chmodSync(badDir, 0o755);
    try {
      const state = buildTrackAStateWithBarrier1();
      const victimFile = join(badDir, "victim.txt");
      writeFileSync(victimFile, "ORIGINAL_SECRET_DATA", { mode: 0o644 });

      const barrierPath = join(goodDir, "native-observation-barrier.json");
      symlinkSync(victimFile, `${barrierPath}.next`);

      assert.throws(() =>
        readNativeObservationBarrier({
          observerDir: goodDir,
          observationPath: join(goodDir, "native-observation.json"),
          barrierPath,
          healthPath: join(goodDir, "native-observer-health.json"),
          expected: VALID_PROVENANCE,
          barrierSequence: 1,
          timeoutMs: 50,
          pollMs: 10,
          requireRootOwnership: false,
        }),
      );
      assert.equal(
        readFileSync(victimFile, "utf8"),
        "ORIGINAL_SECRET_DATA",
        ".next symlink target must never be overwritten",
      );
      rmSync(`${barrierPath}.next`, { force: true });

      // Escaped healthPath outside observerDir must fail closed
      const escapedHealth = join(badDir, "native-observer-health.json");
      writeFileSync(escapedHealth, JSON.stringify(buildHealthSidecar(state)), {
        mode: 0o600,
      });
      chmodSync(escapedHealth, 0o600);
      assert.throws(
        () =>
          readNativeObserverHealth({
            observerDir: goodDir,
            healthPath: escapedHealth,
            expected: VALID_PROVENANCE,
            requireRootOwnership: false,
          }),
        /observerDir/i,
      );

      // Escaped observationPath or barrierPath must fail closed
      assert.throws(
        () =>
          readNativeObservationBarrier({
            observerDir: goodDir,
            observationPath: join(badDir, "native-observation.json"),
            barrierPath,
            healthPath: join(goodDir, "native-observer-health.json"),
            expected: VALID_PROVENANCE,
            barrierSequence: 1,
            timeoutMs: 50,
            pollMs: 10,
            requireRootOwnership: false,
          }),
        /observerDir/i,
      );
      assert.throws(
        () =>
          readNativeObservationBarrier({
            observerDir: goodDir,
            observationPath: join(goodDir, "native-observation.json"),
            barrierPath: join(badDir, "native-observation-barrier.json"),
            healthPath: join(goodDir, "native-observer-health.json"),
            expected: VALID_PROVENANCE,
            barrierSequence: 1,
            timeoutMs: 50,
            pollMs: 10,
            requireRootOwnership: false,
          }),
        /observerDir/i,
      );

      // Verify readSafeJson performs fstat mode and UID rechecks on the open fd
      const rawHttpsSrc = readFileSync(
        resolve(FIXTURES_DIR, "raw-https.mjs"),
        "utf8",
      );
      assert.match(
        rawHttpsSrc,
        /fst\.mode\s*&\s*0o777/,
        "readSafeJson must recheck mode via fstatSync",
      );
      assert.match(
        rawHttpsSrc,
        /fst\.uid/,
        "readSafeJson must recheck uid via fstatSync",
      );
    } finally {
      rmSync(goodDir, { recursive: true, force: true });
      rmSync(badDir, { recursive: true, force: true });
    }
  });

  test("readNativeObservationBarrier latches sticky fault from health sidecar and refuses advance", () => {
    const parent = mkdtempSync(join(tmpdir(), "gwrk-track-b-barrier-"));
    try {
      const goodDir = mkdtempSync(join(parent, "obs-"));
      chmodSync(goodDir, 0o700);

      const obsPath = join(goodDir, "native-observation.json");
      const barrierPath = join(goodDir, "native-observation-barrier.json");
      const healthPath = join(goodDir, "native-observer-health.json");

      writeFileSync(
        obsPath,
        JSON.stringify({
          version: 1,
          provenance: {
            ...VALID_PROVENANCE,
            source: "passive_tcp",
            namespace: "owned_nested",
          },
          proxyRequests: [
            {
              sequence: 1,
              method: "GET",
              path: "/oauth2/start",
              querySha256: "a".repeat(64),
              cookieSha256: "b".repeat(64),
              peer: "127.0.0.1",
              forwardedFor: "172.31.51.11",
              forwardedForCount: 1,
              hasForwardedUri: false,
              hasForwardedMethod: false,
            },
          ],
          sequence: 1,
          barrierSequence: 1,
        }),
        { mode: 0o600 },
      );
      chmodSync(obsPath, 0o600);

      writeFileSync(
        healthPath,
        JSON.stringify(
          createValidHealth({
            captureStats: {
              kernelPackets: 10,
              kernelDrops: 1,
              truncatedFrames: 0,
              parserErrors: 0,
              bufferOverflows: 0,
              ipv4Fragments: 0,
              effectiveRcvBufBytes: 1048576,
              ignoreOutgoingKernelEnabled: true,
              pkttypeBpfFallbackActive: false,
              integrityFaultCode: "KERNEL_DROP_OBSERVED",
            },
          }),
        ),
        { mode: 0o600 },
      );
      chmodSync(healthPath, 0o600);

      assert.throws(
        () =>
          readNativeObservationBarrier({
            observerDir: goodDir,
            observationPath: obsPath,
            barrierPath,
            healthPath,
            expected: VALID_PROVENANCE,
            barrierSequence: 1,
            timeoutMs: 150,
            pollMs: 10,
            requireRootOwnership: false,
          }),
        /sticky fault|KERNEL_DROP_OBSERVED/,
      );
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  test("REVIEW-B-03: bootstrap observer lifecycle handles spawn error, early code-0 exit, stdout drain, and observed close before rmSync", async () => {
    // 1. Spawn error (ENOENT) must not crash uncaught and fails waitForReady immediately
    const spawnErrLifecycle = createObserverProcessLifecycle({
      pollMs: 10,
      readyTimeoutMs: 5000,
    });
    const badProc = spawn("/nonexistent/gwrk-observer-binary", [], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    badProc.stderr?.on("data", spawnErrLifecycle.onStderr);
    badProc.on("error", spawnErrLifecycle.onError);
    badProc.once("exit", spawnErrLifecycle.onExit);
    badProc.once("close", spawnErrLifecycle.onClose);

    const t0 = Date.now();
    await assert.rejects(
      () =>
        spawnErrLifecycle.waitForReady({
          readHealth: () => {
            throw new Error("not ready");
          },
        }),
      /ENOENT/,
    );
    assert.ok(
      Date.now() - t0 < 2000,
      "spawn error must fail fast without burning readyTimeoutMs",
    );
    const classifiedSpawn = classifyBootstrapFailure(
      "observer_start",
      spawnErrLifecycle.getExitError(),
      { operation: "start_native_observer", elapsedMs: 10 },
    );
    assert.equal(classifiedSpawn.category, "observer_startup_failed");
    assert.equal(classifiedSpawn.errorCode, "ENOENT");

    // 2. Early exit with code 0 must fail fast (not burn full timeout)
    const earlyZeroLifecycle = createObserverProcessLifecycle({
      pollMs: 10,
      readyTimeoutMs: 5000,
    });
    const zeroProc = spawn(process.execPath, ["-e", "process.exit(0)"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    zeroProc.stderr?.on("data", earlyZeroLifecycle.onStderr);
    zeroProc.on("error", earlyZeroLifecycle.onError);
    zeroProc.once("exit", earlyZeroLifecycle.onExit);
    zeroProc.once("close", earlyZeroLifecycle.onClose);

    const t1 = Date.now();
    await assert.rejects(
      () =>
        earlyZeroLifecycle.waitForReady({
          readHealth: () => {
            throw new Error("not ready");
          },
        }),
      /exited early with code 0/,
    );
    assert.ok(
      Date.now() - t1 < 2000,
      "early code-0 exit must fail fast without burning readyTimeoutMs",
    );
    await earlyZeroLifecycle.stop(zeroProc);
    assert.equal(earlyZeroLifecycle.isClosed(), true);

    // 3. Stop waits for observed close (not just exit) before directory removal and drains piped stdout
    const order = [];
    const fakeProc = new EventEmitter();
    fakeProc.stdout = new PassThrough();
    fakeProc.stderr = new PassThrough();
    fakeProc.kill = () => {
      order.push("sigterm");
      setTimeout(() => {
        order.push("exit");
        fakeProc.emit("exit", 0, null);
        setTimeout(() => {
          order.push("close");
          fakeProc.emit("close", 0, null);
        }, 40);
      }, 15);
    };
    const closeLifecycle = createObserverProcessLifecycle({
      termTimeoutMs: 1000,
      killTimeoutMs: 1000,
    });
    closeLifecycle.drainStream(fakeProc.stdout);
    fakeProc.stdout.write(Buffer.alloc(128 * 1024, 0x61));
    fakeProc.stderr.on("data", closeLifecycle.onStderr);
    fakeProc.on("error", closeLifecycle.onError);
    fakeProc.once("exit", closeLifecycle.onExit);
    fakeProc.once("close", closeLifecycle.onClose);

    await closeLifecycle.stop(fakeProc);
    order.push("rm_observer_dir");
    assert.deepEqual(order, ["sigterm", "exit", "close", "rm_observer_dir"]);

    // Verify bootstrap.mjs actually wires close, error, code-0 early exit, and ignores stdout
    const bootSrc = readFileSync(
      resolve(FIXTURES_DIR, "bootstrap.mjs"),
      "utf8",
    );
    assert.match(bootSrc, /observerProcess\.(?:on|once)\(\s*["']close["']/);
    assert.match(bootSrc, /observerProcess\.(?:on|once)\(\s*["']error["']/);
    assert.doesNotMatch(
      bootSrc,
      /if\s*\(\s*code\s*!==\s*0\s*&&\s*code\s*!==\s*null\s*\)/,
    );
    assert.match(
      bootSrc,
      /stdio:\s*\[\s*["']ignore["']\s*,\s*["']ignore["']\s*,\s*["']pipe["']\s*\]/,
    );
  });

  test("REVIEW-B-03: resolveComposeContainer fails closed on error, empty output, duplicates, or invalid name with static diagnostics", () => {
    const seenArgs = [];
    const okName = resolveComposeContainer((args) => {
      seenArgs.push(args);
      return "gwrk-hosted-pilot-traefik-1\n";
    }, "traefik");
    assert.equal(okName, "gwrk-hosted-pilot-traefik-1");
    assert.ok(
      seenArgs[0].includes(
        "label=com.docker.compose.project=gwrk-hosted-pilot",
      ),
    );
    assert.ok(seenArgs[0].includes("label=com.docker.compose.service=traefik"));

    // Empty output fails closed
    let emptyErr;
    try {
      resolveComposeContainer(() => "\n", "traefik");
    } catch (err) {
      emptyErr = err;
    }
    assert.ok(emptyErr, "empty docker ps result must throw");
    const emptyDiag = classifyBootstrapFailure("gateway_startup", emptyErr, {
      operation: "run_gateway_startup",
      elapsedMs: 25,
    });
    assert.equal(emptyDiag.failureClassification, "behavioral");
    assert.equal(emptyDiag.category, "gateway_startup_failed");

    // Multiple containers fail closed
    assert.throws(
      () =>
        resolveComposeContainer(
          () => "gwrk-hosted-pilot-proxy-1\ngwrk-hosted-pilot-proxy-2\n",
          "oauth2-proxy",
        ),
      /exactly one running compose container/,
    );

    // Invalid container name fails closed
    assert.throws(
      () => resolveComposeContainer(() => "../bad container!\n", "traefik"),
      /invalid compose container name/,
    );

    // Docker failure propagates (never swallowed)
    const dockerBoom = new Error("docker ps failed");
    dockerBoom.status = 1;
    assert.throws(
      () =>
        resolveComposeContainer(() => {
          throw dockerBoom;
        }, "oauth2-proxy"),
      /docker ps failed/,
    );

    // bootstrap.mjs must call resolveComposeContainer and never swallow docker ps with empty catch {}
    const bootSrc = readFileSync(
      resolve(FIXTURES_DIR, "bootstrap.mjs"),
      "utf8",
    );
    assert.match(
      bootSrc,
      /resolveComposeContainer\(\s*docker,\s*["']traefik["']\s*\)/,
    );
    assert.match(
      bootSrc,
      /resolveComposeContainer\(\s*docker,\s*["']oauth2-proxy["']\s*\)/,
    );
    assert.doesNotMatch(
      bootSrc,
      /traefikContainer\s*=\s*docker\([\s\S]*?\)\s*\.trim\(\)\s*\.split\("\\n"\)\[0\];\s*\}\s*catch\s*\{\}/,
    );
  });

  test("REVIEW-B-04: gateway-cases.mjs fails closed when GWRK_051_OBSERVER_DIR is unset", () => {
    const gwPath = resolve(FIXTURES_DIR, "gateway-cases.mjs");
    const gwSrc = readFileSync(gwPath, "utf8");
    assert.doesNotMatch(
      gwSrc,
      /process\.env\.GWRK_051_OBSERVER_DIR\s*\?\?\s*["']\/fixture\/observer["']/,
      "gateway-cases.mjs must not silently default unset GWRK_051_OBSERVER_DIR",
    );

    const res = spawnSync(process.execPath, [gwPath], {
      encoding: "utf8",
      timeout: 10_000,
      env: {
        PATH: process.env.PATH,
        GWRK_051_OWNED_CONTROLLER: "1",
        DOCKER_HOST: "unix:///var/run/docker.sock",
        GWRK_051_CLIENT_A: `gwrk-051-client-a-${VALID_RUN_ID}`,
        GWRK_051_CLIENT_B: `gwrk-051-client-b-${VALID_RUN_ID}`,
        GWRK_051_RUN_ID: VALID_RUN_ID,
        GWRK_051_PROXY_IMAGE_ID: VALID_PROVENANCE.proxyImageId,
        GWRK_051_TRAEFIK_IMAGE_ID: VALID_PROVENANCE.traefikImageId,
        GWRK_051_RUNTIME_RECEIPT_SHA256: VALID_PROVENANCE.runtimeReceiptSha256,
        GWRK_051_TRAEFIK_CONTAINER: "gwrk-hosted-pilot-traefik-1",
        GWRK_051_PROXY_CONTAINER: "gwrk-hosted-pilot-oauth2-proxy-1",
        GWRK_051_ORIGIN_CONTAINER: `gwrk-051-origin-${VALID_RUN_ID}`,
      },
    });
    assert.notEqual(
      res.status,
      0,
      "unset GWRK_051_OBSERVER_DIR must exit non-zero",
    );
    assert.match(
      res.stderr,
      /GWRK_051_OBSERVER_DIR must equal \/fixture\/observer/,
      `expected fail-closed env assertion, got stderr: ${res.stderr}`,
    );
  });

  test("REVIEW-B-04: Scenario B afterDrop requires minBarrierSequence and real reuse proof helper", () => {
    const unprovenHealth = createValidHealth({
      originTcpSummary: {
        port: 18790,
        handshakesCompleted: 5,
        reusedConnections: 2,
        zeroPriorRequestParkedConnections: 0,
        zeroPriorRequestReusedConnections: 0,
        zeroByteClosedConnections: 0,
        rstClosedConnections: 0,
        abortedBeforeHeadersConnections: 0,
        synGateActive: false,
        unusedDialObserved: false,
      },
    });
    assert.throws(
      () => assertScenarioBReuseProof(unprovenHealth),
      /zeroPriorRequestReusedConnections >= 1/,
    );

    const provenHealth = createValidHealth({
      originTcpSummary: {
        port: 18790,
        handshakesCompleted: 5,
        reusedConnections: 2,
        zeroPriorRequestParkedConnections: 1,
        zeroPriorRequestReusedConnections: 1,
        zeroByteClosedConnections: 0,
        rstClosedConnections: 0,
        abortedBeforeHeadersConnections: 0,
        synGateActive: false,
        unusedDialObserved: true,
      },
    });
    assert.doesNotThrow(() => assertScenarioBReuseProof(provenHealth));

    const gwSrc = readFileSync(
      resolve(FIXTURES_DIR, "gateway-cases.mjs"),
      "utf8",
    );
    const afterDropMatch = gwSrc.match(
      /afterDrop:\s*\(\)\s*=>\s*\{[\s\S]*?\n\s*\},/,
    );
    assert.ok(
      afterDropMatch,
      "gateway-cases.mjs must define Scenario B afterDrop",
    );
    assert.match(
      afterDropMatch[0],
      /minBarrierSequence:\s*barrierSequence/,
      "Scenario B afterDrop must pass minBarrierSequence: barrierSequence",
    );
    assert.match(
      afterDropMatch[0],
      /assertScenarioBReuseProof\(\s*health\s*\)/,
      "Scenario B afterDrop must call shared assertScenarioBReuseProof",
    );
  });

  test("REVIEW-B-04: run-native.mjs script manifest allowlist uses real wired helper and preserves zero capability additions", () => {
    assert.equal(
      isAllowedFixtureScriptName("native-observer-capture.py"),
      true,
    );
    assert.equal(isAllowedFixtureScriptName("run-native.mjs"), true);
    assert.equal(isAllowedFixtureScriptName("bootstrap.mjs"), true);
    assert.equal(isAllowedFixtureScriptName("bootstrap-observer.mjs"), true);
    assert.equal(isAllowedFixtureScriptName("gateway-cases.mjs"), true);

    assert.equal(isAllowedFixtureScriptName("other-helper.py"), false);
    assert.equal(isAllowedFixtureScriptName("malicious.sh"), false);
    assert.equal(isAllowedFixtureScriptName("binary.exe"), false);
    assert.equal(isAllowedFixtureScriptName("compiled.pyc"), false);
    assert.equal(isAllowedFixtureScriptName("../escape.mjs"), false);

    const runNativeSrc = readFileSync(
      resolve(FIXTURES_DIR, "run-native.mjs"),
      "utf8",
    );
    assert.match(
      runNativeSrc,
      /isAllowedFixtureScriptName/,
      "run-native.mjs must call shared isAllowedFixtureScriptName helper",
    );
    const capAdds = [
      ...runNativeSrc.matchAll(/"--cap-add",\s*\n?\s*"([^"]+)"/g),
    ].map((m) => m[1]);
    assert.deepEqual(
      capAdds,
      ["CHOWN", "DAC_OVERRIDE", "FOWNER"],
      "run-native.mjs must keep zero new capability additions",
    );
  });

  test("REVIEW-B-04: live Track A supervisor to Track B consumer roundtrip validates /oauth2/start, /oauth2/auth, Scenario B reuse, and sticky faults", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gwrk-track-b-roundtrip-"));
    chmodSync(dir, 0o700);
    let helper;
    let sentinelPort;
    const supervisor = createNativeObserverSupervisor({
      provenance: VALID_PROVENANCE,
      observerDir: dir,
      requireRootOwnership: false,
      pollIntervalMs: 10,
      createUdpSocket: () => {
        const sock = new EventEmitter();
        sock.bind = (_port, _host, cb) => {
          sentinelPort = 49210;
          setImmediate(cb);
        };
        sock.address = () => ({ port: sentinelPort });
        sock.send = (buf, port, host, cb) => {
          setImmediate(() => {
            helper.emitPacket(
              buildUdpIpv4("127.0.0.1", 55000, host, port, buf),
            );
            cb(null);
          });
        };
        sock.close = (cb) => cb?.();
        return sock;
      },
      spawnHelper: () => {
        helper = createFakeCaptureHelper();
        setImmediate(() => helper.stdout.write(encodeReady(1048576, 1, 0)));
        return helper;
      },
    });

    try {
      await supervisor.start();
      const startupHealth = readNativeObserverHealth({
        observerDir: dir,
        expected: VALID_PROVENANCE,
        requireRootOwnership: false,
      });
      assert.equal(startupHealth.startupSelfTestPassed, true);
      assert.equal(startupHealth.barrierSequence, 0);

      supervisor.startPolling();

      // Emit /oauth2/start plus parked zero-request connection to origin 18790
      const startReq = [
        "GET /oauth2/start?rd=%2Fapi%2Fauth%2Fsession HTTP/1.1",
        "Host: gwrk.gforge.ai",
        "X-Forwarded-For: 172.31.51.11",
        "",
        "",
      ].join("\r\n");
      helper.emitPacket(
        buildTcpIpv4("127.0.0.1", 40001, "127.0.0.1", 4180, 1000, 0x02),
      );
      helper.emitPacket(
        buildTcpIpv4(
          "127.0.0.1",
          4180,
          "127.0.0.1",
          40001,
          2000,
          0x12,
          Buffer.alloc(0),
          1001,
        ),
      );
      helper.emitPacket(
        buildTcpIpv4(
          "127.0.0.1",
          40001,
          "127.0.0.1",
          4180,
          1001,
          0x10,
          Buffer.alloc(0),
          2001,
        ),
      );
      helper.emitPacket(
        buildTcpIpv4(
          "127.0.0.1",
          40001,
          "127.0.0.1",
          4180,
          1001,
          0x18,
          Buffer.from(startReq),
          2001,
        ),
      );

      helper.emitPacket(
        buildTcpIpv4("127.0.0.1", 41001, "127.0.0.1", 18790, 5000, 0x02),
      );
      helper.emitPacket(
        buildTcpIpv4(
          "127.0.0.1",
          18790,
          "127.0.0.1",
          41001,
          6000,
          0x12,
          Buffer.alloc(0),
          5001,
        ),
      );
      helper.emitPacket(
        buildTcpIpv4(
          "127.0.0.1",
          41001,
          "127.0.0.1",
          18790,
          5001,
          0x10,
          Buffer.alloc(0),
          6001,
        ),
      );

      const b1 = await runBarrierInChild({
        observerDir: dir,
        observationPath: join(dir, "native-observation.json"),
        barrierPath: join(dir, "native-observation-barrier.json"),
        healthPath: join(dir, "native-observer-health.json"),
        expected: VALID_PROVENANCE,
        barrierSequence: 1,
        timeoutMs: 2000,
        pollMs: 10,
        requireRootOwnership: false,
      });
      assert.equal(b1.ok, true, `Barrier 1 failed: ${b1.message}`);
      assertProxyWireMatch(
        b1.res.proxyRequests,
        {
          method: "GET",
          path: "/oauth2/start",
          querySha256: createHash("sha256")
            .update("rd=%2Fapi%2Fauth%2Fsession")
            .digest("hex"),
          cookieSha256: createHash("sha256").update("").digest("hex"),
        },
        "172.31.51.11",
      );

      const h1 = readNativeObserverHealth({
        observerDir: dir,
        expected: VALID_PROVENANCE,
        minBarrierSequence: 1,
        requireRootOwnership: false,
      });
      assert.equal(h1.originTcpSummary.zeroPriorRequestParkedConnections, 1);
      assert.equal(h1.originTcpSummary.zeroPriorRequestReusedConnections, 0);
      assert.equal(h1.originTcpSummary.unusedDialObserved, false);

      // Reuse parked socket + emit ForwardAuth /oauth2/auth
      const originReq = "GET / HTTP/1.1\r\nHost: 127.0.0.1:18790\r\n\r\n";
      helper.emitPacket(
        buildTcpIpv4(
          "127.0.0.1",
          41001,
          "127.0.0.1",
          18790,
          5001,
          0x18,
          Buffer.from(originReq),
          6001,
        ),
      );

      const authReq = [
        "GET /oauth2/auth HTTP/1.1",
        "Host: gwrk.gforge.ai",
        "X-Forwarded-For: 172.31.51.11",
        "X-Forwarded-Uri: /api/auth/session",
        "X-Forwarded-Method: GET",
        "Cookie: __Host-gwrk_session=abc",
        "",
        "",
      ].join("\r\n");
      helper.emitPacket(
        buildTcpIpv4("127.0.0.1", 40002, "127.0.0.1", 4180, 3000, 0x02),
      );
      helper.emitPacket(
        buildTcpIpv4(
          "127.0.0.1",
          4180,
          "127.0.0.1",
          40002,
          4000,
          0x12,
          Buffer.alloc(0),
          3001,
        ),
      );
      helper.emitPacket(
        buildTcpIpv4(
          "127.0.0.1",
          40002,
          "127.0.0.1",
          4180,
          3001,
          0x10,
          Buffer.alloc(0),
          4001,
        ),
      );
      helper.emitPacket(
        buildTcpIpv4(
          "127.0.0.1",
          40002,
          "127.0.0.1",
          4180,
          3001,
          0x18,
          Buffer.from(authReq),
          4001,
        ),
      );

      const b2 = await runBarrierInChild({
        observerDir: dir,
        observationPath: join(dir, "native-observation.json"),
        barrierPath: join(dir, "native-observation-barrier.json"),
        healthPath: join(dir, "native-observer-health.json"),
        expected: VALID_PROVENANCE,
        barrierSequence: 2,
        timeoutMs: 2000,
        pollMs: 10,
        requireRootOwnership: false,
      });
      assert.equal(b2.ok, true, `Barrier 2 failed: ${b2.message}`);
      assert.equal(b2.res.proxyRequests[1].path, "/oauth2/auth");
      assert.equal(b2.res.proxyRequests[1].hasForwardedUri, true);
      assert.equal(b2.res.proxyRequests[1].hasForwardedMethod, true);

      const h2 = readNativeObserverHealth({
        observerDir: dir,
        expected: VALID_PROVENANCE,
        minBarrierSequence: 2,
        requireRootOwnership: false,
      });
      assert.equal(h2.originTcpSummary.zeroPriorRequestReusedConnections, 1);
      assert.equal(h2.originTcpSummary.unusedDialObserved, true);

      // Kernel drop sticky fault must fail barrier 3 closed
      helper.drops = 1;
      const b3 = await runBarrierInChild({
        observerDir: dir,
        observationPath: join(dir, "native-observation.json"),
        barrierPath: join(dir, "native-observation-barrier.json"),
        healthPath: join(dir, "native-observer-health.json"),
        expected: VALID_PROVENANCE,
        barrierSequence: 3,
        timeoutMs: 1500,
        pollMs: 10,
        requireRootOwnership: false,
      });
      assert.equal(b3.ok, false);
      assert.match(b3.message, /sticky fault.*KERNEL_DROP_OBSERVED/);
    } finally {
      await supervisor.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("observer selftest adapter isolation and lifecycle", () => {
    test("runs observer selftest before origin/issuer effects, writes typed result, and stops cleanly", async () => {
      const dir = mkdtempSync(join(tmpdir(), "selftest-pass-"));
      const observerDir = join(dir, "observer");
      const resultPath = join(dir, "observer-selftest-result.json");
      const filesWritten = new Map();
      const ops = [];

      const lifecycle = createObserverProcessLifecycle({
        readyTimeoutMs: 2000,
        pollMs: 10,
      });

      const mockProc = new EventEmitter();
      mockProc.stdout = new PassThrough();
      mockProc.stderr = new PassThrough();
      mockProc.kill = (sig) => {
        mockProc.emit("exit", 0, sig);
        mockProc.emit("close", 0, sig);
      };

      let spawnedArgs = null;
      let spawnedEnv = null;
      const fakeSpawn = (_cmd, args, opts) => {
        spawnedArgs = args;
        spawnedEnv = opts.env;
        return mockProc;
      };

      const validHealth = createValidHealth({
        startupSelfTestPassed: true,
        captureStats: {
          kernelPackets: 1,
          kernelDrops: 0,
          truncatedFrames: 0,
          parserErrors: 0,
          bufferOverflows: 0,
          ipv4Fragments: 0,
          effectiveRcvBufBytes: 1048576,
          ignoreOutgoingKernelEnabled: true,
          pkttypeBpfFallbackActive: false,
          integrityFaultCode: null,
        },
      });

      const selftest = await executeObserverSelftest({
        runId: VALID_RUN_ID,
        observerDir,
        proxyImageId: VALID_PROVENANCE.proxyImageId,
        traefikImageId: VALID_PROVENANCE.traefikImageId,
        runtimeReceiptSha256: VALID_PROVENANCE.runtimeReceiptSha256,
        observerLifecycle: lifecycle,
        spawnProcess: fakeSpawn,
        readHealth: () => validHealth,
        writeFile: (p, content) => filesWritten.set(p, content),
        resultPath,
        beginOperation: (op) => ops.push(op),
      });

      assert.equal(selftest.result.passed, true);
      assert.equal(selftest.result.runId, VALID_RUN_ID);
      assert.equal(selftest.result.effectiveRcvBufBytes, 1048576);
      assert.equal(selftest.result.ignoreOutgoingKernelEnabled, true);
      assert.deepEqual(ops, ["start_native_observer", "observer_self_test"]);
      assert.ok(spawnedArgs.includes("--max-old-space-size=64"));
      assert.equal(spawnedEnv.GWRK_051_RUN_ID, VALID_RUN_ID);
      assert.equal(spawnedEnv.GWRK_051_OBSERVER_DIR, observerDir);
      assert.ok(filesWritten.has(resultPath));

      await lifecycle.stop(mockProc);
      assert.equal(lifecycle.isClosed(), true);
      assert.equal(lifecycle.isExited(), true);
      rmSync(dir, { recursive: true, force: true });
    });

    test("startup failure without NET_RAW classifies as observer_startup_failed with clean stop", async () => {
      const dir = mkdtempSync(join(tmpdir(), "selftest-fail-"));
      const observerDir = join(dir, "observer");
      const resultPath = join(dir, "observer-selftest-result.json");
      const filesWritten = new Map();

      const lifecycle = createObserverProcessLifecycle({
        readyTimeoutMs: 2000,
        pollMs: 10,
      });

      const mockProc = new EventEmitter();
      mockProc.stdout = new PassThrough();
      mockProc.stderr = new PassThrough();
      mockProc.kill = (sig) => {
        mockProc.emit("exit", 1, sig);
        mockProc.emit("close", 1, sig);
      };

      const fakeSpawn = () => {
        queueMicrotask(() => {
          mockProc.stderr.write(
            "PermissionError: [Errno 1] Operation not permitted\n",
          );
          mockProc.emit("exit", 1, null);
          mockProc.emit("close", 1, null);
        });
        return mockProc;
      };

      let caughtError = null;
      try {
        await executeObserverSelftest({
          runId: VALID_RUN_ID,
          observerDir,
          proxyImageId: VALID_PROVENANCE.proxyImageId,
          traefikImageId: VALID_PROVENANCE.traefikImageId,
          runtimeReceiptSha256: VALID_PROVENANCE.runtimeReceiptSha256,
          observerLifecycle: lifecycle,
          spawnProcess: fakeSpawn,
          readHealth: () => {
            throw new Error("health not ready");
          },
          writeFile: (p, content) => filesWritten.set(p, content),
          resultPath,
        });
      } catch (err) {
        caughtError = err;
      }

      assert.ok(caughtError);
      assert.match(
        caughtError.message,
        /native observer exited early with code 1/,
      );
      assert.equal(filesWritten.has(resultPath), false);

      const diagnostic = classifyBootstrapFailure(
        "observer_start",
        caughtError,
        {
          operation: "observer_self_test",
          elapsedMs: 45,
        },
      );
      assert.equal(diagnostic.stage, "observer_start");
      assert.equal(diagnostic.category, "observer_startup_failed");
      assert.equal(diagnostic.failureClassification, "fixture_construction");
      assert.equal(
        diagnostic.detail,
        "Native passive observer failed to start or pass self test",
      );

      await lifecycle.stop(mockProc);
      assert.equal(lifecycle.isClosed(), true);
      rmSync(dir, { recursive: true, force: true });
    });
  });
});
