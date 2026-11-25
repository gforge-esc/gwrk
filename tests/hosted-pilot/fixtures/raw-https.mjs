import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  closeSync,
  fchmodSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from "node:fs";
import { createConnection } from "node:net";
import { dirname, join, resolve } from "node:path";
import { connect } from "node:tls";

export const CANONICAL_HOST = "gwrk.gforge.ai";

const LOCAL_CERT_ERROR_CODES = new Set([
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_TLS_CERT_ALTNAME_FORMAT",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_UNTRUSTED",
  "CERT_REJECTED",
  "CERT_REVOKED",
  "HOSTNAME_MISMATCH",
]);

const COOKIE_DATE =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

function sanitizeCode(value, fallback) {
  const cleaned = String(value ?? "")
    .replace(/[^A-Za-z0-9_]/g, "")
    .slice(0, 64);
  return cleaned || fallback;
}

export function classifyTlsError(error, socket) {
  if (error?.tlsClassification) return { ...error.tlsClassification };
  let peerCertificatePresent = Boolean(error?.peerCertificatePresent);
  if (socket && !peerCertificatePresent) {
    try {
      const cert = socket.getPeerCertificate();
      peerCertificatePresent = Boolean(
        cert && typeof cert === "object" && Object.keys(cert).length > 0,
      );
    } catch {}
  }
  const errorCode = sanitizeCode(error?.code, "UNKNOWN_TLS_ERROR");
  const reasonText = String(error?.reason ?? error?.message ?? "");
  const localCertVerificationFailure =
    LOCAL_CERT_ERROR_CODES.has(errorCode) ||
    peerCertificatePresent ||
    /altname|self[- ]signed|unable to verify|certificate has expired|not yet valid/i.test(
      reasonText,
    );
  const tlsAlert =
    !localCertVerificationFailure &&
    !peerCertificatePresent &&
    (/^ERR_SSL_.*(?:UNRECOGNIZED_NAME|HANDSHAKE_FAILURE|ALERT|TLSV1_)/i.test(
      errorCode,
    ) ||
      /unrecognized name|handshake failure|sslv3 alert|tlsv1 alert|tls alert/i.test(
        reasonText,
      ));
  return {
    failed: true,
    errorCode,
    tlsAlert,
    peerCertificatePresent,
    localCertVerificationFailure,
  };
}

export function assertStrictSniRejection(result) {
  assert.equal(
    result?.failed,
    true,
    "strict SNI handshake unexpectedly succeeded",
  );
  assert.equal(
    result.peerCertificatePresent,
    false,
    "server offered a certificate despite strict SNI",
  );
  assert.equal(
    result.localCertVerificationFailure,
    false,
    "TLS failure was local certificate verification rather than server strict SNI rejection",
  );
  assert.equal(
    result.tlsAlert,
    true,
    `expected server TLS alert on strict SNI rejection, got ${result.errorCode}`,
  );
}

export async function probeTcpClosed({
  target = "172.31.51.1",
  port = 80,
  timeoutMs = 3000,
} = {}) {
  assert.ok(
    ["172.31.51.1", "127.0.0.1"].includes(target),
    "fixture target must remain inside the owned daemon",
  );
  assert.ok(
    target === "172.31.51.1"
      ? port === 80
      : Number.isInteger(port) && port >= 1 && port <= 65535,
    "unsupported fixture TCP probe port",
  );
  assert.ok(
    Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 10_000,
  );
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const socket = createConnection({ host: target, port });
    const timer = setTimeout(
      () => finish({ closed: false, errorCode: "ETIMEDOUT" }),
      timeoutMs,
    );
    socket.once("connect", () =>
      finish({ closed: false, errorCode: "PORT_OPEN" }),
    );
    socket.once("error", (error) => {
      const errorCode = sanitizeCode(error?.code, "UNKNOWN_TCP_ERROR");
      finish({ closed: errorCode === "ECONNREFUSED", errorCode });
    });
  });
}

export function parseResponse(bytes) {
  const boundary = bytes.indexOf("\r\n\r\n");
  assert.ok(boundary > 0, "gateway returned no complete response headers");
  const lines = bytes.subarray(0, boundary).toString("latin1").split("\r\n");
  const match = /^HTTP\/1\.[01] ([0-9]{3}) /.exec(lines.shift());
  assert.ok(match, "gateway returned an invalid status line");
  const fields = lines.map((line) => {
    const colon = line.indexOf(":");
    assert.ok(colon > 0, "gateway returned an invalid header");
    return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
  });
  const values = (name) =>
    fields
      .filter(([key]) => key === name.toLowerCase())
      .map(([, value]) => value);
  let body = bytes.subarray(boundary + 4);
  if (
    values("transfer-encoding").some(
      (value) => value.toLowerCase() === "chunked",
    )
  ) {
    const chunks = [];
    while (true) {
      const end = body.indexOf("\r\n");
      assert.ok(end >= 0, "gateway returned a partial chunk");
      const size = Number.parseInt(
        body.subarray(0, end).toString("ascii").split(";")[0],
        16,
      );
      assert.ok(
        Number.isSafeInteger(size) && size >= 0,
        "gateway returned an invalid chunk size",
      );
      if (size === 0) break;
      assert.ok(
        body.length >= end + 2 + size + 2,
        "gateway returned a partial chunk body",
      );
      chunks.push(body.subarray(end + 2, end + 2 + size));
      body = body.subarray(end + 2 + size + 2);
    }
    body = Buffer.concat(chunks);
  }
  return {
    status: Number(match[1]),
    fields,
    values,
    body: body.toString("utf8"),
  };
}

// Raw lines preserve empty Authorization and duplicate ordering for selection tests.
export async function rawHttps({
  ca,
  target = "172.31.51.1",
  port = 443,
  path = "/",
  method = "GET",
  headers = [],
  body = "",
  timeoutMs = 5000,
  cancelAfterMs,
  servername = CANONICAL_HOST,
}) {
  assert.ok(
    ["172.31.51.1", "127.0.0.1"].includes(target),
    "fixture target must remain inside the owned daemon",
  );
  assert.ok(
    target === "172.31.51.1"
      ? port === 443
      : Number.isInteger(port) && port >= 1 && port <= 65535,
    "unsupported fixture HTTPS port",
  );
  assert.ok(!/[\r\n]/.test(path), "invalid fixture request path");
  assert.ok(
    ["GET", "HEAD", "POST"].includes(method),
    "unsupported fixture request method",
  );
  assert.ok(
    Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 45_000,
  );
  assert.ok(
    cancelAfterMs === undefined ||
      (Number.isInteger(cancelAfterMs) &&
        cancelAfterMs >= 1 &&
        cancelAfterMs <= 5000),
  );
  assert.ok(
    [CANONICAL_HOST, "unknown.example.invalid", null].includes(servername),
  );
  return new Promise((resolve, reject) => {
    let cancelled = false;
    let handshook = false;
    let cancellation;
    const socket = connect({
      host: target,
      port,
      ...(servername === null ? {} : { servername }),
      ca,
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
    });
    const chunks = [];
    let length = 0;
    const timer = setTimeout(
      () => socket.destroy(new Error("fixture HTTPS deadline")),
      timeoutMs,
    );
    socket.once("secureConnect", () => {
      handshook = true;
      assert.equal(socket.authorized, true, "gateway TLS is untrusted");
      const lines = [
        `${method} ${path} HTTP/1.1`,
        `Host: ${CANONICAL_HOST}`,
        ...headers,
        `Content-Length: ${Buffer.byteLength(body)}`,
        "Connection: close",
        "",
        body,
      ];
      socket.write(lines.join("\r\n"));
      if (cancelAfterMs !== undefined)
        cancellation = setTimeout(() => {
          cancelled = true;
          clearTimeout(timer);
          socket.destroy();
          resolve({ cancelled: true });
        }, cancelAfterMs);
    });
    socket.on("data", (chunk) => {
      length += chunk.length;
      if (length > 65536)
        socket.destroy(new Error("fixture response exceeds bound"));
      else chunks.push(chunk);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      clearTimeout(cancellation);
      if (!cancelled) {
        error.tlsClassification = classifyTlsError(error, socket);
        reject(error);
      }
    });
    socket.once("end", () => {
      clearTimeout(timer);
      clearTimeout(cancellation);
      if (!handshook) {
        const error = new Error("TLS handshake closed before completion");
        error.code = "ERR_TLS_HANDSHAKE_CLOSED";
        error.tlsClassification = classifyTlsError(error, socket);
        reject(error);
        return;
      }
      try {
        resolve(parseResponse(Buffer.concat(chunks)));
      } catch (error) {
        reject(error);
      }
    });
  });
}

export const AUTHORIZATION_SELECTION_CASES = Object.freeze([
  { label: "absent", lines: [], browserEligible: true },
  { label: "empty", lines: ["Authorization:"], browserEligible: false },
  { label: "whitespace", lines: ["Authorization:   "], browserEligible: false },
  {
    label: "malformed-bearer",
    lines: ["Authorization: Bearer"],
    browserEligible: false,
  },
  {
    label: "other-scheme",
    lines: ["Authorization: Basic fixture"],
    browserEligible: false,
  },
  {
    label: "duplicate-empty-first",
    lines: ["Authorization:", "Authorization: Bearer invalid-fixture"],
    browserEligible: false,
  },
  {
    label: "duplicate-empty-last",
    lines: ["Authorization: Bearer invalid-fixture", "Authorization:"],
    browserEligible: false,
  },
]);

export function selectForwardAuthRootEvents(requests, afterDirectRootIndex) {
  assert.ok(Array.isArray(requests), "origin request log is required");
  assert.ok(
    Number.isInteger(afterDirectRootIndex) &&
      afterDirectRootIndex >= 0 &&
      afterDirectRootIndex <= requests.length,
    "invalid direct root slice index",
  );
  const events = requests
    .slice(afterDirectRootIndex)
    .filter((value) => value.path === "/");
  assert.ok(
    events.length > 0,
    "no actual ForwardAuth root admission events observed",
  );
  return events;
}

export function assertAdmissionWire(events) {
  assert.ok(
    Array.isArray(events) && events.length > 0,
    "no actual admission wire observed",
  );
  for (const event of events) {
    assert.equal(event.path, "/");
    assert.equal(event.method, "GET");
    assert.equal(event.peer, "127.0.0.1");
    for (const field of [
      "hasQuery",
      "hasBody",
      "hasAuthorization",
      "hasCookie",
    ])
      assert.equal(event[field], false, `admission wire leaked ${field}`);
    assert.equal(event.forwardedUriIsRoot, true);
    assert.equal(event.forwardedMethodIsGet, true);
    assert.equal(event.forwardedForCount, 1);
    assert.ok(["172.31.51.11", "172.31.51.12"].includes(event.forwardedFor));
  }
}

export function parseFixtureControl(value) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  const fields = new Set([
    "sequence",
    "advanceRateMs",
    "prefillLoginBuckets",
    "loginFault",
    "logoutFault",
    "dropNextCommitted",
    "closeIdleConnections",
  ]);
  for (const key of Object.keys(value))
    assert.ok(fields.has(key), "unknown private fixture control");
  assert.ok(
    Number.isSafeInteger(value.sequence) &&
      value.sequence > 0 &&
      value.sequence <= 1000,
  );
  if (value.advanceRateMs !== undefined)
    assert.equal(value.advanceRateMs, 120001);
  if (value.prefillLoginBuckets !== undefined)
    assert.ok(
      Number.isInteger(value.prefillLoginBuckets) &&
        value.prefillLoginBuckets >= 0 &&
        value.prefillLoginBuckets <= 1000,
    );
  if (value.loginFault !== undefined)
    assert.ok(
      ["none", "dependency", "connection", "timeout", "oversized"].includes(
        value.loginFault,
      ),
    );
  for (const field of [
    "logoutFault",
    "dropNextCommitted",
    "closeIdleConnections",
  ])
    if (value[field] !== undefined)
      assert.equal(typeof value[field], "boolean");
  return { ...value };
}

export function wrapLoginFaultResponse(
  incoming,
  outgoing,
  fault,
  { timeoutMs = 31_000, onCancelled } = {},
) {
  if (!["oversized", "timeout"].includes(fault)) return;
  const origWriteHead = outgoing.writeHead.bind(outgoing);
  const origWrite = outgoing.write.bind(outgoing);
  const origEnd = outgoing.end.bind(outgoing);
  let intercepting = false;
  let headArgs = null;
  const chunks = [];
  let timer = null;
  let settled = false;
  const isTwoXx = (code) => code >= 200 && code < 300;

  outgoing.writeHead = (statusCode, ...rest) => {
    if (isTwoXx(statusCode)) {
      intercepting = true;
      headArgs = [statusCode, ...rest];
      return outgoing;
    }
    intercepting = false;
    return origWriteHead(statusCode, ...rest);
  };

  outgoing.write = (chunk, encoding, cb) => {
    if (!intercepting && !outgoing.headersSent && isTwoXx(outgoing.statusCode))
      intercepting = true;
    if (intercepting) {
      chunks.push({ chunk, encoding });
      if (typeof encoding === "function") encoding();
      else if (typeof cb === "function") cb();
      return true;
    }
    return origWrite(chunk, encoding, cb);
  };

  outgoing.end = (...args) => {
    if (!intercepting && !outgoing.headersSent && isTwoXx(outgoing.statusCode))
      intercepting = true;
    if (!intercepting) return origEnd(...args);
    if (fault === "oversized") {
      for (const name of [
        "location",
        "set-cookie",
        "x-forwarded-for",
        "x-forwarded-uri",
        "x-forwarded-method",
        "transfer-encoding",
        "content-length",
        "content-type",
      ]) {
        outgoing.removeHeader(name);
      }
      const payload = "F".repeat(4097);
      origWriteHead(200, {
        "content-type": "text/plain; charset=utf-8",
        "content-length": String(Buffer.byteLength(payload)),
      });
      return origEnd(payload);
    }
    const cancel = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (!settled) {
        settled = true;
        onCancelled?.();
      }
    };
    incoming.once("close", cancel);
    outgoing.once("close", cancel);
    timer = setTimeout(() => {
      timer = null;
      if (settled || outgoing.destroyed || outgoing.writableEnded) return;
      settled = true;
      incoming.off("close", cancel);
      outgoing.off("close", cancel);
      if (headArgs) origWriteHead(...headArgs);
      for (const item of chunks) {
        if (typeof item.encoding === "string")
          origWrite(item.chunk, item.encoding);
        else origWrite(item.chunk);
      }
      origEnd(...args);
    }, timeoutMs);
    timer.unref?.();
    return outgoing;
  };
}

export function validateExpectedProvenance(expected) {
  assert.ok(
    expected && typeof expected === "object" && !Array.isArray(expected),
    "expected native observation provenance is required",
  );
  assert.match(
    expected.runId ?? "",
    /^[a-f0-9]{24}$/,
    "expected runId must be 24 lowercase hex characters",
  );
  assert.match(
    expected.proxyImageId ?? "",
    /^sha256:[a-f0-9]{64}$/,
    "expected proxyImageId must be sha256:<64 hex>",
  );
  assert.match(
    expected.traefikImageId ?? "",
    /^sha256:[a-f0-9]{64}$/,
    "expected traefikImageId must be sha256:<64 hex>",
  );
  assert.match(
    expected.runtimeReceiptSha256 ?? "",
    /^[a-f0-9]{64}$/,
    "expected runtimeReceiptSha256 must be 64 lowercase hex characters",
  );
  return {
    runId: expected.runId,
    proxyImageId: expected.proxyImageId,
    traefikImageId: expected.traefikImageId,
    runtimeReceiptSha256: expected.runtimeReceiptSha256,
  };
}

export function validateNativeObservation(value, expected, options = {}) {
  const validExpected = validateExpectedProvenance(expected);
  assert.equal(value?.version, 1, "native observation is missing");
  const topAllowed = new Set([
    "version",
    "provenance",
    "proxyRequests",
    "sequence",
    "barrierSequence",
  ]);
  for (const key of Object.keys(value))
    assert.ok(
      topAllowed.has(key),
      "native observation contains unexpected top-level field",
    );
  assert.deepEqual(
    value.provenance,
    { ...validExpected, source: "passive_tcp", namespace: "owned_nested" },
    "native observation provenance differs",
  );
  assert.ok(Number.isSafeInteger(value.sequence) && value.sequence > 0);
  if (value.barrierSequence !== undefined) {
    assert.ok(
      Number.isSafeInteger(value.barrierSequence) && value.barrierSequence >= 0,
      "native observation barrierSequence is invalid",
    );
  }
  if (options.minBarrierSequence !== undefined) {
    assert.ok(
      Number.isSafeInteger(value.barrierSequence) &&
        value.barrierSequence >= options.minBarrierSequence,
      "native observation barrier was not acknowledged",
    );
  }
  assert.ok(
    Array.isArray(value.proxyRequests) &&
      value.proxyRequests.length > 0 &&
      value.proxyRequests.length <= 4096,
    "native observation requires nonempty bounded proxyRequests",
  );
  const allowed = new Set([
    "sequence",
    "method",
    "path",
    "querySha256",
    "cookieSha256",
    "peer",
    "forwardedFor",
    "forwardedForCount",
    "hasForwardedUri",
    "hasForwardedMethod",
  ]);
  let last = 0;
  for (const event of value.proxyRequests) {
    for (const key of Object.keys(event))
      assert.ok(
        allowed.has(key),
        "native observation contains unexpected data",
      );
    assert.ok(Number.isSafeInteger(event.sequence) && event.sequence > last);
    last = event.sequence;
    assert.ok(["GET", "HEAD", "POST"].includes(event.method));
    assert.ok(
      [
        "/oauth2/start",
        "/oauth2/callback",
        "/oauth2/auth",
        "/oauth2/sign_out",
      ].includes(event.path),
    );
    for (const key of ["querySha256", "cookieSha256"])
      assert.match(event[key], /^[a-f0-9]{64}$/);
    assert.equal(event.peer, "127.0.0.1");
    if (event.path === "/oauth2/sign_out") {
      assert.equal(event.method, "GET");
      assert.equal(event.forwardedForCount, 0);
      assert.equal(event.forwardedFor, "");
    } else {
      assert.equal(event.forwardedForCount, 1);
      assert.ok(["172.31.51.11", "172.31.51.12"].includes(event.forwardedFor));
    }
    assert.equal(typeof event.hasForwardedUri, "boolean");
    assert.equal(typeof event.hasForwardedMethod, "boolean");
  }
  assert.ok(value.sequence >= last, "observation sequence lags proxy events");
  return value;
}

const SLEEP_ARRAY = new Int32Array(new SharedArrayBuffer(4));

function resolveRequireRootOwnership(requireRootOwnership = true) {
  assert.equal(
    typeof requireRootOwnership,
    "boolean",
    "requireRootOwnership must be a boolean",
  );
  if (process.env.GWRK_051_OWNED_CONTROLLER === "1") {
    assert.equal(
      requireRootOwnership,
      true,
      "production owned controller cannot disable root ownership enforcement",
    );
  }
  return requireRootOwnership;
}

function assertPathInsideDir(dir, targetPath, label) {
  assert.ok(
    typeof targetPath === "string" && targetPath.length > 0,
    `${label} is required`,
  );
  assert.equal(
    dirname(resolve(targetPath)),
    resolve(dir),
    `${label} must reside directly inside verified observerDir`,
  );
}

function writeFullBuffer(fd, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    offset += writeSync(fd, buffer, offset, buffer.length - offset);
  }
}

function lstatPresent(targetPath) {
  try {
    lstatSync(targetPath);
    return { present: true, error: null };
  } catch (err) {
    return { present: false, error: err };
  }
}

export function verifyObserverDirectory(
  observerDir,
  { requireRootOwnership = true } = {},
) {
  const enforceRoot = resolveRequireRootOwnership(requireRootOwnership);
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
  if (enforceRoot) {
    assert.equal(st.uid, 0, "observerDir must be owned by root uid 0");
    assert.equal(st.gid, 0, "observerDir must be owned by root gid 0");
  }
  const dirFlags =
    fsConstants.O_RDONLY |
    fsConstants.O_NOFOLLOW |
    (fsConstants.O_DIRECTORY ?? 0);
  const fd = openSync(observerDir, dirFlags);
  try {
    const fst = fstatSync(fd);
    assert.equal(
      fst.isDirectory(),
      true,
      "observerDir descriptor must be a directory",
    );
    assert.equal(
      fst.mode & 0o777,
      0o700,
      `observerDir descriptor must have mode 0700, got ${(fst.mode & 0o777).toString(8)}`,
    );
    if (enforceRoot) {
      assert.equal(
        fst.uid,
        0,
        "observerDir descriptor must be owned by root uid 0",
      );
      assert.equal(
        fst.gid,
        0,
        "observerDir descriptor must be owned by root gid 0",
      );
    }
    assert.equal(fst.ino, st.ino, "observerDir identity changed during open");
    assert.equal(fst.dev, st.dev, "observerDir device changed during open");
  } finally {
    closeSync(fd);
  }
  return st;
}

export function readSafeJson(
  filePath,
  { requireRootOwnership = true, maxBytes = 2 * 1024 * 1024, observerDir } = {},
) {
  const enforceRoot = resolveRequireRootOwnership(requireRootOwnership);
  if (observerDir !== undefined) {
    assertPathInsideDir(observerDir, filePath, "filePath");
  }
  const lst = lstatSync(filePath);
  assert.equal(
    lst.isSymbolicLink(),
    false,
    `file ${filePath} must not be a symlink`,
  );
  assert.equal(lst.isFile(), true, `file ${filePath} must be a regular file`);
  assert.equal(
    lst.mode & 0o777,
    0o600,
    `file ${filePath} must have mode 0600, got ${(lst.mode & 0o777).toString(8)}`,
  );
  assert.ok(
    lst.size <= maxBytes,
    `file ${filePath} exceeds ${maxBytes} byte bound`,
  );
  if (enforceRoot) {
    assert.equal(lst.uid, 0, `file ${filePath} must be owned by root uid 0`);
  }
  const fd = openSync(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const fst = fstatSync(fd);
    assert.equal(
      fst.isFile(),
      true,
      `file descriptor for ${filePath} must be a regular file`,
    );
    assert.equal(
      fst.mode & 0o777,
      0o600,
      `file descriptor for ${filePath} must have mode 0600`,
    );
    if (enforceRoot) {
      assert.equal(
        fst.uid,
        0,
        `file descriptor for ${filePath} must be owned by root uid 0`,
      );
    }
    assert.equal(
      fst.ino,
      lst.ino,
      `file identity for ${filePath} changed during open`,
    );
    assert.equal(
      fst.dev,
      lst.dev,
      `device for ${filePath} changed during open`,
    );
    assert.ok(
      fst.size <= maxBytes,
      `file ${filePath} exceeds ${maxBytes} byte bound`,
    );
    const raw = readFileSync(fd, "utf8");
    return JSON.parse(raw);
  } finally {
    closeSync(fd);
  }
}

export function validateNativeObserverHealth(value, expected, options = {}) {
  const validExpected = validateExpectedProvenance(expected);
  assert.equal(
    value?.version,
    1,
    "native observer health is missing or invalid version",
  );
  const topAllowed = new Set([
    "version",
    "provenance",
    "barrierSequence",
    "sentinelPort",
    "startupSelfTestPassed",
    "captureStats",
    "originTcpSummary",
  ]);
  for (const key of Object.keys(value)) {
    assert.ok(
      topAllowed.has(key),
      `native observer health contains unexpected top-level field ${key}`,
    );
  }
  for (const key of topAllowed) {
    assert.ok(
      key in value,
      `native observer health missing required top-level field ${key}`,
    );
  }
  assert.deepEqual(
    value.provenance,
    { ...validExpected, source: "passive_tcp", namespace: "owned_nested" },
    "native observer health provenance differs",
  );
  assert.ok(
    Number.isSafeInteger(value.barrierSequence) && value.barrierSequence >= 0,
    "native observer health barrierSequence is invalid",
  );
  if (options.minBarrierSequence !== undefined) {
    assert.ok(
      value.barrierSequence >= options.minBarrierSequence,
      `native observer health barrierSequence ${value.barrierSequence} < expected ${options.minBarrierSequence}`,
    );
  }
  assert.equal(
    value.startupSelfTestPassed,
    true,
    "native observer startup self test did not pass",
  );
  assert.ok(
    Number.isInteger(value.sentinelPort) &&
      value.sentinelPort >= 1024 &&
      value.sentinelPort <= 65535,
    "native observer sentinelPort is invalid",
  );

  // captureStats
  const stats = value.captureStats;
  assert.ok(
    stats && typeof stats === "object" && !Array.isArray(stats),
    "captureStats required",
  );
  assert.ok(
    Number.isSafeInteger(stats.kernelPackets) && stats.kernelPackets > 0,
    "captureStats.kernelPackets must be > 0",
  );
  assert.equal(stats.kernelDrops, 0, "captureStats.kernelDrops must be 0");
  assert.equal(
    stats.truncatedFrames,
    0,
    "captureStats.truncatedFrames must be 0",
  );
  assert.equal(stats.parserErrors, 0, "captureStats.parserErrors must be 0");
  assert.equal(
    stats.bufferOverflows,
    0,
    "captureStats.bufferOverflows must be 0",
  );
  assert.equal(stats.ipv4Fragments, 0, "captureStats.ipv4Fragments must be 0");
  assert.ok(
    Number.isSafeInteger(stats.effectiveRcvBufBytes) &&
      stats.effectiveRcvBufBytes >= 524288,
    "captureStats.effectiveRcvBufBytes must be >= 512 KiB",
  );
  assert.equal(typeof stats.ignoreOutgoingKernelEnabled, "boolean");
  assert.equal(typeof stats.pkttypeBpfFallbackActive, "boolean");
  assert.equal(
    stats.integrityFaultCode,
    null,
    `captureStats has sticky fault: ${stats.integrityFaultCode}`,
  );

  // originTcpSummary
  const tcp = value.originTcpSummary;
  assert.ok(
    tcp && typeof tcp === "object" && !Array.isArray(tcp),
    "originTcpSummary required",
  );
  assert.equal(tcp.port, 18790, "originTcpSummary.port must be 18790");
  for (const counter of [
    "handshakesCompleted",
    "reusedConnections",
    "zeroPriorRequestParkedConnections",
    "zeroPriorRequestReusedConnections",
    "zeroByteClosedConnections",
    "rstClosedConnections",
    "abortedBeforeHeadersConnections",
  ]) {
    assert.ok(
      Number.isSafeInteger(tcp[counter]) && tcp[counter] >= 0,
      `originTcpSummary.${counter} must be non-negative safe integer`,
    );
  }
  assert.equal(typeof tcp.synGateActive, "boolean");
  for (const flowField of [
    "lastSynSentOriginFlowId",
    "lastZeroPriorParkedFlowId",
    "lastZeroPriorReusedFlowId",
  ]) {
    if (tcp[flowField] !== undefined && tcp[flowField] !== null) {
      assert.ok(
        typeof tcp[flowField] === "string" && tcp[flowField].length > 0,
        `originTcpSummary.${flowField} must be null or a non-empty string`,
      );
    }
  }
  assert.equal(
    tcp.unusedDialObserved,
    tcp.zeroPriorRequestReusedConnections > 0,
    "originTcpSummary.unusedDialObserved must equal zeroPriorRequestReusedConnections > 0",
  );
  return value;
}

export function assertScenarioBReuseProof(health) {
  assert.ok(
    health?.originTcpSummary?.zeroPriorRequestReusedConnections >= 1,
    "Scenario B requires real zero-request parked/reused connection proof (zeroPriorRequestReusedConnections >= 1)",
  );
  assert.equal(
    health.originTcpSummary.unusedDialObserved,
    true,
    "Scenario B requires unusedDialObserved === true",
  );
  return health;
}

export function readNativeObserverHealth({
  healthPath,
  observerDir = process.env.GWRK_051_OBSERVER_DIR ?? "/fixture/observer",
  expected,
  minBarrierSequence,
  requireRootOwnership = true,
} = {}) {
  const enforceRoot = resolveRequireRootOwnership(requireRootOwnership);
  const targetPath =
    healthPath ?? join(observerDir, "native-observer-health.json");
  const dir = observerDir ?? dirname(targetPath);
  verifyObserverDirectory(dir, { requireRootOwnership: enforceRoot });
  assertPathInsideDir(dir, targetPath, "healthPath");
  const raw = readSafeJson(targetPath, {
    requireRootOwnership: enforceRoot,
    observerDir: dir,
  });
  return validateNativeObserverHealth(raw, expected, { minBarrierSequence });
}

export function readNativeObservationBarrier({
  observationPath,
  barrierPath,
  healthPath,
  observerDir = process.env.GWRK_051_OBSERVER_DIR ?? "/fixture/observer",
  expected,
  barrierSequence,
  timeoutMs = 5000,
  pollMs = 25,
  requireRootOwnership = true,
  runId,
}) {
  const enforceRoot = resolveRequireRootOwnership(requireRootOwnership);
  const targetBarrierPath =
    barrierPath ?? join(observerDir, "native-observation-barrier.json");
  const targetObsPath =
    observationPath ?? join(observerDir, "native-observation.json");
  const targetHealthPath =
    healthPath ?? join(observerDir, "native-observer-health.json");
  const dir = observerDir ?? dirname(targetBarrierPath);

  validateExpectedProvenance(expected);
  assert.ok(
    Number.isSafeInteger(barrierSequence) &&
      barrierSequence > 0 &&
      barrierSequence <= 100_000,
    "invalid native observation barrierSequence",
  );

  verifyObserverDirectory(dir, { requireRootOwnership: enforceRoot });
  assertPathInsideDir(dir, targetBarrierPath, "barrierPath");
  assertPathInsideDir(dir, targetObsPath, "observationPath");
  assertPathInsideDir(dir, targetHealthPath, "healthPath");

  const payload = {
    version: 1,
    barrierSequence,
    ...(runId || expected?.runId ? { runId: runId ?? expected.runId } : {}),
  };
  const nextPath = `${targetBarrierPath}.next`;
  assertPathInsideDir(dir, nextPath, "barrier nextPath");
  const nextContent = Buffer.from(JSON.stringify(payload, null, 2), "utf8");
  const fd = openSync(
    nextPath,
    fsConstants.O_WRONLY |
      fsConstants.O_CREAT |
      fsConstants.O_TRUNC |
      fsConstants.O_NOFOLLOW,
    0o600,
  );
  try {
    const fst = fstatSync(fd);
    assert.equal(
      fst.isFile(),
      true,
      `file descriptor for ${nextPath} must be a regular file`,
    );
    if (enforceRoot) {
      assert.equal(
        fst.uid,
        0,
        `file descriptor for ${nextPath} must be owned by root uid 0`,
      );
    }
    fchmodSync(fd, 0o600);
    writeFullBuffer(fd, nextContent);
  } finally {
    closeSync(fd);
  }
  renameSync(nextPath, targetBarrierPath);

  const deadline = Date.now() + timeoutMs;
  let lastError = new Error("native observation file absent");
  while (true) {
    const healthProbe = lstatPresent(targetHealthPath);
    if (healthProbe.present) {
      try {
        const health = readSafeJson(targetHealthPath, {
          requireRootOwnership: enforceRoot,
          observerDir: dir,
        });
        if (health?.captureStats?.integrityFaultCode) {
          throw new Error(
            `native observer sticky fault: ${health.captureStats.integrityFaultCode}`,
          );
        }
      } catch (err) {
        if (err.message.includes("sticky fault")) {
          throw err;
        }
        lastError = err;
      }
    } else if (healthProbe.error?.code !== "ENOENT") {
      lastError = healthProbe.error;
    }

    const obsProbe = lstatPresent(targetObsPath);
    if (obsProbe.present) {
      try {
        const raw = readSafeJson(targetObsPath, {
          requireRootOwnership: enforceRoot,
          observerDir: dir,
        });
        if (
          Number.isSafeInteger(raw?.barrierSequence) &&
          raw.barrierSequence >= barrierSequence
        ) {
          const health = readSafeJson(targetHealthPath, {
            requireRootOwnership: enforceRoot,
            observerDir: dir,
          });
          validateNativeObserverHealth(health, expected, {
            minBarrierSequence: barrierSequence,
          });
          return validateNativeObservation(raw, expected, {
            minBarrierSequence: barrierSequence,
          });
        }
      } catch (error) {
        if (error.message.includes("sticky fault")) {
          throw error;
        }
        lastError = error;
      }
    } else if (obsProbe.error?.code !== "ENOENT") {
      lastError = obsProbe.error;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `native observation barrier failed closed: ${lastError.message}`,
      );
    }
    Atomics.wait(SLEEP_ARRAY, 0, 0, pollMs);
  }
}

export function sliceProxyDelta(beforeObs, afterObs) {
  assert.ok(
    afterObs.proxyRequests.length >= beforeObs.proxyRequests.length,
    "native observation proxyRequests shrank",
  );
  for (let i = 0; i < beforeObs.proxyRequests.length; i++) {
    assert.equal(
      afterObs.proxyRequests[i].sequence,
      beforeObs.proxyRequests[i].sequence,
      "native observation proxyRequests prefix diverged",
    );
  }
  return afterObs.proxyRequests.slice(beforeObs.proxyRequests.length);
}

export function assertProxyDelta(
  beforeObs,
  afterObs,
  expectedDelta,
  filterFn = () => true,
) {
  const delta = sliceProxyDelta(beforeObs, afterObs).filter(filterFn);
  assert.equal(
    delta.length,
    expectedDelta,
    `expected ${expectedDelta} proxy invocations, observed ${delta.length}`,
  );
  return delta;
}

export function assertProxyWireMatch(events, requestProof, expectedClientIp) {
  assert.ok(
    Array.isArray(events) && events.length === 1,
    `expected exactly 1 matched proxy event, got ${events?.length ?? 0}`,
  );
  const [event] = events;
  assert.equal(event.method, requestProof.method);
  assert.equal(event.path, requestProof.path);
  assert.equal(event.querySha256, requestProof.querySha256);
  assert.equal(event.cookieSha256, requestProof.cookieSha256);
  assert.equal(event.peer, "127.0.0.1");
  assert.equal(event.forwardedForCount, 1);
  assert.equal(event.forwardedFor, expectedClientIp);
  assert.equal(event.hasForwardedUri, false);
  assert.equal(event.hasForwardedMethod, false);
}

function parseSetCookieHeader(header) {
  assert.equal(typeof header, "string");
  assert.equal(/[\r\n]/.test(header), false, "Set-Cookie contains CRLF");
  assert.equal(
    /,\s*[A-Za-z0-9_-]+=/.test(header),
    false,
    "Set-Cookie headers must remain separate",
  );
  const [pair, ...rawAttrs] = header.split(";");
  const eq = pair.indexOf("=");
  assert.ok(eq > 0, "invalid Set-Cookie name=value pair");
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  const attrs = new Map();
  for (const part of rawAttrs) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf("=");
    const key = (idx < 0 ? trimmed : trimmed.slice(0, idx))
      .trim()
      .toLowerCase();
    const val = idx < 0 ? null : trimmed.slice(idx + 1).trim();
    assert.equal(
      attrs.has(key),
      false,
      `duplicate Set-Cookie attribute ${key}`,
    );
    attrs.set(key, val);
  }
  return { name, value, attrs };
}

export function assertCsrfCookieHeader(
  setCookieHeaders,
  sessionExpiresMs,
  nowMs = Date.now(),
) {
  assert.ok(Array.isArray(setCookieHeaders));
  assert.ok(Number.isFinite(sessionExpiresMs));
  const parsed = setCookieHeaders
    .map(parseSetCookieHeader)
    .filter((cookie) => cookie.name === "__Host-gwrk_csrf");
  assert.equal(
    parsed.length,
    1,
    "expected exactly one __Host-gwrk_csrf Set-Cookie header",
  );
  const { value, attrs } = parsed[0];
  assert.ok(value.length > 0, "__Host-gwrk_csrf value must be nonempty");
  assert.equal(attrs.has("domain"), false, "__Host-gwrk_csrf must omit Domain");
  assert.equal(
    attrs.has("max-age"),
    false,
    "__Host-gwrk_csrf issuance must omit Max-Age",
  );
  assert.equal(attrs.get("path"), "/", "__Host-gwrk_csrf must set Path=/");
  assert.equal(attrs.has("secure"), true, "__Host-gwrk_csrf must set Secure");
  assert.equal(
    attrs.has("httponly"),
    true,
    "__Host-gwrk_csrf must set HttpOnly",
  );
  assert.equal(
    (attrs.get("samesite") ?? "").toLowerCase(),
    "lax",
    "__Host-gwrk_csrf must set SameSite=Lax",
  );
  const expiresRaw = attrs.get("expires");
  assert.ok(
    typeof expiresRaw === "string" && COOKIE_DATE.test(expiresRaw),
    "__Host-gwrk_csrf must set valid Expires date",
  );
  const expiresMs = Date.parse(expiresRaw);
  assert.ok(
    Number.isFinite(expiresMs) && expiresMs <= sessionExpiresMs,
    "__Host-gwrk_csrf Expires exceeds session expiry",
  );
  assert.ok(
    expiresMs > nowMs - 60_000,
    "__Host-gwrk_csrf Expires is already expired",
  );
}

export function assertLogoutClearingCookies(
  setCookieHeaders,
  sessionCookieNames,
  nowMs = Date.now(),
) {
  assert.ok(Array.isArray(setCookieHeaders));
  assert.ok(
    Array.isArray(sessionCookieNames) && sessionCookieNames.length > 0,
    "at least one proxy session cookie name is required",
  );
  const parsed = setCookieHeaders.map(parseSetCookieHeader);
  const requiredNames = [
    ...new Set([...sessionCookieNames, "__Host-gwrk_csrf"]),
  ];
  for (const required of requiredNames) {
    const matches = parsed.filter((cookie) => cookie.name === required);
    assert.equal(
      matches.length,
      1,
      `expected one separate clearing Set-Cookie header for ${required}`,
    );
    const { value, attrs } = matches[0];
    assert.equal(value, "", `clearing cookie ${required} must be empty`);
    assert.equal(attrs.has("domain"), false, `${required} must omit Domain`);
    assert.equal(attrs.get("path"), "/", `${required} must set Path=/`);
    assert.equal(attrs.has("secure"), true, `${required} must set Secure`);
    assert.equal(attrs.has("httponly"), true, `${required} must set HttpOnly`);
    if (required === "__Host-gwrk_csrf") {
      assert.equal(
        (attrs.get("samesite") ?? "").toLowerCase(),
        "lax",
        "__Host-gwrk_csrf clear must set SameSite=Lax",
      );
    }
    const maxAge = attrs.get("max-age");
    const expires = attrs.get("expires");
    assert.ok(
      maxAge !== undefined || expires !== undefined,
      `clearing cookie ${required} must expire`,
    );
    if (maxAge !== undefined) {
      assert.ok(
        /^-?\d+$/.test(maxAge) && Number(maxAge) <= 0,
        `clearing cookie ${required} Max-Age must be <= 0`,
      );
    }
    if (expires !== undefined) {
      assert.ok(
        COOKIE_DATE.test(expires) && Date.parse(expires) < nowMs,
        `clearing cookie ${required} Expires must be in the past`,
      );
    }
  }
}

function buildSearchNeedles(canaries, liveSecrets) {
  const needles = [];
  for (const canary of canaries) {
    assert.ok(
      typeof canary === "string" && canary.length > 0,
      "invalid static canary",
    );
    const digest = createHash("sha256").update(canary).digest("hex");
    needles.push({
      kind: "canary",
      label: canary,
      value: canary,
      valueSha256: digest,
    });
  }
  for (const entry of liveSecrets) {
    if (!entry || typeof entry.value !== "string" || entry.value.length < 8)
      continue;
    const digest = createHash("sha256").update(entry.value).digest("hex");
    needles.push({
      kind: "live_secret",
      label: entry.label,
      value: entry.value,
      valueSha256: digest,
    });
    const encoded = encodeURIComponent(entry.value);
    if (encoded !== entry.value) {
      needles.push({
        kind: "live_secret",
        label: `${entry.label}:urlencoded`,
        value: encoded,
        valueSha256: digest,
      });
    }
  }
  return needles;
}

export function validateProcessLogs(
  streamsByProcess,
  { canaries = [], liveSecrets = [] } = {},
) {
  assert.ok(
    streamsByProcess && typeof streamsByProcess === "object",
    "process log capture is required",
  );
  assert.ok(canaries.length > 0, "at least one canary is required");
  const needles = buildSearchNeedles(canaries, liveSecrets);
  const summary = { leakCount: 0, matches: [], processes: {} };
  for (const name of ["traefik", "proxy", "origin"]) {
    const streams = streamsByProcess[name];
    assert.ok(
      streams &&
        typeof streams.stdout === "string" &&
        typeof streams.stderr === "string",
      `missing captured stdout/stderr for ${name}`,
    );
    const stdoutLines = streams.stdout
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0).length;
    const stderrLines = streams.stderr
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0).length;
    const nonEmptyLines = stdoutLines + stderrLines;
    assert.ok(nonEmptyLines > 0, `process ${name} produced empty outcome logs`);
    summary.processes[name] = { stdoutLines, stderrLines, nonEmptyLines };
    for (const streamName of ["stdout", "stderr"]) {
      const content = streams[streamName];
      for (const needle of needles) {
        if (content.includes(needle.value)) {
          summary.leakCount++;
          summary.matches.push({
            process: name,
            stream: streamName,
            kind: needle.kind,
            label: needle.label,
            valueSha256: needle.valueSha256,
          });
        }
      }
    }
  }
  if (summary.leakCount > 0) {
    const safeDesc = summary.matches
      .map(
        (m) =>
          `${m.process}:${m.stream}:${m.kind}:${m.label}:${m.valueSha256.slice(0, 12)}`,
      )
      .join(",");
    const err = new Error(
      `secret/canary leak detected in process logs (${summary.leakCount}): ${safeDesc}`,
    );
    err.leakSummary = summary;
    throw err;
  }
  return summary;
}

export function scanResponsesForLeaks(
  responses,
  { canaries = [], liveSecrets = [] } = {},
) {
  assert.ok(
    Array.isArray(responses) && responses.length > 0,
    "at least one response must be scanned",
  );
  assert.ok(canaries.length > 0, "at least one canary is required");
  const needles = buildSearchNeedles(canaries, liveSecrets);
  const summary = {
    scannedResponses: responses.length,
    leakCount: 0,
    matches: [],
  };
  for (const item of responses) {
    const responseLabel = (item?.label ?? "unknown").split("?")[0];
    const body = typeof item?.body === "string" ? item.body : "";
    const allowed = new Set(item?.allowLabels ?? []);
    for (const needle of needles) {
      const baseLabel = needle.label.replace(/:urlencoded$/, "");
      if (allowed.has(baseLabel)) continue;
      if (body.includes(needle.value)) {
        summary.leakCount++;
        summary.matches.push({
          response: responseLabel,
          kind: needle.kind,
          label: needle.label,
          valueSha256: needle.valueSha256,
        });
      }
    }
  }
  if (summary.leakCount > 0) {
    const safeDesc = summary.matches
      .map(
        (m) =>
          `${m.response}:${m.kind}:${m.label}:${m.valueSha256.slice(0, 12)}`,
      )
      .join(",");
    const err = new Error(
      `secret/canary leak detected in HTTP responses (${summary.leakCount}): ${safeDesc}`,
    );
    err.leakSummary = summary;
    throw err;
  }
  return summary;
}
