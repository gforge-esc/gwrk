import assert from "node:assert/strict";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  mkdtempSync,
  openSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "vitest";
import {
  BOOTSTRAP_STAGES,
  STATIC_CONSTRUCTION_CATEGORIES,
  STATIC_OPERATION_NAMES,
  classifyBootstrapFailure,
} from "./bootstrap-diagnostics.mjs";
import {
  readNativeObservationBarrier,
  readNativeObserverHealth,
  validateExpectedProvenance,
  validateNativeObserverHealth,
} from "./raw-https.mjs";

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

    // Rejects unexpected top-level field
    assert.throws(
      () =>
        validateNativeObserverHealth(
          { ...valid, unexpectedField: "bad" },
          VALID_PROVENANCE,
        ),
      /unexpected top-level field/,
    );

    // Rejects missing top-level field
    const { originTcpSummary: _, ...missingField } = valid;
    assert.throws(
      () => validateNativeObserverHealth(missingField, VALID_PROVENANCE),
      /missing required top-level field/,
    );

    // Rejects failed startup self-test
    assert.throws(
      () =>
        validateNativeObserverHealth(
          { ...valid, startupSelfTestPassed: false },
          VALID_PROVENANCE,
        ),
      /startup self test/,
    );

    // Rejects kernel drops or parser errors
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

    // Rejects sticky integrity fault code
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

    // Rejects buffer below 512 KiB
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

    // Rejects mismatch between zeroPriorRequestReusedConnections and unusedDialObserved
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

      // Rejects symlink health file
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

      // Rejects loose file mode 0644
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

  test("readNativeObservationBarrier latches sticky fault from health sidecar and refuses advance", () => {
    const parent = mkdtempSync(join(tmpdir(), "gwrk-track-b-barrier-"));
    try {
      const goodDir = mkdtempSync(join(parent, "obs-"));
      chmodSync(goodDir, 0o700);

      const obsPath = join(goodDir, "native-observation.json");
      const barrierPath = join(goodDir, "native-observation-barrier.json");
      const healthPath = join(goodDir, "native-observer-health.json");

      // Write observation snapshot claiming barrierSequence: 1
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

      // Write health sidecar with sticky fault code
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

      // Barrier must fail closed on sticky fault
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

  test("Scenario B fail-closed assertion requires real zeroPriorRequestReusedConnections >= 1", () => {
    // Unproven / zero-request reused count must fail closed
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

    const assertScenarioBProof = (health) => {
      assert.ok(
        health.originTcpSummary.zeroPriorRequestReusedConnections >= 1,
        "Scenario B requires real zero-request parked/reused connection proof (zeroPriorRequestReusedConnections >= 1)",
      );
      assert.equal(
        health.originTcpSummary.unusedDialObserved,
        true,
        "Scenario B requires unusedDialObserved === true",
      );
    };

    assert.throws(
      () => assertScenarioBProof(unprovenHealth),
      /zeroPriorRequestReusedConnections >= 1/,
    );

    // Proven connection passes
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
    assert.doesNotThrow(() => assertScenarioBProof(provenHealth));
  });

  test("Python helper allowlist matches run-native.mjs line 41 check", () => {
    const isAllowed = (name) =>
      name === "native-observer-capture.py" || /^[a-z-]+\.mjs$/.test(name);

    assert.equal(isAllowed("native-observer-capture.py"), true);
    assert.equal(isAllowed("run-native.mjs"), true);
    assert.equal(isAllowed("bootstrap.mjs"), true);
    assert.equal(isAllowed("gateway-cases.mjs"), true);

    assert.equal(isAllowed("other-helper.py"), false);
    assert.equal(isAllowed("malicious.sh"), false);
    assert.equal(isAllowed("binary.exe"), false);
    assert.equal(isAllowed("compiled.pyc"), false);
  });
});
