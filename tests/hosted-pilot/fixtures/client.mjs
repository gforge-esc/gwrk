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
  });
  for (const value of response.values("set-cookie")) {
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
      status: response.status,
      fields: response.fields,
      body: response.body,
    }),
  );
} catch {
  process.stdout.write(JSON.stringify({ failed: true }));
  process.exitCode = 1;
}
