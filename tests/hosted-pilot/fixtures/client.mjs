import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { rawHttps } from "./raw-https.mjs";

// This process is an IPC endpoint inside an owned client container. Its JSON output
// returns to the controller in memory and must never be copied into evidence logs.
let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
  if (Buffer.byteLength(input) > 32768)
    throw new Error("fixture input exceeds bound");
}
try {
  const command = JSON.parse(input);
  const jarPath = "/tmp/fixture-cookie-jar.json";
  let jar = {};
  try {
    jar = JSON.parse(readFileSync(jarPath, "utf8"));
  } catch {}
  if (command.operation === "snapshot") {
    process.stdout.write(JSON.stringify({ cookieJar: jar }));
  } else if (command.operation === "reset") {
    writeFileSync(jarPath, "{}", { mode: 0o600 });
    process.stdout.write(JSON.stringify({ reset: true }));
  } else {
    if (command.restoreCookies !== undefined) {
      assert.ok(
        command.restoreCookies &&
          typeof command.restoreCookies === "object" &&
          Object.keys(command.restoreCookies).length <= 32,
      );
      for (const [name, value] of Object.entries(command.restoreCookies)) {
        assert.match(name, /^[A-Za-z0-9_-]{1,128}$/);
        assert.ok(
          typeof value === "string" &&
            value.length <= 16384 &&
            !/[;\r\n]/.test(value),
        );
      }
      jar = { ...command.restoreCookies };
    }
    const headers = [...(command.headers ?? [])];
    if (command.cookie !== false && Object.keys(jar).length)
      headers.push(
        `Cookie: ${Object.entries(jar)
          .map(([key, value]) => `${key}=${value}`)
          .join("; ")}`,
      );
    const response = await rawHttps({
      ca: readFileSync("/fixture/public/ca.pem"),
      path: command.path,
      method: command.method ?? "GET",
      headers,
      body: command.body ?? "",
      timeoutMs: command.timeoutMs ?? 5000,
      cancelAfterMs: command.cancelAfterMs,
      servername: command.servername,
    });
    for (const value of response.cancelled
      ? []
      : response.values("set-cookie")) {
      const pair = value.split(";")[0];
      const equals = pair.indexOf("=");
      if (equals > 0) {
        const name = pair.slice(0, equals);
        const cookie = pair.slice(equals + 1);
        if (cookie) jar[name] = cookie;
        else delete jar[name];
      }
    }
    writeFileSync(jarPath, JSON.stringify(jar), { mode: 0o600 });
    process.stdout.write(
      JSON.stringify({
        cancelled: response.cancelled,
        status: response.status,
        requestProof: {
          method: command.method ?? "GET",
          path: (command.path ?? "/").split("?")[0],
          querySha256: createHash("sha256")
            .update(
              (command.path ?? "").includes("?")
                ? command.path.slice(command.path.indexOf("?") + 1)
                : "",
            )
            .digest("hex"),
          cookieSha256: createHash("sha256")
            .update(
              headers
                .filter((line) => /^cookie:/i.test(line))
                .map((line) => line.slice(line.indexOf(":") + 1).trim())
                .join("; "),
            )
            .digest("hex"),
        },
        fields: response.fields,
        body: response.body,
      }),
    );
  }
} catch {
  process.stdout.write(JSON.stringify({ failed: true }));
  process.exitCode = 1;
}
