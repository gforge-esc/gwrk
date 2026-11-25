#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export async function runLiveAcceptanceGate({
  args = process.argv.slice(2),
  env = process.env,
  probeFn,
} = {}) {
  function fail(message) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }

  // 1. Mandatory operator authority check
  if (env.GWRK_OPERATOR_LIVE_ACCEPTANCE !== "1") {
    fail(
      "live acceptance requires the authorized coordinator with GWRK_OPERATOR_LIVE_ACCEPTANCE=1",
    );
  }

  // 2. Parse arguments and reject unknown flags
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--mode=")) {
      options.mode = arg.slice("--mode=".length);
    } else if (arg === "--mode" && i + 1 < args.length) {
      options.mode = args[++i];
    } else if (arg.startsWith("--record=")) {
      options.record = arg.slice("--record=".length);
    } else if (arg === "--record" && i + 1 < args.length) {
      options.record = args[++i];
    } else if (arg.startsWith("--target=")) {
      options.target = arg.slice("--target=".length);
    } else if (arg === "--target" && i + 1 < args.length) {
      options.target = args[++i];
    } else {
      fail(`Unknown or unsupported CLI argument: ${arg}`);
    }
  }

  // 3. Mode validation: must be --mode=live
  if (options.mode !== "live") {
    fail(
      `Rejected mode: ${options.mode ?? "missing"}. Live acceptance requires --mode=live.`,
    );
  }

  // 4. Target validation: require --target=<https-url>
  if (!options.target) {
    fail("Missing required --target=<https-url> argument for live acceptance.");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(options.target);
  } catch {
    fail(`Invalid probe target URL: ${options.target}`);
  }

  if (parsedUrl.protocol !== "https:") {
    fail(
      `Rejected non-HTTPS probe target: ${options.target}. Real HTTPS target is required.`,
    );
  }

  let hostname = parsedUrl.hostname.toLowerCase();
  hostname = hostname.replace(/\.+$/, "");
  hostname = hostname.replace(/^\[|\]$/g, "");

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "local" ||
    hostname.endsWith(".local") ||
    hostname === "invalid" ||
    hostname.endsWith(".invalid") ||
    hostname === "example.com" ||
    hostname.endsWith(".example.com") ||
    hostname === "example.org" ||
    hostname.endsWith(".example.org") ||
    hostname === "example.net" ||
    hostname.endsWith(".example.net")
  ) {
    fail(
      `Rejected synthetic or reserved target hostname: ${hostname}. Live acceptance requires real operator infrastructure.`,
    );
  }

  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(
    hostname,
  );
  if (ipv4Match) {
    const [, aStr, bStr, cStr, dStr] = ipv4Match;
    const [a, b, c, d] = [
      Number(aStr),
      Number(bStr),
      Number(cStr),
      Number(dStr),
    ];
    if (a > 255 || b > 255 || c > 255 || d > 255) {
      fail(`Invalid IPv4 address: ${hostname}`);
    }
    if (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0
    ) {
      fail(
        `Rejected private, loopback, or link-local IPv4 address: ${hostname}`,
      );
    }
  }

  if (
    hostname.includes(":") ||
    hostname === "::1" ||
    hostname.startsWith("fe80:") ||
    hostname.startsWith("fc00:") ||
    hostname.startsWith("fd00:") ||
    hostname.includes("::ffff:")
  ) {
    fail(`Rejected IPv6 literal or loopback/private target: ${hostname}`);
  }

  // 5. Validate acceptance record
  const recordPath = options.record
    ? path.resolve(options.record)
    : path.resolve("specs/051-hosted-aws-pilot/evidence/live-acceptance.md");

  if (!fs.existsSync(recordPath)) {
    fail(`Live acceptance record not found: ${recordPath}`);
  }

  const recordContent = fs.readFileSync(recordPath, "utf8");

  if (
    /\b(pending|tbd|todo|fail|synthetic)\b|localhost|127\.0\.0\.1|::1|example\.invalid/i.test(
      recordContent,
    )
  ) {
    fail(
      `Live acceptance record ${path.basename(recordPath)} contains pending, failing, or synthetic markers. Refusing to pass incomplete live acceptance.`,
    );
  }

  const targetHost = parsedUrl.host;
  const targetOrigin = parsedUrl.origin;
  if (
    !recordContent.includes(targetHost) &&
    !recordContent.includes(targetOrigin)
  ) {
    fail(
      `Live acceptance record does not match target host/origin: ${targetHost}`,
    );
  }

  if (!/verdict:\s*pass/i.test(recordContent)) {
    fail("Live acceptance record lacks verified PASS verdict.");
  }

  const requiredChecks = [
    "Google login",
    "Google denial",
    "API key lifecycle",
    "cross-project denial",
    "private origin",
    "header forgery",
    "CSRF",
    "logout replay",
    "webhook HMAC",
    "restart",
    "reboot",
    "restore",
    "zero leaked tokens",
  ];

  const lines = recordContent.split("\n");
  for (let i = 0; i < requiredChecks.length; i++) {
    const checkName = requiredChecks[i];
    const checkPattern = new RegExp(checkName, "i");
    const checkIdPattern = new RegExp(`\\bLA-0*${i + 1}\\b`, "i");
    const matchingLine = lines.find(
      (line) => checkPattern.test(line) || checkIdPattern.test(line),
    );
    if (!matchingLine) {
      fail(
        `Live acceptance record lacks required observation row: ${checkName}`,
      );
    }
    if (!/\bPASS\b/.test(matchingLine)) {
      fail(
        `Live acceptance check row '${checkName}' does not carry explicit PASS: ${matchingLine.trim()}`,
      );
    }
  }

  // 6. Real HTTPS probe
  if (probeFn) {
    await probeFn(`${parsedUrl.origin}/health`);
  } else {
    try {
      const res = await fetch(`${parsedUrl.origin}/health`, {
        signal: AbortSignal.timeout(10000),
      });
      if (
        !res.ok &&
        res.status !== 200 &&
        res.status !== 401 &&
        res.status !== 403
      ) {
        fail(`HTTPS probe failed with status ${res.status}`);
      }
    } catch (err) {
      fail(`HTTPS probe against ${parsedUrl.origin} failed: ${err.message}`);
    }
  }

  console.log(`Live security acceptance verified: ${recordPath}`);
  process.exit(0);
}

if (
  process.argv[1] &&
  (process.argv[1] === import.meta.filename ||
    process.argv[1].endsWith("live-acceptance-gate.mjs"))
) {
  runLiveAcceptanceGate();
}
