import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { runInNewContext } from "node:vm";

// Serve the packaged response. Unknown paths must fail like the hosted origin.
const source = readFileSync(
  new URL("../../src/server/routes/portal-html.ts", import.meta.url),
  "utf8",
);
const html = runInNewContext(
  source
    .slice(
      source.indexOf("export const LOGIN_ENTRY =") +
        "export const LOGIN_ENTRY =".length,
    )
    .trim()
    .replace(/;$/, ""),
);
createServer((req, res) => {
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  } else if (req.url === "/api/auth/session") {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, code: "AUTH_REQUIRED" }));
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(18793, "127.0.0.1");
