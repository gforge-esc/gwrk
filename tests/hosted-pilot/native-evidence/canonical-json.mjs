/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash } from "node:crypto";

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function assertNoForbiddenKey(key) {
  if (FORBIDDEN_KEYS.has(key)) {
    throw new Error(`Forbidden key in canonical JSON: ${key}`);
  }
}

/**
 * Serializes a JavaScript value to canonical JSON.
 * - Object keys are sorted lexicographically by Unicode code point.
 * - Array element order is preserved.
 * - No whitespace between tokens.
 * - Throws on NaN, Infinity, -Infinity, undefined, functions, and symbols.
 * - Throws on forbidden prototype keys (__proto__, constructor, prototype).
 */
export function toCanonicalJson(value) {
  if (value === undefined) {
    throw new Error("undefined is not allowed in canonical JSON");
  }
  if (typeof value === "function" || typeof value === "symbol") {
    throw new Error("Functions and symbols are not allowed in canonical JSON");
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("NaN and Infinity are not allowed in canonical JSON");
    }
    return JSON.stringify(value);
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const elements = [];
    for (let i = 0; i < value.length; i++) {
      if (!Object.hasOwn(value, i)) {
        throw new Error(
          `Sparse array with missing element at index ${i} is not allowed in canonical JSON`,
        );
      }
      const item = value[i];
      if (item === undefined) {
        throw new Error(
          "undefined elements are not allowed in arrays in canonical JSON",
        );
      }
      elements.push(toCanonicalJson(item));
    }
    return `[${elements.join(",")}]`;
  }

  const obj = value;
  const rawKeys = Object.keys(obj);
  for (const key of rawKeys) {
    assertNoForbiddenKey(key);
  }

  const sortedKeys = rawKeys.sort((a, b) => {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });

  const entries = [];
  for (const key of sortedKeys) {
    const val = obj[key];
    if (val === undefined) {
      throw new Error(
        `undefined property value for key '${key}' in canonical JSON`,
      );
    }
    entries.push(`${JSON.stringify(key)}:${toCanonicalJson(val)}`);
  }

  return `{${entries.join(",")}}`;
}

/**
 * Computes the SHA-256 digest of the canonical JSON representation of a value.
 */
export function canonicalJsonSha256(value) {
  return createHash("sha256")
    .update(toCanonicalJson(value), "utf8")
    .digest("hex");
}

/**
 * Parses JSON bytes/string and verifies that the raw representation
 * matches its canonical encoding exactly.
 *
 * Uses TextDecoder with fatal: true for buffers.
 * Recursively rejects __proto__, constructor, and prototype keys.
 */
export function parseAndVerifyCanonicalJson(raw) {
  let text;
  if (typeof raw === "string") {
    text = raw;
  } else if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    text = decoder.decode(raw);
  } else {
    throw new Error("Input must be a string or Buffer/Uint8Array");
  }

  const withoutTrailingNewline = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (withoutTrailingNewline.endsWith("\n")) {
    throw new Error(
      "Canonical JSON must not contain multiple trailing newlines",
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(withoutTrailingNewline, (key, value) => {
      assertNoForbiddenKey(key);
      return value;
    });
  } catch (error) {
    throw new Error(`Malformed JSON: ${error.message}`);
  }

  function checkForbidden(val) {
    if (val === null || typeof val !== "object") return;
    if (Array.isArray(val)) {
      for (const item of val) checkForbidden(item);
      return;
    }
    for (const k of Object.keys(val)) {
      assertNoForbiddenKey(k);
      checkForbidden(val[k]);
    }
  }
  checkForbidden(parsed);

  const canonical = toCanonicalJson(parsed);
  if (withoutTrailingNewline !== canonical) {
    throw new Error(
      "Canonical JSON validation failed: input contains duplicate keys, unsorted keys, or non-canonical formatting",
    );
  }

  return parsed;
}
