/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import childProcess from "node:child_process";
import { constants, type BigIntStats } from "node:fs";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createProtectedHostedAuthFiles,
  resolveTrustedGwrkGroupId,
} from "./protected-hosted-auth-files.js";

const ROOT = "/etc/gwrk/secrets";
const ACCOUNT = `${ROOT}/accounts`;
const HMAC = `${ROOT}/hmac`;
const GID = 1479;
const KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1));
const encoded = KEY.toString("base64url");
const options = {
  secretsRoot: ROOT,
  googleAllowlistFile: ACCOUNT,
  csrfHmacKeyFile: HMAC,
  trustedGroupId: GID,
};
type Entry = { data: Buffer; meta: BigIntStats; symbolic?: boolean };
const files = new Map<string, Entry>();
const dirs = new Map<string, BigIntStats>();
let afterRead: (() => void) | undefined;
let closes: ReturnType<typeof vi.fn>;
let reads: ReturnType<typeof vi.fn>;
function metadata(
  kind: "file" | "directory",
  overrides: Partial<BigIntStats> = {},
): BigIntStats {
  return {
    dev: 7n,
    ino: 17n,
    uid: 0n,
    gid: BigInt(GID),
    mode: kind === "file" ? 0o100640n : 0o40750n,
    size: 0n,
    mtimeNs: 100n,
    ctimeNs: 100n,
    nlink: 1n,
    isFile: () => kind === "file",
    isDirectory: () => kind === "directory",
    isSymbolicLink: () => false,
    ...overrides,
  } as BigIntStats;
}
function put(
  file: string,
  value: string | Buffer,
  overrides: Partial<BigIntStats> = {},
) {
  const data = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value);
  files.set(file, {
    data,
    meta: metadata("file", { size: BigInt(data.length), ...overrides }),
  });
}
async function denied(promise: Promise<unknown>, setting: string) {
  await expect(promise).rejects.toMatchObject({
    code: "AUTH_FILE_UNAVAILABLE",
    setting,
    message: "Protected authentication file unavailable",
  });
  try {
    await promise;
  } catch (error) {
    const text = String(error) + JSON.stringify(error);
    for (const value of ["CANARY", ROOT, encoded, "operator@example.test"])
      expect(text).not.toContain(value);
    expect(error).not.toHaveProperty("cause");
  }
}
beforeEach(() => {
  files.clear();
  dirs.clear();
  afterRead = undefined;
  for (const p of ["/", "/etc", "/etc/gwrk", ROOT])
    dirs.set(p, metadata("directory", { ino: BigInt(p.length + 100) }));
  put(
    ACCOUNT,
    " Operator@Example.test \n\nother@example.test\r\noperator@example.test\n",
  );
  put(HMAC, `${encoded}\n`);
  closes = vi.fn(async () => {});
  reads = vi.fn();
  vi.spyOn(fs, "lstat").mockImplementation((async (p: unknown) => {
    const key = String(p);
    const value = dirs.get(key) ?? files.get(key)?.meta;
    if (!value) throw new Error(`CANARY_ENOENT ${key}`);
    return { ...value };
  }) as never);
  vi.spyOn(fs, "open").mockImplementation((async (p: unknown) => {
    const entry = files.get(String(p));
    if (!entry) throw new Error(`CANARY_OPEN ${p}`);
    let position = 0;
    return {
      stat: async () => ({ ...entry.meta }),
      close: closes,
      read: async (buffer: Buffer, offset: number, length: number) => {
        reads();
        const bytesRead = Math.min(
          length,
          Math.max(0, entry.data.length - position),
        );
        entry.data.copy(buffer, offset, position, position + bytesRead);
        position += bytesRead;
        const callback = afterRead;
        afterRead = undefined;
        callback?.();
        return { bytesRead, buffer };
      },
    };
  }) as never);
});
afterEach(() => vi.restoreAllMocks());

describe("protected inbound authentication files", () => {
  it("imports and constructs without auth reads, process calls or network activity", async () => {
    const exec = vi.spyOn(childProcess, "execFile");
    const fetch = vi.spyOn(globalThis, "fetch");
    vi.resetModules();
    const module = await import("./protected-hosted-auth-files.js");
    module.createProtectedHostedAuthFiles(options);
    expect(fs.open).not.toHaveBeenCalled();
    expect(fs.lstat).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("normalizes and deduplicates the freshly protected exact account list", async () => {
    expect(
      await createProtectedHostedAuthFiles(options).readAllowlist(),
    ).toEqual(["operator@example.test", "other@example.test"]);
    expect(fs.open).toHaveBeenCalledWith(
      ACCOUNT,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    expect(closes).toHaveBeenCalledTimes(1);
  });
  it("decodes a canonical 32-byte HMAC without returning its encoded representation", async () => {
    const value =
      await createProtectedHostedAuthFiles(options).readCsrfHmacKey();
    expect(Buffer.isBuffer(value)).toBe(true);
    expect(value).toEqual(KEY);
    expect(closes).toHaveBeenCalledTimes(1);
  });
  it("captures configuration without allowing later rebinding", async () => {
    const input = { ...options };
    const reader = createProtectedHostedAuthFiles(input);
    input.googleAllowlistFile = "/outside/CANARY";
    input.trustedGroupId = 999;
    expect(await reader.readAllowlist()).toContain("operator@example.test");
  });
  it.each([
    "root",
    "same",
    "sibling",
    "relative",
    "dot",
    "double",
    "trailing",
    "backslash",
    "nul",
  ])("rejects unsafe configured paths: %s", async (variant) => {
    const paths: Record<string, string> = {
      root: "/outside/accounts",
      same: ROOT,
      sibling: `${ROOT}-other/accounts`,
      relative: "accounts",
      dot: `${ROOT}/../accounts`,
      double: `${ROOT}//accounts`,
      trailing: `${ACCOUNT}/`,
      backslash: `${ROOT}/a\\b`,
      nul: `${ACCOUNT}\0CANARY`,
    };
    const invoke = async () =>
      createProtectedHostedAuthFiles({
        ...options,
        googleAllowlistFile: paths[variant],
      }).readAllowlist();
    await denied(invoke(), "googleAllowlistFile");
    expect(reads).not.toHaveBeenCalled();
  });
  it.each(["googleAllowlistFile", "csrfHmacKeyFile", "secretsRoot"])(
    "rejects absent required path %s with a static configuration error",
    async (setting) => {
      await denied(
        (async () =>
          createProtectedHostedAuthFiles({
            ...options,
            [setting]: undefined,
          } as unknown as typeof options).readAllowlist())(),
        setting,
      );
      expect(fs.open).not.toHaveBeenCalled();
    },
  );
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 4294967295])(
    "rejects invalid trusted GID %s without OS lookup",
    async (trustedGroupId) => {
      const exec = vi.spyOn(childProcess, "execFile");
      await denied(
        (async () =>
          createProtectedHostedAuthFiles({
            ...options,
            trustedGroupId,
          }).readAllowlist())(),
        "serviceGroup",
      );
      expect(exec).not.toHaveBeenCalled();
      expect(fs.open).not.toHaveBeenCalled();
    },
  );
  it.each([0o600, 0o644, 0o660, 0o1640, 0o2640, 0o4640])(
    "rejects wrong or special file mode %s",
    async (mode) => {
      put(ACCOUNT, "operator@example.test", { mode: BigInt(0o100000 | mode) });
      await denied(
        createProtectedHostedAuthFiles(options).readAllowlist(),
        "googleAllowlistFile",
      );
      expect(reads).not.toHaveBeenCalled();
      expect(closes).toHaveBeenCalledTimes(1);
    },
  );
  it.each([{ uid: 99n }, { gid: 99n }])(
    "rejects foreign owner or group %# even if readable",
    async (meta) => {
      put(HMAC, encoded, meta);
      await denied(
        createProtectedHostedAuthFiles(options).readCsrfHmacKey(),
        "csrfHmacKeyFile",
      );
      expect(reads).not.toHaveBeenCalled();
    },
  );
  it.each(["symlink", "writable", "foreign", "not-directory"])(
    "rejects unsafe ancestor %s",
    async (variant) => {
      dirs.set(
        "/etc/gwrk",
        metadata(
          "directory",
          variant === "symlink"
            ? { isSymbolicLink: () => true }
            : variant === "writable"
              ? { mode: 0o40770n }
              : variant === "foreign"
                ? { uid: 999n }
                : { isDirectory: () => false },
        ),
      );
      await denied(
        createProtectedHostedAuthFiles(options).readAllowlist(),
        "googleAllowlistFile",
      );
      expect(fs.open).not.toHaveBeenCalled();
    },
  );
  it("rejects a symlink at the final path even when descriptor metadata would be valid", async () => {
    const entry = files.get(ACCOUNT)!;
    entry.meta = { ...entry.meta, isSymbolicLink: () => true };
    await denied(
      createProtectedHostedAuthFiles(options).readAllowlist(),
      "googleAllowlistFile",
    );
  });
  it("rejects nonregular descriptors before reading and closes them", async () => {
    const entry = files.get(ACCOUNT)!;
    entry.meta = { ...entry.meta, isFile: () => false };
    await denied(
      createProtectedHostedAuthFiles(options).readAllowlist(),
      "googleAllowlistFile",
    );
    expect(reads).not.toHaveBeenCalled();
    expect(closes).toHaveBeenCalledTimes(1);
  });
  it.each([
    "append",
    "truncate",
    "chmod",
    "chown",
    "group",
    "path-replace",
    "symlink",
    "ancestor-replace",
    "ancestor-writable",
  ])("rejects descriptor or path race: %s", async (kind) => {
    const entry = files.get(ACCOUNT)!;
    afterRead = () => {
      if (kind === "append") {
        entry.data = Buffer.concat([entry.data, Buffer.from("CANARY")]);
        entry.meta = {
          ...entry.meta,
          size: BigInt(entry.data.length),
          mtimeNs: 101n,
        };
      }
      if (kind === "truncate")
        entry.meta = { ...entry.meta, size: 1n, mtimeNs: 101n };
      if (kind === "chmod") entry.meta = { ...entry.meta, mode: 0o100644n };
      if (kind === "chown") entry.meta = { ...entry.meta, uid: 999n };
      if (kind === "group") entry.meta = { ...entry.meta, gid: 999n };
      if (kind === "path-replace")
        put(ACCOUNT, "operator@example.test", { ino: 999n });
      if (kind === "symlink")
        files.set(ACCOUNT, {
          ...entry,
          meta: { ...entry.meta, isSymbolicLink: () => true },
        });
      if (kind === "ancestor-replace")
        dirs.set("/etc/gwrk", metadata("directory", { ino: 999n }));
      if (kind === "ancestor-writable")
        dirs.set("/etc/gwrk", metadata("directory", { mode: 0o40777n }));
    };
    await denied(
      createProtectedHostedAuthFiles(options).readAllowlist(),
      "googleAllowlistFile",
    );
    expect(closes).toHaveBeenCalledTimes(1);
  });
  it.each([
    "",
    " \n\t\r\n",
    "*@example.test\n",
    "operator@example.test\nCANARY\n",
    "not-an-email",
    "operator@example.test\0CANARY",
    "operator@example.test\u001fCANARY",
  ])("rejects empty or invalid allowlist %# as a whole", async (value) => {
    put(ACCOUNT, value);
    await denied(
      createProtectedHostedAuthFiles(options).readAllowlist(),
      "googleAllowlistFile",
    );
  });
  it("reloads operator replacement and never falls back to an older list after failure", async () => {
    const reader = createProtectedHostedAuthFiles(options);
    expect(await reader.readAllowlist()).toContain("operator@example.test");
    put(ACCOUNT, "other@example.test\n", { ino: 999n });
    expect(await reader.readAllowlist()).toEqual(["other@example.test"]);
    files.delete(ACCOUNT);
    await denied(reader.readAllowlist(), "googleAllowlistFile");
  });
  it.each([encoded, `${encoded}\n`, `${encoded}\r\n`])(
    "accepts only the defined single terminal newline forms %#",
    async (text) => {
      put(HMAC, text);
      expect(
        await createProtectedHostedAuthFiles(options).readCsrfHmacKey(),
      ).toEqual(KEY);
    },
  );
  it.each([
    `${encoded}=`,
    ` ${encoded}`,
    `${encoded} `,
    `${encoded}\n\n`,
    encoded.slice(0, 42),
    "a".repeat(44),
    `${encoded.slice(0, 20)}\n${encoded.slice(20)}`,
    `${encoded.slice(0, -1)}F`,
  ])("rejects noncanonical HMAC material %#", async (text) => {
    put(HMAC, text);
    await denied(
      createProtectedHostedAuthFiles(options).readCsrfHmacKey(),
      "csrfHmacKeyFile",
    );
  });
  it.each([ACCOUNT, HMAC])(
    "rejects oversized and invalid UTF-8 input %s",
    async (file) => {
      const reader = createProtectedHostedAuthFiles(options);
      const read = () =>
        file === ACCOUNT ? reader.readAllowlist() : reader.readCsrfHmacKey();
      const setting =
        file === ACCOUNT ? "googleAllowlistFile" : "csrfHmacKeyFile";
      put(file, Buffer.alloc(file === ACCOUNT ? 65537 : 46, 65));
      await denied(read(), setting);
      expect(reads).not.toHaveBeenCalled();
      put(file, Buffer.from([0xff, 0xfe]));
      await denied(read(), setting);
    },
  );
  it("rejects descriptor read and close errors without exposing underlying values", async () => {
    const validOpen = vi.mocked(fs.open).getMockImplementation()!;
    vi.mocked(fs.open).mockResolvedValue({
      stat: async () => metadata("file", { size: 10n }),
      read: async () => {
        throw new Error(`CANARY ${encoded}`);
      },
      close: closes,
    } as never);
    await denied(
      createProtectedHostedAuthFiles(options).readAllowlist(),
      "googleAllowlistFile",
    );
    expect(closes).toHaveBeenCalledTimes(1);
    vi.mocked(fs.open).mockImplementation(validOpen);
    closes.mockRejectedValueOnce(new Error("CANARY_CLOSE"));
    await denied(
      createProtectedHostedAuthFiles(options).readAllowlist(),
      "googleAllowlistFile",
    );
  });
  it("logs no secret, file path or underlying filesystem error", async () => {
    const log = vi.spyOn(console, "log");
    const error = vi.spyOn(console, "error");
    const warn = vi.spyOn(console, "warn");
    files.delete(HMAC);
    await denied(
      createProtectedHostedAuthFiles(options).readCsrfHmacKey(),
      "csrfHmacKeyFile",
    );
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("trusted named OS group lookup", () => {
  it("uses the literal executable and arguments at explicit invocation only", async () => {
    const exec = vi.spyOn(childProcess, "execFile").mockImplementation(((
      _file: unknown,
      _args: unknown,
      _options: unknown,
      callback: (error: unknown, stdout: string, stderr: string) => void,
    ) => {
      callback(null, "gwrk:x:1479:synthetic\n", "");
    }) as never);
    expect(await resolveTrustedGwrkGroupId()).toBe(GID);
    expect(exec).toHaveBeenCalledWith(
      "/usr/bin/getent",
      ["group", "gwrk"],
      { encoding: "utf8", timeout: 1000, maxBuffer: 4096 },
      expect.any(Function),
    );
  });
  it.each([
    "",
    "other:x:1479:\n",
    "gwrk:x:0:\n",
    "gwrk:x:-1:\n",
    "gwrk:x:1e3:\n",
    "gwrk:x:4294967295:\n",
    "gwrk:x:1479:\ngwrk:x:1480:\n",
    "gwrk:x:1479:extra:CANARY\n",
  ])("rejects missing or malformed named group %#", async (stdout) => {
    vi.spyOn(childProcess, "execFile").mockImplementation(((
      _file: unknown,
      _args: unknown,
      _options: unknown,
      callback: (error: unknown, stdout: string, stderr: string) => void,
    ) => {
      callback(null, stdout, "");
    }) as never);
    await denied(resolveTrustedGwrkGroupId(), "serviceGroup");
  });
  it("turns command failure into a static error without stdout or stderr", async () => {
    vi.spyOn(childProcess, "execFile").mockImplementation(((
      _file: unknown,
      _args: unknown,
      _options: unknown,
      callback: (error: unknown, stdout: string, stderr: string) => void,
    ) => {
      callback(new Error("CANARY_GETENT"), "CANARY", "CANARY");
    }) as never);
    await denied(resolveTrustedGwrkGroupId(), "serviceGroup");
  });
});
