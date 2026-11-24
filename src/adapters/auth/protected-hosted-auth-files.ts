/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import childProcess from "node:child_process";
import { constants, type BigIntStats } from "node:fs";
import fs from "node:fs/promises";
import { posix } from "node:path";
import { validateAccountAllowlist } from "../../domain/auth-policy.js";
import { HostedAuthConfigInputSchema } from "../../domain/hosted-auth-config.js";

export interface ProtectedHostedAuthFilesOptions {
  readonly secretsRoot: string;
  readonly googleAllowlistFile: string;
  readonly csrfHmacKeyFile: string;
  readonly trustedGroupId: number;
}
export interface ProtectedHostedAuthFiles {
  readAllowlist(): Promise<readonly string[]>;
  readCsrfHmacKey(): Promise<Buffer>;
}
type FileSetting = "googleAllowlistFile" | "csrfHmacKeyFile";
type Setting = FileSetting | "secretsRoot" | "serviceGroup";
const ALLOWLIST_MAX_BYTES = 65536;
const HMAC_MAX_BYTES = 45;

class ProtectedAuthFileError extends Error {
  readonly code = "AUTH_FILE_UNAVAILABLE";
  constructor(readonly setting: Setting) {
    super("Protected authentication file unavailable");
    this.name = "ProtectedAuthFileError";
  }
}
function deny(setting: Setting): never {
  throw new ProtectedAuthFileError(setting);
}
function hasForbiddenControl(
  text: string,
  allowLineWhitespace = false,
): boolean {
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (
      code === 127 ||
      (code < 32 && !(allowLineWhitespace && code >= 9 && code <= 13))
    )
      return true;
  }
  return false;
}
function validGroupId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value < 0xffff_ffff;
}
function canonicalPath(value: string, setting: Setting): string {
  // Reuse the frozen POSIX file syntax rather than creating another path policy.
  if (
    typeof value !== "string" ||
    !HostedAuthConfigInputSchema.shape.googleAllowlistFile.safeParse(value)
      .success
  )
    deny(setting);
  return value;
}
function validateFilePath(
  root: string,
  file: string,
  setting: FileSetting,
): string {
  canonicalPath(file, setting);
  const relative = posix.relative(root, file);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith("../") ||
    posix.isAbsolute(relative)
  )
    deny(setting);
  return file;
}
function safeDirectory(stat: BigIntStats): boolean {
  return (
    stat.isDirectory() &&
    !stat.isSymbolicLink() &&
    stat.uid === 0n &&
    (stat.mode & 0o22n) === 0n
  );
}
async function inspectAncestors(
  file: string,
): Promise<readonly { path: string; stat: BigIntStats }[]> {
  const paths = ["/"];
  let current = "";
  for (const part of posix.dirname(file).split("/").filter(Boolean)) {
    current += `/${part}`;
    paths.push(current);
  }
  const snapshots = [];
  for (const path of paths) {
    const stat = await fs.lstat(path, { bigint: true });
    if (!safeDirectory(stat)) throw new Error();
    snapshots.push({ path, stat });
  }
  return snapshots;
}
function sameDirectory(a: BigIntStats, b: BigIntStats): boolean {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.uid === b.uid &&
    a.gid === b.gid &&
    a.mode === b.mode
  );
}
function safeFile(stat: BigIntStats, gid: number, cap: number): boolean {
  return (
    stat.isFile() &&
    !stat.isSymbolicLink() &&
    stat.uid === 0n &&
    stat.gid === BigInt(gid) &&
    (stat.mode & 0o7777n) === 0o640n &&
    stat.size > 0n &&
    stat.size <= BigInt(cap)
  );
}
function sameFile(a: BigIntStats, b: BigIntStats): boolean {
  return (
    sameDirectory(a, b) &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs &&
    a.nlink === b.nlink
  );
}
async function readProtectedBytes(
  file: string,
  gid: number,
  cap: number,
  setting: FileSetting,
): Promise<Buffer> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    if (
      constants.O_NOFOLLOW === undefined ||
      constants.O_NONBLOCK === undefined
    )
      deny(setting);
    const ancestors = await inspectAncestors(file);
    handle = await fs.open(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const before = await handle.stat({ bigint: true });
    if (!safeFile(before, gid, cap)) deny(setting);
    const buffer = Buffer.alloc(cap + 1);
    let length = 0;
    while (length < buffer.length) {
      const remaining = buffer.length - length;
      const { bytesRead } = await handle.read(buffer, length, remaining, null);
      if (
        !Number.isInteger(bytesRead) ||
        bytesRead < 0 ||
        bytesRead > remaining
      )
        deny(setting);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const current = await fs.lstat(file, { bigint: true });
    if (
      length > cap ||
      BigInt(length) !== before.size ||
      !safeFile(after, gid, cap) ||
      !safeFile(current, gid, cap) ||
      !sameFile(before, after) ||
      !sameFile(after, current)
    )
      deny(setting);
    const finalAncestors = await inspectAncestors(file);
    for (let i = 0; i < ancestors.length; i++)
      if (
        ancestors[i].path !== finalAncestors[i].path ||
        !sameDirectory(ancestors[i].stat, finalAncestors[i].stat)
      )
        deny(setting);
    return buffer.subarray(0, length);
  } catch {
    return deny(setting);
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {
        deny(setting);
      }
    }
  }
}

export function createProtectedHostedAuthFiles(
  options: ProtectedHostedAuthFilesOptions,
): ProtectedHostedAuthFiles {
  const secretsRoot = canonicalPath(options.secretsRoot, "secretsRoot");
  const trustedGroupId = options.trustedGroupId;
  if (!validGroupId(trustedGroupId)) deny("serviceGroup");
  const allowlistFile = validateFilePath(
    secretsRoot,
    options.googleAllowlistFile,
    "googleAllowlistFile",
  );
  const hmacFile = validateFilePath(
    secretsRoot,
    options.csrfHmacKeyFile,
    "csrfHmacKeyFile",
  );
  return {
    async readAllowlist() {
      try {
        const bytes = await readProtectedBytes(
          allowlistFile,
          trustedGroupId,
          ALLOWLIST_MAX_BYTES,
          "googleAllowlistFile",
        );
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (hasForbiddenControl(text, true)) deny("googleAllowlistFile");
        const lines = text
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        const result = validateAccountAllowlist(lines);
        if (!result.ok) deny("googleAllowlistFile");
        return result.accounts;
      } catch {
        return deny("googleAllowlistFile");
      }
    },
    async readCsrfHmacKey() {
      try {
        const bytes = await readProtectedBytes(
          hmacFile,
          trustedGroupId,
          HMAC_MAX_BYTES,
          "csrfHmacKeyFile",
        );
        const text = new TextDecoder("utf-8", { fatal: true })
          .decode(bytes)
          .replace(/\r?\n$/, "");
        if (!/^[A-Za-z0-9_-]{43}$/.test(text)) deny("csrfHmacKeyFile");
        const key = Buffer.from(text, "base64url");
        if (key.length !== 32 || key.toString("base64url") !== text)
          deny("csrfHmacKeyFile");
        return key;
      } catch {
        return deny("csrfHmacKeyFile");
      }
    },
  };
}

/** Resolve the named OS group only when explicitly invoked during hosted startup. */
export async function resolveTrustedGwrkGroupId(): Promise<number> {
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      childProcess.execFile(
        "/usr/bin/getent",
        ["group", "gwrk"],
        { encoding: "utf8", timeout: 1000, maxBuffer: 4096 },
        (error, output) => {
          if (error) reject(error);
          else resolve(output);
        },
      );
    });
    if (typeof stdout !== "string" || Buffer.byteLength(stdout) > 4096)
      deny("serviceGroup");
    const line = stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout;
    if (hasForbiddenControl(line)) deny("serviceGroup");
    const match = /^gwrk:[^:]*:([0-9]+):[^:]*$/.exec(line);
    const gid = match ? Number(match[1]) : Number.NaN;
    if (!validGroupId(gid)) deny("serviceGroup");
    return gid;
  } catch {
    return deny("serviceGroup");
  }
}
