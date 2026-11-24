/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Writable } from "node:stream";
import type { FastifyLoggerOptions } from "fastify";
import {
  isForbiddenPublicIdentityHeader,
  redactAuthHeaders,
  redactAuthText,
  redactAuthUrl,
} from "../domain/auth-policy.js";

const REDACTED = "[REDACTED]";

const EXACT_SENSITIVE_FIELDS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-gwrk-csrf-token",
  "x-csrf-token",
]);

function applyJsonSafeRedaction(text: string): string {
  if (!text) return "";
  let s = text;
  // JWT tokens (three dot-separated base64 segments)
  s = s.replace(
    /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    REDACTED,
  );
  // gwrk API key credentials (e.g. gwrk_v1.cred-id.secret)
  s = s.replace(/\bgwrk_v\d+\.[A-Za-z0-9_.-]+/g, REDACTED);
  // Authorization Bearer tokens (JSON-quote and escape safe)
  s = s.replace(/\b(Bearer)\s+[^\s,;?&#"\\]+/gi, `$1 ${REDACTED}`);
  // Cookie values for session and csrf (JSON-quote and escape safe)
  s = s.replace(
    /(\b(?:__Host-gwrk_[A-Za-z0-9_]+|_oauth2_proxy(?:_\d+)?)\s*=\s*)[^;\s,"'\\]+/gi,
    `$1${REDACTED}`,
  );
  // Query and fragment parameter values (JSON-quote and escape safe)
  s = s.replace(/([?&#][A-Za-z0-9_-]+=)[^&#\s,"'\\]+/g, `$1${REDACTED}`);
  return s;
}

export function sanitizeText(text: string): string {
  if (!text) return "";
  let s = applyJsonSafeRedaction(text);
  // Pass through central domain redaction on plain unencoded field text
  s = redactAuthText(s);
  return s;
}

function isSensitiveHeaderName(key: string): boolean {
  const lower = key.trim().toLowerCase();
  return (
    isForbiddenPublicIdentityHeader(lower) ||
    EXACT_SENSITIVE_FIELDS.has(lower) ||
    lower.includes("csrf") ||
    lower.includes("token") ||
    lower.includes("cookie") ||
    lower.includes("auth") ||
    lower.includes("secret") ||
    lower.includes("key") ||
    lower.includes("credential")
  );
}

export function sanitizeHeaders(
  headers: unknown,
): Record<string, unknown> | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const rawRecord = headers as Record<string, unknown>;
  const stringHeaders: Record<string, string | readonly string[] | undefined> =
    {};
  for (const [key, value] of Object.entries(rawRecord)) {
    if (typeof value === "string") {
      stringHeaders[key] = value;
    } else if (
      Array.isArray(value) &&
      value.every((entry) => typeof entry === "string")
    ) {
      stringHeaders[key] = value;
    }
  }
  const domainRedacted = redactAuthHeaders(stringHeaders);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawRecord)) {
    if (isSensitiveHeaderName(key)) {
      result[key] = Array.isArray(value) ? value.map(() => REDACTED) : REDACTED;
      continue;
    }
    const base = key in domainRedacted ? domainRedacted[key] : value;
    if (typeof base === "string") {
      result[key] = sanitizeText(base);
    } else if (Array.isArray(base)) {
      result[key] = base.map((entry) =>
        typeof entry === "string" ? sanitizeText(entry) : entry,
      );
    } else {
      result[key] = base;
    }
  }
  return result;
}

export function serializeRequest(req: unknown): Record<string, unknown> {
  if (!req || typeof req !== "object") return {};
  const r = req as Record<string, unknown>;
  const rawUrl = typeof r.url === "string" ? r.url : "";
  const pathOnly = rawUrl.split(/[?#]/, 1)[0] ?? "";
  const sanitizedUrl = sanitizeText(redactAuthUrl(pathOnly));
  const rawHeaders =
    (r.raw as Record<string, unknown> | undefined)?.headers ??
    (r.headers as Record<string, unknown> | undefined);
  return {
    method: r.method,
    url: sanitizedUrl,
    host: r.host ?? r.hostname,
    remoteAddress:
      r.remoteAddress ??
      (r.raw as { socket?: { remoteAddress?: string } } | undefined)?.socket
        ?.remoteAddress,
    remotePort:
      r.remotePort ??
      (r.raw as { socket?: { remotePort?: number } } | undefined)?.socket
        ?.remotePort,
    headers: sanitizeHeaders(rawHeaders),
  };
}

export function serializeResponse(res: unknown): Record<string, unknown> {
  if (!res || typeof res !== "object") return {};
  const r = res as Record<string, unknown> & {
    getHeaders?: () => Record<string, unknown>;
    raw?: {
      statusCode?: number;
      getHeaders?: () => Record<string, unknown>;
    };
  };
  const statusCode = r.statusCode ?? r.raw?.statusCode;
  const rawHeaders =
    typeof r.getHeaders === "function"
      ? r.getHeaders()
      : typeof r.raw?.getHeaders === "function"
        ? r.raw.getHeaders()
        : (r.headers as Record<string, unknown> | undefined);
  const headers = sanitizeHeaders(rawHeaders);
  return {
    statusCode,
    ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
  };
}

function serializeErrorInternal(
  err: unknown,
  seen: WeakSet<object>,
): {
  type: string;
  message: string;
  stack: string;
  [key: string]: unknown;
} {
  if (!err) {
    return { type: "Error", message: "", stack: "" };
  }
  if (typeof err !== "object") {
    return { type: "Error", message: sanitizeText(String(err)), stack: "" };
  }
  if (seen.has(err)) {
    return { type: "Circular", message: "[Circular]", stack: "" };
  }
  seen.add(err);
  const e = err as {
    name?: string;
    message?: string;
    stack?: string;
    code?: unknown;
    cause?: unknown;
    errors?: unknown[];
    constructor?: { name?: string };
  };
  const result: {
    type: string;
    message: string;
    stack: string;
    [key: string]: unknown;
  } = {
    type:
      typeof e.name === "string" && e.name.length > 0
        ? e.name
        : e.constructor?.name || "Error",
    message: sanitizeText(typeof e.message === "string" ? e.message : ""),
    stack: sanitizeText(typeof e.stack === "string" ? e.stack : ""),
  };
  if (e.code !== undefined) {
    result.code = typeof e.code === "string" ? sanitizeText(e.code) : e.code;
  }
  if (e.cause !== undefined) {
    result.cause = serializeErrorInternal(e.cause, seen);
  }
  if (Array.isArray(e.errors)) {
    result.errors = e.errors.map((nested) =>
      serializeErrorInternal(nested, seen),
    );
  }
  return result;
}

export function serializeError(err: unknown): {
  type: string;
  message: string;
  stack: string;
  [key: string]: unknown;
} {
  return serializeErrorInternal(err, new WeakSet<object>());
}

function sanitizeStructuredValue(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeText(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeStructuredValue);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const lower = key.trim().toLowerCase();
      if (
        lower === "headers" &&
        entry &&
        typeof entry === "object" &&
        !Array.isArray(entry)
      ) {
        out[key] = sanitizeHeaders(entry);
      } else if (
        isForbiddenPublicIdentityHeader(lower) ||
        EXACT_SENSITIVE_FIELDS.has(lower)
      ) {
        out[key] = Array.isArray(entry) ? entry.map(() => REDACTED) : REDACTED;
      } else {
        out[key] = sanitizeStructuredValue(entry);
      }
    }
    return out;
  }
  return value;
}

function sanitizeLogLine(line: string): string {
  if (!line) return "";
  try {
    const parsed: unknown = JSON.parse(line);
    return JSON.stringify(sanitizeStructuredValue(parsed));
  } catch {
    return applyJsonSafeRedaction(line);
  }
}

class SanitizingStream extends Writable {
  private pending = "";

  constructor(private readonly destination: Writable) {
    super();
  }

  override _write(
    chunk: unknown,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const raw = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    const combined = this.pending + raw;
    const lines = combined.split("\n");
    this.pending = lines.pop() ?? "";
    if (lines.length === 0) {
      callback();
      return;
    }
    const output = `${lines.map(sanitizeLogLine).join("\n")}\n`;
    this.destination.write(output, "utf8", callback);
  }

  override _final(callback: (error?: Error | null) => void): void {
    if (this.pending.length === 0) {
      callback();
      return;
    }
    const flushed = sanitizeLogLine(this.pending);
    this.pending = "";
    this.destination.write(flushed, "utf8", callback);
  }
}

export interface SanitizedLoggerOptionsInput {
  stream?: Writable;
  level?: string;
}

export function createSanitizedLoggerOptions(
  options?: SanitizedLoggerOptionsInput,
): FastifyLoggerOptions {
  const destStream = options?.stream ?? process.stdout;
  const wrappedStream = new SanitizingStream(destStream);
  return {
    level: options?.level ?? "info",
    stream: wrappedStream as unknown as FastifyLoggerOptions["stream"],
    serializers: {
      req: serializeRequest,
      res: serializeResponse,
      err: serializeError,
    },
  };
}
