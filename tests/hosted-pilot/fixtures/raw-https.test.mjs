import assert from "node:assert/strict";
import { test } from "vitest";
import {
  AUTHORIZATION_SELECTION_CASES,
  parseResponse,
  rawHttps,
} from "./raw-https.mjs";

test("preserves separate Set-Cookie fields and decodes bounded chunked bodies", () => {
  const response = parseResponse(
    Buffer.from(
      "HTTP/1.1 503 Service Unavailable\r\nSet-Cookie: a=; Secure\r\nSet-Cookie: b=; Secure\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n2\r\nde\r\n0\r\n\r\n",
    ),
  );
  assert.equal(response.status, 503);
  assert.deepEqual(response.values("set-cookie"), ["a=; Secure", "b=; Secure"]);
  assert.equal(response.body, "abcde");
});

test("rejects truncated responses and preserves HEAD's empty body", () => {
  assert.throws(() => parseResponse(Buffer.from("HTTP/1.1 200 OK\r\n")));
  assert.throws(() =>
    parseResponse(
      Buffer.from(
        "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n9\r\na",
      ),
    ),
  );
  assert.equal(
    parseResponse(Buffer.from("HTTP/1.1 200 OK\r\nContent-Length: 90\r\n\r\n"))
      .body,
    "",
  );
});

test("external targets fail before opening a network connection", async () => {
  await assert.rejects(
    rawHttps({ target: "example.com", ca: "unused" }),
    /owned daemon/,
  );
});

test("selection matrix retains empty presence and duplicate order", () => {
  assert.equal(
    AUTHORIZATION_SELECTION_CASES.find((value) => value.label === "absent")
      .browserEligible,
    true,
  );
  for (const value of AUTHORIZATION_SELECTION_CASES.filter(
    (value) => value.label !== "absent",
  )) {
    assert.equal(value.browserEligible, false);
    assert.ok(value.lines.length > 0);
  }
  assert.deepEqual(
    AUTHORIZATION_SELECTION_CASES.find(
      (value) => value.label === "duplicate-empty-first",
    ).lines,
    ["Authorization:", "Authorization: Bearer invalid-fixture"],
  );
  assert.deepEqual(
    AUTHORIZATION_SELECTION_CASES.find(
      (value) => value.label === "duplicate-empty-last",
    ).lines,
    ["Authorization: Bearer invalid-fixture", "Authorization:"],
  );
});
