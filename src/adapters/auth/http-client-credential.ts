/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { constants, type BigIntStats } from "node:fs";
import fs from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  DEFAULT_HOSTED_SECURITY_POLICY,
  evaluateOutboundCredentialTarget,
  parseOpaqueApiCredential,
} from "../../domain/auth-policy.js";
import type { HttpClientCredentialPort } from "../../ports/auth-port.js";

export interface HttpClientCredentialProviderOptions {
  readonly credentialFile?: string;
  readonly boundOrigin?: string;
}

type DenialCode = "ORIGIN_MISMATCH" | "HTTPS_REQUIRED" | "PROFILE_INVALID";
const DENIAL_MESSAGES: Readonly<Record<DenialCode, string>> = {
  ORIGIN_MISMATCH: "Client credential origin does not match target origin",
  HTTPS_REQUIRED: "HTTPS is required for client credentials",
  PROFILE_INVALID: "Client credential profile is invalid",
};

function deny(code: DenialCode) {
  return { ok: false as const, code, message: DENIAL_MESSAGES[code] };
}

function validMetadata(stat: BigIntStats, uid: number, maxBytes: number) {
  return (
    stat.isFile() &&
    stat.uid === BigInt(uid) &&
    (stat.mode & 0o7777n) === 0o600n &&
    stat.size > 0n &&
    stat.size <= BigInt(maxBytes)
  );
}

function sameMetadata(first: BigIntStats, second: BigIntStats) {
  return (
    first.dev === second.dev &&
    first.ino === second.ino &&
    first.uid === second.uid &&
    first.mode === second.mode &&
    first.size === second.size &&
    first.mtimeNs === second.mtimeNs &&
    first.ctimeNs === second.ctimeNs &&
    first.nlink === second.nlink
  );
}

async function readProtectedCredential(file: string): Promise<string> {
  const uid = process.getuid?.();
  if (uid === undefined || constants.O_NOFOLLOW === undefined)
    throw new Error("Protected credential files are unavailable");
  const path = resolve(file);
  const parent = dirname(path);
  if ((await fs.realpath(parent)) !== parent)
    throw new Error("Credential path contains a symlink");

  // Nonblocking open lets metadata reject FIFOs before any read can wait on a writer.
  const handle = await fs.open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const maxBytes =
      DEFAULT_HOSTED_SECURITY_POLICY.opaqueApiCredentialMaxBytes + 2;
    const before = await handle.stat({ bigint: true });
    if (!validMetadata(before, uid, maxBytes))
      throw new Error("Credential file metadata is invalid");
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        length,
        buffer.length - length,
        null,
      );
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const current = await fs.lstat(path, { bigint: true });
    if (
      length > maxBytes ||
      BigInt(length) !== before.size ||
      !validMetadata(after, uid, maxBytes) ||
      !validMetadata(current, uid, maxBytes) ||
      !sameMetadata(before, after) ||
      !sameMetadata(after, current) ||
      (await fs.realpath(parent)) !== parent
    )
      throw new Error("Credential file changed during resolution");
    // Key administration writes one trailing newline. No other padding is accepted.
    const credential = buffer
      .subarray(0, length)
      .toString("utf8")
      .replace(/\r?\n$/, "");
    if (!parseOpaqueApiCredential(credential).ok)
      throw new Error("Credential file material is invalid");
    return credential;
  } finally {
    await handle.close();
  }
}

export function createHttpClientCredentialProvider(
  options: HttpClientCredentialProviderOptions = {},
): HttpClientCredentialPort {
  const credentialFile =
    typeof options.credentialFile === "string" &&
    options.credentialFile.length > 0
      ? resolve(options.credentialFile)
      : options.credentialFile;
  const boundOrigin = options.boundOrigin;
  return {
    async resolveBearerForUrl({ targetUrl }) {
      if (credentialFile === undefined && boundOrigin === undefined)
        return { ok: true, bearerToken: null, boundOrigin: null };
      if (
        typeof credentialFile !== "string" ||
        credentialFile.length === 0 ||
        typeof boundOrigin !== "string" ||
        !evaluateOutboundCredentialTarget({
          boundOrigin,
          targetUrl: boundOrigin,
        }).ok
      )
        return deny("PROFILE_INVALID");
      const target = evaluateOutboundCredentialTarget({
        boundOrigin,
        targetUrl,
      });
      if (!target.ok) return deny(target.code);
      try {
        const bearerToken = await readProtectedCredential(credentialFile);
        return { ok: true, bearerToken, boundOrigin };
      } catch {
        return deny("PROFILE_INVALID");
      }
    },
  };
}
