#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

// 1. Mandatory operator authority check
if (process.env.GWRK_OPERATOR_LIVE_ACCEPTANCE !== "1") {
  fail(
    "live acceptance requires the authorized coordinator with GWRK_OPERATOR_LIVE_ACCEPTANCE=1",
  );
}

// 2. Parse arguments
const args = process.argv.slice(2);
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
  } else if (arg.startsWith("--origin=")) {
    options.target = arg.slice("--origin=".length);
  } else if (arg === "--origin" && i + 1 < args.length) {
    options.target = args[++i];
  }
}

// 3. Reject synthetic or loopback probe targets
if (options.target) {
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

  const hostname = parsedUrl.hostname.toLowerCase();
  const syntheticHosts = ["localhost", "127.0.0.1", "::1", "0.0.0.0"];
  const syntheticSuffixes = [".invalid", ".example", ".test", ".local"];

  if (
    syntheticHosts.includes(hostname) ||
    syntheticSuffixes.some((suffix) => hostname.endsWith(suffix))
  ) {
    fail(
      `Rejected synthetic / localhost target: ${hostname}. Live acceptance requires real operator infrastructure.`,
    );
  }
}

// 4. Validate acceptance record
const recordPath = options.record
  ? path.resolve(options.record)
  : path.resolve("specs/051-hosted-aws-pilot/evidence/live-acceptance.md");

if (!fs.existsSync(recordPath)) {
  fail(`Live acceptance record not found: ${recordPath}`);
}

const recordContent = fs.readFileSync(recordPath, "utf8");

// Refuse to pass pending records
if (/pending|unperformed|unverified|template/i.test(recordContent)) {
  fail(
    `Live acceptance record ${path.basename(recordPath)} contains pending checks. Refusing to pass incomplete live acceptance.`,
  );
}

// Verify required probe domains from TR-021
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

const missing = [];
for (const check of requiredChecks) {
  const pattern = new RegExp(check, "i");
  if (!pattern.test(recordContent)) {
    missing.push(check);
  }
}

if (missing.length > 0) {
  fail(
    `Live acceptance record lacks required live observations: ${missing.join(", ")}`,
  );
}

// Check for explicit PASS verdict
if (!/verdict:\s*pass/i.test(recordContent)) {
  fail("Live acceptance record lacks verified PASS verdict.");
}

console.log(`Live security acceptance verified: ${recordPath}`);
process.exit(0);
