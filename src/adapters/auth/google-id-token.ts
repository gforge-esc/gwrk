/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash } from "node:crypto";
import {
  createRemoteJWKSet,
  customFetch,
  decodeProtectedHeader,
  errors,
  jwtVerify,
} from "jose";
import {
  ALLOWED_GOOGLE_ISSUERS,
  DEFAULT_HOSTED_SECURITY_POLICY,
  type HostedSecurityPolicy,
  HostedSecurityPolicySchema,
  evaluateGoogleTokenClaims,
  validateGoogleTokenHeader,
} from "../../domain/auth-policy.js";
import type { GoogleIdentityVerifierPort } from "../../ports/auth-port.js";

export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

type JwksFetch = (
  url: string,
  options: {
    method: "GET";
    redirect: "manual";
    signal: AbortSignal;
    headers: Headers;
  },
) => Promise<Response>;

export interface GoogleIdentityVerifierOptions {
  readonly clientId: string;
  readonly readAllowlist: () => Promise<readonly string[]>;
  readonly fetch?: JwksFetch;
  readonly policy?: HostedSecurityPolicy;
}

class VerifierUnavailable extends Error {}

function untilAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new VerifierUnavailable());
    if (signal.aborted) {
      reject(new VerifierUnavailable());
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

function boundedFetch(
  fetcher: JwksFetch,
  policy: HostedSecurityPolicy,
): JwksFetch {
  return async (url, options) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal.addEventListener("abort", abort, { once: true });
    if (options.signal.aborted) controller.abort();
    const timeout = setTimeout(abort, policy.jwksRequestTimeoutSeconds * 1000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let complete = false;
    try {
      if (url !== GOOGLE_JWKS_URL) throw new VerifierUnavailable();
      const responsePromise = fetcher(url, {
        ...options,
        redirect: "manual",
        signal: controller.signal,
      });
      // A late transport response must not retain a live body after the deadline.
      void responsePromise.then(
        (response) => {
          if (controller.signal.aborted)
            void response.body?.cancel().catch(() => {});
        },
        () => {},
      );
      const response = await untilAbort(responsePromise, controller.signal);
      if (!response.body) throw new VerifierUnavailable();
      reader = response.body.getReader();
      if (response.status !== 200) throw new VerifierUnavailable();
      const contentLength = response.headers.get("content-length");
      if (
        contentLength !== null &&
        Number(contentLength) > policy.jwksResponseMaxBytes
      ) {
        throw new VerifierUnavailable();
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunk = await untilAbort(reader.read(), controller.signal);
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > policy.jwksResponseMaxBytes) throw new VerifierUnavailable();
        chunks.push(chunk.value);
      }
      const data = Buffer.concat(chunks, size);
      const parsed: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(data),
      );
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("keys" in parsed) ||
        !Array.isArray(parsed.keys) ||
        parsed.keys.length > policy.jwksCacheKeyCount
      )
        throw new VerifierUnavailable();
      complete = true;
      return Response.json(parsed);
    } catch {
      throw new VerifierUnavailable();
    } finally {
      clearTimeout(timeout);
      options.signal.removeEventListener("abort", abort);
      if (!complete) {
        controller.abort();
        void reader?.cancel().catch(() => {});
      }
      reader?.releaseLock();
    }
  };
}

export function createGoogleIdentityVerifier(
  options: GoogleIdentityVerifierOptions,
): GoogleIdentityVerifierPort {
  if (
    !options.clientId?.trim() ||
    typeof options.readAllowlist !== "function"
  ) {
    throw new Error(
      "Google verifier requires an audience and allowlist reader",
    );
  }
  const policy = HostedSecurityPolicySchema.parse(
    options.policy ?? DEFAULT_HOSTED_SECURITY_POLICY,
  );
  const clientId = options.clientId;
  const readAllowlist = options.readAllowlist;
  const resolver = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL), {
    timeoutDuration: policy.jwksRequestTimeoutSeconds * 1000,
    cacheMaxAge: policy.jwksCacheAgeSeconds * 1000,
    cooldownDuration: policy.unknownKeyRefreshCooldownSeconds * 1000,
    [customFetch]: boundedFetch(options.fetch ?? fetch, policy),
  });

  return {
    async verifyIdToken({ token, nowMs }) {
      try {
        const rawTokenBytes = Buffer.byteLength(token, "utf8");
        if (
          !Number.isFinite(nowMs) ||
          rawTokenBytes > policy.googleIdTokenMaxBytes
        ) {
          return {
            ok: false,
            code: "AUTH_TOKEN_INVALID",
            message: "Google ID token is invalid",
          };
        }
        const header = decodeProtectedHeader(token);
        const headerResult = validateGoogleTokenHeader({
          ...header,
          rawTokenBytes,
          policy,
        });
        if (!headerResult.ok) return headerResult;
        const { payload } = await jwtVerify(token, resolver, {
          algorithms: ["RS256"],
          issuer: [...ALLOWED_GOOGLE_ISSUERS],
          audience: clientId,
          requiredClaims: ["iss", "aud", "sub", "iat", "exp"],
          currentDate: new Date(nowMs),
          clockTolerance: 0,
        });
        let allowlist: readonly string[];
        try {
          allowlist = await readAllowlist();
        } catch {
          return {
            ok: false,
            code: "AUTH_ACCOUNT_DENIED",
            message: "Google account allowlist is unavailable",
          };
        }
        const result = evaluateGoogleTokenClaims({
          issuer: payload.iss,
          audience: payload.aud,
          expectedAudience: clientId,
          subject: payload.sub,
          email: typeof payload.email === "string" ? payload.email : undefined,
          emailVerified: payload.email_verified === true,
          issuedAtSeconds: payload.iat,
          expiresAtSeconds: payload.exp,
          nowMs,
          allowlist,
          policy,
        });
        if (!result.ok) return result;
        const { ok: _ok, ...claims } = result;
        return {
          ok: true,
          claims: {
            ...claims,
            tokenDigestSha256: createHash("sha256").update(token).digest("hex"),
          },
        };
      } catch (error) {
        if (error instanceof errors.JWTExpired) {
          return {
            ok: false,
            code: "AUTH_TOKEN_EXPIRED",
            message: "Google ID token has expired",
          };
        }
        if (
          error instanceof VerifierUnavailable ||
          error instanceof errors.JWKSNoMatchingKey ||
          error instanceof errors.JWKSTimeout ||
          error instanceof errors.JWKSInvalid
        ) {
          return {
            ok: false,
            code: "AUTH_VERIFIER_UNAVAILABLE",
            message: "Google ID token verification is unavailable",
          };
        }
        return {
          ok: false,
          code: "AUTH_TOKEN_INVALID",
          message: "Google ID token is invalid",
        };
      }
    },
  };
}
