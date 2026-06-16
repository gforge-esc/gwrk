/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * US-003.1: Strip ANSI escape sequences from a string.
 */
export function stripAnsi(s: string): string {
  // Common ANSI escape sequence regex
  return s.replace(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are intentional here
    /[\u001b\u009b][\[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    "",
  );
}

/**
 * US-003.2: Detect binary content (null bytes or >30% non-printable)
 * and replace with a descriptor.
 */
export function guardBinary(s: string): string {
  if (!s) return s;

  // Check for null bytes
  if (s.includes("\0")) {
    return `[binary content, ${Buffer.byteLength(s)} bytes]`;
  }

  // Check for non-printable characters (>30%)
  // Printable: 32-126, plus \n (10), \r (13), \t (9)
  let nonPrintableCount = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const isPrintable =
      (code >= 32 && code <= 126) || code === 10 || code === 13 || code === 9;
    if (!isPrintable) {
      nonPrintableCount++;
    }
  }

  if (nonPrintableCount / s.length > 0.3) {
    return `[binary content, ${Buffer.byteLength(s)} bytes]`;
  }

  return s;
}

/**
 * US-003.3: Truncate output if it exceeds 8192 bytes.
 * Saves full output to a temporary file and returns first 100 lines.
 */
export function truncateOverflow(s: string): string {
  const LIMIT = 8192;
  if (Buffer.byteLength(s) <= LIMIT) {
    return s;
  }

  const hash = crypto.createHash("md5").update(s).digest("hex").slice(0, 8);
  const tmpPath = `/tmp/gwrk-output-${hash}.txt`;

  try {
    fs.writeFileSync(tmpPath, s);
  } catch (err) {
    // If we can't write to /tmp (unlikely on Darwin), just proceed with truncation
  }

  const lines = s.split("\n");
  const truncated = lines.slice(0, 100).join("\n");

  return `${truncated}\n\n[output truncated, full log saved to ${tmpPath}]`;
}

/**
 * TC-006: Compose Layer 2 protections for agent consumption.
 */
export function processForAgent(output: string): string {
  if (!output) return output;

  let result = stripAnsi(output);
  result = guardBinary(result);

  // If it's already identified as binary, don't try to truncate lines
  if (result.startsWith("[binary content")) {
    return result;
  }

  result = truncateOverflow(result);
  return result;
}
