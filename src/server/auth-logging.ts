/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Writable } from "node:stream";
import type { FastifyLoggerOptions } from "fastify";
import { redactAuthText } from "../domain/auth-policy.js";

const REDACTED = "[REDACTED]";

export function sanitizeText(text: string): string {
  if (!text) return "";
  let s = text;
  // JWT tokens (three dot-separated base64 segments)
  s = s.replace(
    /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    REDACTED,
  );
  // gwrk API key credentials (e.g. gwrk_v1.cred-id.secret)
  s = s.replace(/\bgwrk_v\d+\.[A-Za-z0-9_.-]+/g, REDACTED);
  // Authorization Bearer tokens
  s = s.replace(/\b(Bearer)\s+[^\s,;?&#"]+/gi, `$1 ${REDACTED}`);
  // Cookie values for session and csrf
  s = s.replace(
    /(\b(?:__Host-gwrk_[A-Za-z0-9_]+|_oauth2_proxy(?:_\d+)?)\s*=\s*)[^;\s,"']+/gi,
    `$1${REDACTED}`,
  );
  // Query parameter values: ?foo=bar or &foo=bar
  s = s.replace(/([?&][A-Za-z0-9_-]+=)[^&#\s,"']+/g, `$1${REDACTED}`);
  // Pass through central domain redaction
  s = redactAuthText(s);
  return s;
}

export function sanitizeHeaders(
  headers: unknown,
): Record<string, unknown> | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(
    headers as Record<string, unknown>,
  )) {
    const lower = key.trim().toLowerCase();
    if (
      lower === "authorization" ||
      lower === "cookie" ||
      lower === "set-cookie" ||
      lower === "proxy-authorization" ||
      lower.includes("csrf") ||
      lower.includes("token") ||
      lower.includes("cookie") ||
      lower.includes("auth") ||
      lower.includes("secret") ||
      lower.includes("key") ||
      lower.includes("credential")
    ) {
      if (Array.isArray(value)) {
        result[key] = value.map(() => REDACTED);
      } else {
        result[key] = REDACTED;
      }
    } else if (typeof value === "string") {
      result[key] = sanitizeText(value);
    } else if (Array.isArray(value)) {
      result[key] = value.map((entry) =>
        typeof entry === "string" ? sanitizeText(entry) : entry,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function serializeRequest(req: unknown): Record<string, unknown> {
  if (!req || typeof req !== "object") return {};
  const r = req as Record<string, unknown>;
  const rawUrl = typeof r.url === "string" ? r.url : "";
  const sanitizedUrl = rawUrl.split("?")[0];
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

export function serializeError(err: unknown): {
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
    type: e.name || e.constructor?.name || "Error",
    message: sanitizeText(e.message ?? ""),
    stack: sanitizeText(e.stack ?? ""),
  };
  if (e.code !== undefined) {
    result.code = typeof e.code === "string" ? sanitizeText(e.code) : e.code;
  }
  if (e.cause !== undefined) {
    result.cause = serializeError(e.cause);
  }
  if (Array.isArray(e.errors)) {
    result.errors = e.errors.map(serializeError);
  }
  return result;
}

class SanitizingStream extends Writable {
  constructor(private readonly destination: Writable) {
    super();
  }

  override _write(
    chunk: unknown,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const raw = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    const sanitized = sanitizeText(raw);
    this.destination.write(sanitized, "utf8", callback);
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
