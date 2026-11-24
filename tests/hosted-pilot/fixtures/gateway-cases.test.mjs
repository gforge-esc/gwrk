import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createTlsServer } from "node:tls";
import fastify from "fastify";
import { test } from "vitest";
import { createRateAdmission } from "../../../src/adapters/auth/rate-admission.ts";
import * as rawHttpsHelpers from "./raw-https.mjs";
import {
  assertAdmissionWire,
  parseFixtureControl,
  validateNativeObservation,
} from "./raw-https.mjs";

const wire = {
  path: "/",
  method: "GET",
  peer: "127.0.0.1",
  hasQuery: false,
  hasBody: false,
  hasAuthorization: false,
  hasCookie: false,
  forwardedUriIsRoot: true,
  forwardedMethodIsGet: true,
  forwardedFor: "172.31.51.11",
  forwardedForCount: 1,
};
const expected = {
  runId: "a".repeat(24),
  proxyImageId: `sha256:${"b".repeat(64)}`,
  traefikImageId: `sha256:${"c".repeat(64)}`,
  runtimeReceiptSha256: "d".repeat(64),
};
const observation = () => ({
  version: 1,
  provenance: { ...expected, source: "passive_tcp", namespace: "owned_nested" },
  proxyRequests: [],
  sequence: 1,
});

test("root-wire checks require actual nonempty observations and inspect every root event", () => {
  assert.throws(() => assertAdmissionWire([]));
  assert.doesNotThrow(() => assertAdmissionWire([wire]));
  for (const mutation of [
    { forwardedUriIsRoot: false },
    { hasQuery: true },
    { hasBody: true },
    { hasAuthorization: true },
    { hasCookie: true },
    { forwardedFor: "172.31.51.11, 172.31.51.12" },
    { forwardedForCount: 2 },
    { peer: "172.31.51.11" },
    { method: "POST" },
  ])
    assert.throws(() => assertAdmissionWire([wire, { ...wire, ...mutation }]));
});

test("private controls are bounded, monotonic inputs with no request authority", () => {
  assert.deepEqual(
    parseFixtureControl({
      sequence: 1,
      advanceRateMs: 120001,
      prefillLoginBuckets: 998,
      loginFault: "none",
    }),
    {
      sequence: 1,
      advanceRateMs: 120001,
      prefillLoginBuckets: 998,
      loginFault: "none",
    },
  );
  for (const value of [
    null,
    {},
    { sequence: 0 },
    { sequence: 1, advanceRateMs: -1 },
    { sequence: 1, advanceRateMs: 120002 },
    { sequence: 1, prefillLoginBuckets: 1001 },
    { sequence: 1, loginFault: "allow" },
    { sequence: 1, trustedIp: "spoof" },
    { sequence: 1, apiKey: "secret" },
  ])
    assert.throws(() => parseFixtureControl(value));
});

test("native wire receipts require exact runtime provenance, bounded events and no raw query/secrets", () => {
  assert.doesNotThrow(() =>
    validateNativeObservation(
      { ...observation(), proxyRequests: [validProxyEvent] },
      expected,
    ),
  );
  for (const mutation of [
    {},
    {
      ...observation(),
      proxyRequests: [validProxyEvent],
      provenance: { ...observation().provenance, runId: "e".repeat(24) },
    },
    { ...observation(), proxyRequests: [validProxyEvent], sequence: -1 },
    { ...observation(), proxyRequests: [{ sequence: 1, query: "raw-secret" }] },
  ])
    assert.throws(() => validateNativeObservation(mutation, expected));
});

test("private controls validate boolean flags and reject non-boolean fault overrides", () => {
  assert.deepEqual(
    parseFixtureControl({
      sequence: 2,
      logoutFault: true,
      dropNextCommitted: false,
    }),
    { sequence: 2, logoutFault: true, dropNextCommitted: false },
  );
  assert.throws(() => parseFixtureControl({ sequence: 2, logoutFault: "yes" }));
  assert.throws(() =>
    parseFixtureControl({ sequence: 2, dropNextCommitted: 1 }),
  );
  assert.throws(() =>
    parseFixtureControl({ sequence: 2, unknownControl: true }),
  );
});

test("native wire receipts enforce strict path allowlist and reject raw secrets or unordered sequences", () => {
  const base = observation();
  assert.throws(() =>
    validateNativeObservation(
      {
        ...base,
        proxyRequests: [
          {
            sequence: 1,
            method: "GET",
            path: "/admin",
            querySha256: "a".repeat(64),
            cookieSha256: "b".repeat(64),
            peer: "127.0.0.1",
            forwardedFor: "172.31.51.11",
            forwardedForCount: 1,
            hasForwardedUri: false,
            hasForwardedMethod: false,
          },
        ],
      },
      expected,
    ),
  );
  assert.throws(() =>
    validateNativeObservation(
      {
        ...base,
        proxyRequests: [
          {
            sequence: 2,
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
      },
      expected,
    ),
  );
});

test("regression: ForwardAuth admission wire rejects non-GET methods (preserveRequestMethod=false)", () => {
  assert.throws(() => assertAdmissionWire([{ ...wire, method: "HEAD" }]));
});

test("regression: native observation validation fails closed on empty proxyRequests", () => {
  assert.throws(() => validateNativeObservation(observation(), expected));
});

test("regression: native observation validation rejects empty or malformed expected provenance", () => {
  const validProxyRequest = {
    sequence: 1,
    method: "GET",
    path: "/oauth2/callback",
    querySha256: "a".repeat(64),
    cookieSha256: "b".repeat(64),
    peer: "127.0.0.1",
    forwardedFor: "172.31.51.11",
    forwardedForCount: 1,
    hasForwardedUri: false,
    hasForwardedMethod: false,
  };
  const emptyExpected = {
    runId: "",
    proxyImageId: "",
    traefikImageId: "",
    runtimeReceiptSha256: "",
  };
  assert.throws(() =>
    validateNativeObservation(
      {
        version: 1,
        provenance: {
          ...emptyExpected,
          source: "passive_tcp",
          namespace: "owned_nested",
        },
        proxyRequests: [validProxyRequest],
        sequence: 1,
      },
      emptyExpected,
    ),
  );
});

const validProxyEvent = {
  sequence: 1,
  method: "GET",
  path: "/oauth2/callback",
  querySha256: createHash("sha256").update("code=abc&state=xyz").digest("hex"),
  cookieSha256: createHash("sha256")
    .update("__Host-gwrk_session=secret")
    .digest("hex"),
  peer: "127.0.0.1",
  forwardedFor: "172.31.51.11",
  forwardedForCount: 1,
  hasForwardedUri: false,
  hasForwardedMethod: false,
};

test("regression (F-01): observation barrier fails closed when absent or unacknowledged and validates requestProof plus deltas", () => {
  const dir = mkdtempSync(join(tmpdir(), "gwrk-obs-"));
  try {
    assert.equal(
      typeof rawHttpsHelpers.readNativeObservationBarrier,
      "function",
    );
    assert.throws(() =>
      rawHttpsHelpers.readNativeObservationBarrier({
        observationPath: join(dir, "native-observation.json"),
        barrierPath: join(dir, "native-observation-barrier.json"),
        expected,
        barrierSequence: 1,
        timeoutMs: 100,
        pollMs: 10,
      }),
    );
    const obsPath = join(dir, "native-observation.json");
    writeFileSync(
      obsPath,
      JSON.stringify({
        version: 1,
        provenance: {
          ...expected,
          source: "passive_tcp",
          namespace: "owned_nested",
        },
        proxyRequests: [validProxyEvent],
        sequence: 1,
        barrierSequence: 1,
      }),
    );
    const read = rawHttpsHelpers.readNativeObservationBarrier({
      observationPath: obsPath,
      barrierPath: join(dir, "native-observation-barrier.json"),
      expected,
      barrierSequence: 1,
      timeoutMs: 100,
      pollMs: 10,
    });
    assert.equal(read.proxyRequests.length, 1);
    assert.throws(() =>
      rawHttpsHelpers.readNativeObservationBarrier({
        observationPath: obsPath,
        barrierPath: join(dir, "native-observation-barrier.json"),
        expected,
        barrierSequence: 2,
        timeoutMs: 50,
        pollMs: 10,
      }),
    );
    assert.doesNotThrow(() =>
      rawHttpsHelpers.assertProxyWireMatch(
        [validProxyEvent],
        {
          method: "GET",
          path: "/oauth2/callback",
          querySha256: validProxyEvent.querySha256,
          cookieSha256: validProxyEvent.cookieSha256,
        },
        "172.31.51.11",
      ),
    );
    assert.throws(() =>
      rawHttpsHelpers.assertProxyWireMatch(
        [{ ...validProxyEvent, hasForwardedUri: true }],
        {
          method: "GET",
          path: "/oauth2/callback",
          querySha256: validProxyEvent.querySha256,
          cookieSha256: validProxyEvent.cookieSha256,
        },
        "172.31.51.11",
      ),
    );
    assert.throws(() =>
      rawHttpsHelpers.assertProxyWireMatch(
        [validProxyEvent],
        {
          method: "GET",
          path: "/oauth2/callback",
          querySha256: validProxyEvent.querySha256,
          cookieSha256: validProxyEvent.cookieSha256,
        },
        "172.31.51.12",
      ),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("regression (F-01/F-09): internal /oauth2/sign_out observation enforces zero XFF while external proxy routes require one real peer", () => {
  const internalSignOut = {
    sequence: 1,
    method: "GET",
    path: "/oauth2/sign_out",
    querySha256: createHash("sha256").update("").digest("hex"),
    cookieSha256: "b".repeat(64),
    peer: "127.0.0.1",
    forwardedFor: "",
    forwardedForCount: 0,
    hasForwardedUri: false,
    hasForwardedMethod: false,
  };
  assert.doesNotThrow(() =>
    validateNativeObservation(
      {
        version: 1,
        provenance: {
          ...expected,
          source: "passive_tcp",
          namespace: "owned_nested",
        },
        proxyRequests: [internalSignOut],
        sequence: 1,
      },
      expected,
    ),
  );
  assert.throws(() =>
    validateNativeObservation(
      {
        version: 1,
        provenance: {
          ...expected,
          source: "passive_tcp",
          namespace: "owned_nested",
        },
        proxyRequests: [
          {
            ...internalSignOut,
            forwardedFor: "172.31.51.11",
            forwardedForCount: 1,
          },
        ],
        sequence: 1,
      },
      expected,
    ),
  );
});

test("regression (F-02): ForwardAuth root selection excludes direct root controls and keeps malformed admission events", () => {
  assert.equal(typeof rawHttpsHelpers.selectForwardAuthRootEvents, "function");
  const requests = [
    {
      ...wire,
      hasQuery: true,
      forwardedUriIsRoot: false,
      forwardedMethodIsGet: false,
    },
    {
      ...wire,
      method: "HEAD",
      forwardedUriIsRoot: false,
      forwardedMethodIsGet: false,
    },
    { ...wire },
  ];
  const selected = rawHttpsHelpers.selectForwardAuthRootEvents(requests, 2);
  assert.equal(selected.length, 1);
  assert.doesNotThrow(() => assertAdmissionWire(selected));
  assert.throws(() =>
    rawHttpsHelpers.selectForwardAuthRootEvents(requests.slice(0, 2), 2),
  );
  const withMalformed = [...requests, { ...wire, forwardedUriIsRoot: false }];
  const selectedMalformed = rawHttpsHelpers.selectForwardAuthRootEvents(
    withMalformed,
    2,
  );
  assert.equal(selectedMalformed.length, 2);
  assert.throws(() => assertAdmissionWire(selectedMalformed));
});

test("regression (F-04): same-owner 1000-bucket capacity math mixes login and two-bucket API transition without eviction", () => {
  let now = 1_000_000;
  const owner = createRateAdmission({ clock: { nowMs: () => now } });
  try {
    for (let i = 0; i < 997; i++) {
      assert.equal(
        owner.consumeLogin({ trustedIp: `198.18.${i >>> 8}.${i & 255}` })
          .allowed,
        true,
      );
    }
    assert.equal(
      owner.consumeLogin({ trustedIp: "172.31.51.11" }).allowed,
      true,
    );
    const reserved = owner.reserveApi({ trustedIp: "172.31.51.12" });
    assert.equal(reserved.allowed, true);
    assert.equal(
      owner.completeVerified({
        reservation: reserved.reservation,
        credential: { authMethod: "api_key", credentialId: "fixture-operator" },
      }).allowed,
      true,
    );
    const capApi = owner.reserveApi({ trustedIp: "172.31.51.11" });
    assert.deepEqual(capApi, { allowed: false, reason: "capacity" });
    const capLogin = owner.consumeLogin({ trustedIp: "172.31.51.12" });
    assert.deepEqual(capLogin, { allowed: false, reason: "capacity" });
    assert.equal(
      owner.consumeLogin({ trustedIp: "172.31.51.11" }).allowed,
      true,
    );
    const existingApi = owner.reserveApi({ trustedIp: "172.31.51.12" });
    assert.equal(existingApi.allowed, true);
    assert.equal(
      owner.completeVerified({
        reservation: existingApi.reservation,
        credential: { authMethod: "api_key", credentialId: "fixture-operator" },
      }).allowed,
      true,
    );
    now += 120_001;
    owner.expire();
    assert.equal(
      owner.consumeLogin({ trustedIp: "172.31.51.12" }).allowed,
      true,
    );
  } finally {
    owner.close();
  }
});

test("regression (F-05): Fastify login fault hook intercepts oversized and timeout before headers are sent", async () => {
  assert.equal(typeof rawHttpsHelpers.wrapLoginFaultResponse, "function");
  let activeFault = "oversized";
  let cancelledCount = 0;
  const app = fastify({ logger: false });
  app.get("/", async (_req, reply) =>
    reply.type("text/html; charset=utf-8").send("<!doctype html>ok"),
  );
  app.get("/denied", async (_req, reply) =>
    reply.code(429).send({ ok: false, code: "RATE_LIMIT_EXCEEDED" }),
  );
  await app.listen({ host: "127.0.0.1", port: 0 });
  app.server.prependListener("request", (incoming, outgoing) => {
    if (["oversized", "timeout"].includes(activeFault)) {
      rawHttpsHelpers.wrapLoginFaultResponse(incoming, outgoing, activeFault, {
        timeoutMs: 120,
        onCancelled: () => {
          cancelledCount++;
        },
      });
    }
  });
  try {
    const port = app.server.address().port;
    const oversized = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(oversized.status, 200);
    assert.equal(oversized.headers.get("content-length"), "4097");
    const overBody = await oversized.text();
    assert.equal(overBody.length, 4097);

    const denied = await fetch(`http://127.0.0.1:${port}/denied`);
    assert.equal(denied.status, 429);

    activeFault = "timeout";
    const t0 = Date.now();
    const delayed = await fetch(`http://127.0.0.1:${port}/`);
    const elapsed = Date.now() - t0;
    assert.equal(delayed.status, 200);
    assert.ok(
      elapsed >= 100,
      `expected held timeout response, got ${elapsed}ms`,
    );

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    await assert.rejects(() =>
      fetch(`http://127.0.0.1:${port}/`, { signal: controller.signal }),
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.ok(cancelledCount > 0, "expected in-flight cancellation callback");
  } finally {
    await app.close();
  }
});

test("regression (F-09): CSRF issuance and logout clearing cookie helpers enforce exact attributes and separate headers", () => {
  assert.equal(typeof rawHttpsHelpers.assertCsrfCookieHeader, "function");
  assert.equal(typeof rawHttpsHelpers.assertLogoutClearingCookies, "function");
  const sessionExpiresMs = Date.now() + 300_000;
  const validExpiry = new Date(
    Math.floor((sessionExpiresMs - 1000) / 1000) * 1000,
  ).toUTCString();
  assert.doesNotThrow(() =>
    rawHttpsHelpers.assertCsrfCookieHeader(
      [
        `__Host-gwrk_csrf=secretval; Path=/; Expires=${validExpiry}; HttpOnly; Secure; SameSite=Lax`,
      ],
      sessionExpiresMs,
    ),
  );
  for (const bad of [
    `__Host-gwrk_csrf=secretval; Path=/; Max-Age=300; Expires=${validExpiry}; HttpOnly; Secure; SameSite=Lax`,
    `__Host-gwrk_csrf=secretval; Path=/; Expires=${new Date(sessionExpiresMs + 60_000).toUTCString()}; HttpOnly; Secure; SameSite=Lax`,
    `__Host-gwrk_csrf=secretval; Domain=gwrk.gforge.ai; Path=/; Expires=${validExpiry}; HttpOnly; Secure; SameSite=Lax`,
    `__Host-gwrk_csrf=secretval; Path=/; Expires=${validExpiry}; Secure; SameSite=Lax`,
  ]) {
    assert.throws(() =>
      rawHttpsHelpers.assertCsrfCookieHeader([bad], sessionExpiresMs),
    );
  }
  assert.doesNotThrow(() =>
    rawHttpsHelpers.assertLogoutClearingCookies(
      [
        "__Host-gwrk_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax",
        "__Host-gwrk_csrf=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax",
      ],
      ["__Host-gwrk_session"],
    ),
  );
  assert.throws(() =>
    rawHttpsHelpers.assertLogoutClearingCookies(
      [
        "__Host-gwrk_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure, __Host-gwrk_csrf=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax",
      ],
      ["__Host-gwrk_session"],
    ),
  );
});

test("regression (F-10): strict SNI discriminates server TLS alert from local cert verification and closed port probe detects ECONNREFUSED", async () => {
  assert.equal(typeof rawHttpsHelpers.assertStrictSniRejection, "function");
  assert.equal(typeof rawHttpsHelpers.probeTcpClosed, "function");
  assert.throws(() =>
    rawHttpsHelpers.assertStrictSniRejection({
      failed: true,
      errorCode: "ERR_TLS_CERT_ALTNAME_INVALID",
      tlsAlert: false,
      peerCertificatePresent: true,
      localCertVerificationFailure: true,
    }),
  );
  assert.throws(() =>
    rawHttpsHelpers.assertStrictSniRejection({
      failed: true,
      errorCode: "DEPTH_ZERO_SELF_SIGNED_CERT",
      tlsAlert: false,
      peerCertificatePresent: true,
      localCertVerificationFailure: true,
    }),
  );
  assert.doesNotThrow(() =>
    rawHttpsHelpers.assertStrictSniRejection({
      failed: true,
      errorCode: "ERR_SSL_TLSV1_UNRECOGNIZED_NAME",
      tlsAlert: true,
      peerCertificatePresent: false,
      localCertVerificationFailure: false,
    }),
  );

  // Real loopback TCP closed vs open probe
  const openServer = createNetServer();
  await new Promise((resolve) => openServer.listen(0, "127.0.0.1", resolve));
  const openPort = openServer.address().port;
  const openProbe = await rawHttpsHelpers.probeTcpClosed({
    target: "127.0.0.1",
    port: openPort,
    timeoutMs: 1000,
  });
  assert.equal(openProbe.closed, false);
  await new Promise((resolve) => openServer.close(resolve));
  const closedProbe = await rawHttpsHelpers.probeTcpClosed({
    target: "127.0.0.1",
    port: openPort,
    timeoutMs: 1000,
  });
  assert.equal(closedProbe.closed, true);
  assert.equal(closedProbe.errorCode, "ECONNREFUSED");

  // Real TLS strict-SNI server rejecting handshake with TLS alert and zero cert
  const strictTls = createTlsServer({
    SNICallback: (_servername, cb) => cb(null, null),
  });
  await new Promise((resolve) => strictTls.listen(0, "127.0.0.1", resolve));
  try {
    const tlsPort = strictTls.address().port;
    let caught;
    try {
      await rawHttpsHelpers.rawHttps({
        ca: "",
        target: "127.0.0.1",
        port: tlsPort,
        path: "/",
        servername: "unknown.example.invalid",
        timeoutMs: 2000,
      });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, "strict SNI handshake must reject");
    assert.doesNotThrow(() =>
      rawHttpsHelpers.assertStrictSniRejection(
        rawHttpsHelpers.classifyTlsError(caught),
      ),
    );
  } finally {
    await new Promise((resolve) => strictTls.close(resolve));
  }

  // Real non-strict TLS server offering a self-signed fallback cert MUST fail assertStrictSniRejection
  const certDir = mkdtempSync(join(tmpdir(), "gwrk-tls-"));
  try {
    const keyPath = join(certDir, "key.pem");
    const certPath = join(certDir, "cert.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-days",
        "1",
        "-subj",
        "/CN=gwrk.gforge.ai",
      ],
      { stdio: "pipe", timeout: 10_000 },
    );
    const nonStrictTls = createTlsServer({
      key: readFileSync(keyPath),
      cert: readFileSync(certPath),
    });
    await new Promise((resolve) =>
      nonStrictTls.listen(0, "127.0.0.1", resolve),
    );
    try {
      const port = nonStrictTls.address().port;
      let caught;
      try {
        await rawHttpsHelpers.rawHttps({
          ca: readFileSync(certPath),
          target: "127.0.0.1",
          port,
          path: "/",
          servername: "unknown.example.invalid",
          timeoutMs: 2000,
        });
      } catch (error) {
        caught = error;
      }
      assert.ok(
        caught,
        "client rejectUnauthorized must reject mismatched cert",
      );
      const classified = rawHttpsHelpers.classifyTlsError(caught);
      assert.equal(classified.localCertVerificationFailure, true);
      assert.throws(() => rawHttpsHelpers.assertStrictSniRejection(classified));
    } finally {
      await new Promise((resolve) => nonStrictTls.close(resolve));
    }
  } finally {
    rmSync(certDir, { recursive: true, force: true });
  }
});

test("regression (F-12): process log and response scanners fail closed on missing/empty streams and report leaks without raw secrets", () => {
  assert.equal(typeof rawHttpsHelpers.validateProcessLogs, "function");
  assert.equal(typeof rawHttpsHelpers.scanResponsesForLeaks, "function");
  const secretValue = "gwrk_v1.fixture-op.supersecretvalue1234567890";
  const canary = "051_ERROR_QUERY_CANARY";
  assert.throws(() =>
    rawHttpsHelpers.validateProcessLogs(
      { traefik: { stdout: "ok\n", stderr: "" } },
      {
        canaries: [canary],
        liveSecrets: [{ label: "apiKey", value: secretValue }],
      },
    ),
  );
  assert.throws(() =>
    rawHttpsHelpers.validateProcessLogs(
      {
        traefik: { stdout: "200 ok\n", stderr: "" },
        proxy: { stdout: "   \n", stderr: "" },
        origin: { stdout: "ready\n", stderr: "" },
      },
      {
        canaries: [canary],
        liveSecrets: [{ label: "apiKey", value: secretValue }],
      },
    ),
  );
  let leakError;
  try {
    rawHttpsHelpers.validateProcessLogs(
      {
        traefik: { stdout: "200 ok\n", stderr: "" },
        proxy: { stdout: `auth failed ${secretValue}\n`, stderr: "" },
        origin: { stdout: "ready\n", stderr: "" },
      },
      {
        canaries: [canary],
        liveSecrets: [{ label: "apiKey", value: secretValue }],
      },
    );
  } catch (error) {
    leakError = error;
  }
  assert.ok(leakError, "expected leaked live secret to throw");
  assert.equal(
    String(leakError.message).includes(secretValue),
    false,
    "leak error must never contain raw secret",
  );
  const cleanSummary = rawHttpsHelpers.validateProcessLogs(
    {
      traefik: { stdout: "200 ok\n", stderr: "" },
      proxy: { stdout: "request 302\n", stderr: "" },
      origin: { stdout: "fixture_origin_ready\n", stderr: "" },
    },
    {
      canaries: [canary],
      liveSecrets: [{ label: "apiKey", value: secretValue }],
    },
  );
  assert.equal(cleanSummary.leakCount, 0);
  assert.equal(cleanSummary.processes.proxy.nonEmptyLines, 1);

  assert.throws(() =>
    rawHttpsHelpers.scanResponsesForLeaks(
      [{ label: "denied", body: `err ${canary}` }],
      { canaries: [canary], liveSecrets: [] },
    ),
  );
  assert.doesNotThrow(() =>
    rawHttpsHelpers.scanResponsesForLeaks(
      [
        {
          label: "get-session",
          body: '{"csrfToken":"csrf-live-12345678"}',
          allowLabels: ["csrfToken"],
        },
      ],
      {
        canaries: [canary],
        liveSecrets: [{ label: "csrfToken", value: "csrf-live-12345678" }],
      },
    ),
  );
});
