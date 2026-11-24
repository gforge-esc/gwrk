import assert from "node:assert/strict";
import { connect } from "node:tls";

export const CANONICAL_HOST = "gwrk.gforge.ai";

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
  assert.ok(!/[\r\n]/.test(path), "invalid fixture request path");
  assert.ok(
    ["GET", "HEAD", "POST"].includes(method),
    "unsupported fixture request method",
  );
  assert.ok(
    Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 35000,
  );
  assert.ok(
    cancelAfterMs === undefined ||
      (Number.isInteger(cancelAfterMs) &&
        cancelAfterMs >= 1 &&
        cancelAfterMs <= 1000),
  );
  assert.ok(
    [CANONICAL_HOST, "unknown.example.invalid", null].includes(servername),
  );
  return new Promise((resolve, reject) => {
    let cancelled = false;
    let cancellation;
    const socket = connect({
      host: target,
      port: 443,
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
      if (!cancelled) reject(error);
    });
    socket.once("end", () => {
      clearTimeout(timer);
      clearTimeout(cancellation);
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
    label: "connection-nominated-authorization",
    lines: [
      "Authorization: Bearer invalid-fixture",
      "Connection: Authorization",
    ],
    browserEligible: false,
  },
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

export function assertAdmissionWire(events) {
  assert.ok(
    Array.isArray(events) && events.length > 0,
    "no actual admission wire observed",
  );
  for (const event of events) {
    assert.equal(event.path, "/");
    assert.ok(["GET", "HEAD"].includes(event.method));
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
  for (const field of ["logoutFault", "dropNextCommitted"])
    if (value[field] !== undefined)
      assert.equal(typeof value[field], "boolean");
  return { ...value };
}

export function validateNativeObservation(value, expected) {
  assert.equal(value?.version, 1, "native observation is missing");
  assert.deepEqual(
    value.provenance,
    { ...expected, source: "passive_tcp", namespace: "owned_nested" },
    "native observation provenance differs",
  );
  assert.ok(Number.isSafeInteger(value.sequence) && value.sequence > 0);
  assert.ok(
    Array.isArray(value.proxyRequests) && value.proxyRequests.length <= 4096,
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
    assert.equal(event.forwardedForCount, 1);
    assert.ok(["172.31.51.11", "172.31.51.12"].includes(event.forwardedFor));
    assert.equal(typeof event.hasForwardedUri, "boolean");
    assert.equal(typeof event.hasForwardedMethod, "boolean");
  }
  return value;
}
