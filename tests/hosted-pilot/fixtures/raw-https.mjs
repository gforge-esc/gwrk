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
  return new Promise((resolve, reject) => {
    const socket = connect({
      host: target,
      port: 443,
      servername: CANONICAL_HOST,
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
    });
    socket.on("data", (chunk) => {
      length += chunk.length;
      if (length > 65536)
        socket.destroy(new Error("fixture response exceeds bound"));
      else chunks.push(chunk);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once("end", () => {
      clearTimeout(timer);
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
