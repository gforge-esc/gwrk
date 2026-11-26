/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHttpClientCredentialProvider } from "./http-client-credential.js";

const ORIGIN = "https://gwrk.gforge.ai";
const KEY = `gwrk_v1.private-client.${"a".repeat(43)}`;
let directory: string;
let credentialFile: string;

beforeEach(async () => {
  const parent = await fs.realpath(tmpdir());
  directory = await fs.mkdtemp(join(parent, "gwrk-client-credential-"));
  credentialFile = join(directory, "client-key");
  await fs.writeFile(credentialFile, `${KEY}\n`, { mode: 0o600 });
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(directory, { recursive: true, force: true });
});

function provider() {
  return createHttpClientCredentialProvider({
    credentialFile,
    boundOrigin: ORIGIN,
  });
}
function noSecrets(result: unknown) {
  const rendered = JSON.stringify(result);
  expect(rendered).not.toContain(KEY);
  expect(rendered).not.toContain("CANARY");
  expect(rendered).not.toContain(directory);
}

describe("outbound CLI credential resolution", () => {
  it("AUTH-16: returns the opaque key only for the bound HTTPS origin", async () => {
    expect(
      await provider().resolveBearerForUrl({
        targetUrl: `${ORIGIN}/api/status?projectId=public-id`,
      }),
    ).toEqual({ ok: true, bearerToken: KEY, boundOrigin: ORIGIN });
  });
  it.each([
    ORIGIN,
    `${ORIGIN}/api/health`,
    "https://GWRK.GFORGE.AI:443/api/status",
  ])("accepts same-origin URL normalization %s", async (targetUrl) => {
    expect(await provider().resolveBearerForUrl({ targetUrl })).toEqual({
      ok: true,
      bearerToken: KEY,
      boundOrigin: ORIGIN,
    });
  });
  it.each([
    ["https://other.example.test/api/status", "ORIGIN_MISMATCH"],
    ["https://gwrk.gforge.ai.evil.example/api/status", "ORIGIN_MISMATCH"],
    ["https://gwrk.gforge.ai:444/api/status", "ORIGIN_MISMATCH"],
    ["https://CANARY:secret@gwrk.gforge.ai/api/status", "ORIGIN_MISMATCH"],
    ["http://gwrk.gforge.ai/api/status", "HTTPS_REQUIRED"],
    ["file:///CANARY", "HTTPS_REQUIRED"],
    ["//gwrk.gforge.ai/api/status", "PROFILE_INVALID"],
    ["not a URL CANARY", "PROFILE_INVALID"],
  ])(
    "AUTH-16: denies target override %s before reading a secret",
    async (targetUrl, code) => {
      const open = vi.spyOn(fs, "open");
      const result = await provider().resolveBearerForUrl({ targetUrl });
      expect(result).toMatchObject({ ok: false, code });
      expect(open).not.toHaveBeenCalled();
      noSecrets(result);
    },
  );
  it.each([
    "http://gwrk.gforge.ai",
    `${ORIGIN}/`,
    `${ORIGIN}/path`,
    `${ORIGIN}?secret=CANARY`,
    `${ORIGIN}#CANARY`,
    "https://CANARY@gwrk.gforge.ai",
    "https://GWRK.GFORGE.AI",
    `${ORIGIN}:443`,
    "",
  ])(
    "rejects noncanonical configured origin %s independently of the target",
    async (boundOrigin) => {
      const open = vi.spyOn(fs, "open");
      const result = await createHttpClientCredentialProvider({
        credentialFile,
        boundOrigin,
      }).resolveBearerForUrl({ targetUrl: "http://other.example.test" });
      expect(result).toMatchObject({ ok: false, code: "PROFILE_INVALID" });
      expect(open).not.toHaveBeenCalled();
      noSecrets(result);
    },
  );
  it("constructs and imports without secret reads or network calls", async () => {
    const open = vi.spyOn(fs, "open");
    const fetch = vi.spyOn(globalThis, "fetch");
    vi.resetModules();
    const module = await import("./http-client-credential.js");
    module.createHttpClientCredentialProvider({
      credentialFile,
      boundOrigin: ORIGIN,
    });
    expect(open).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not discover inbound or provider environment credentials", async () => {
    vi.stubEnv("GWRK_API_KEY", KEY);
    vi.stubEnv("GWRK_SERVER_API_KEY", "CANARY_INBOUND");
    vi.stubEnv("OPENAI_API_KEY", "CANARY_OUTBOUND_PROVIDER");
    const open = vi.spyOn(fs, "open");
    expect(
      await createHttpClientCredentialProvider({}).resolveBearerForUrl({
        targetUrl: "http://127.0.0.1:18790/health",
      }),
    ).toEqual({ ok: true, bearerToken: null, boundOrigin: null });
    expect(open).not.toHaveBeenCalled();
  });
  it.each([
    { credentialFile: "explicit-file" },
    { boundOrigin: ORIGIN },
    { credentialFile: "", boundOrigin: ORIGIN },
  ])("denies partial or empty explicit configuration %#", async (options) => {
    const open = vi.spyOn(fs, "open");
    const result = await createHttpClientCredentialProvider(
      options,
    ).resolveBearerForUrl({ targetUrl: `${ORIGIN}/api/status` });
    expect(result).toMatchObject({ ok: false, code: "PROFILE_INVALID" });
    expect(open).not.toHaveBeenCalled();
    noSecrets(result);
  });
  it("snapshots the caller's configured origin rather than allowing later rebinding", async () => {
    const options = { credentialFile, boundOrigin: ORIGIN };
    const client = createHttpClientCredentialProvider(options);
    options.boundOrigin = "https://other.example.test";
    expect(
      await client.resolveBearerForUrl({ targetUrl: `${ORIGIN}/api/status` }),
    ).toMatchObject({ ok: true, bearerToken: KEY, boundOrigin: ORIGIN });
    expect(
      await client.resolveBearerForUrl({
        targetUrl: "https://other.example.test/api/status",
      }),
    ).toMatchObject({ ok: false, code: "ORIGIN_MISMATCH" });
  });
  it.each([0o000, 0o400, 0o640, 0o644, 0o666, 0o700])(
    "requires exact mode 0600, denies %s",
    async (mode) => {
      await fs.chmod(credentialFile, mode);
      const result = await provider().resolveBearerForUrl({
        targetUrl: ORIGIN,
      });
      expect(result).toMatchObject({ ok: false, code: "PROFILE_INVALID" });
      noSecrets(result);
    },
  );
  it("rechecks changed permissions instead of reusing a loaded key", async () => {
    const client = provider();
    expect(
      await client.resolveBearerForUrl({ targetUrl: ORIGIN }),
    ).toMatchObject({ ok: true, bearerToken: KEY });
    await fs.chmod(credentialFile, 0o644);
    const result = await client.resolveBearerForUrl({ targetUrl: ORIGIN });
    expect(result).toMatchObject({ ok: false, code: "PROFILE_INVALID" });
    noSecrets(result);
  });
  it("reloads an explicitly replaced protected file", async () => {
    const client = provider();
    expect(
      await client.resolveBearerForUrl({ targetUrl: ORIGIN }),
    ).toMatchObject({ ok: true, bearerToken: KEY });
    const replacement = `gwrk_v1.rotated-client.${"b".repeat(43)}`;
    const staged = join(directory, "replacement");
    await fs.writeFile(staged, `${replacement}\n`, { mode: 0o600 });
    await fs.rename(staged, credentialFile);
    expect(
      await client.resolveBearerForUrl({ targetUrl: ORIGIN }),
    ).toMatchObject({ ok: true, bearerToken: replacement });
  });
  it("rejects a symlinked secret file", async () => {
    const link = join(directory, "linked-key");
    await fs.symlink(credentialFile, link);
    const result = await createHttpClientCredentialProvider({
      credentialFile: link,
      boundOrigin: ORIGIN,
    }).resolveBearerForUrl({ targetUrl: ORIGIN });
    expect(result).toMatchObject({ ok: false, code: "PROFILE_INVALID" });
    noSecrets(result);
  });
  it("rejects a symlinked parent directory", async () => {
    const linkedParent = join(directory, "linked-parent");
    await fs.symlink(directory, linkedParent);
    const result = await createHttpClientCredentialProvider({
      credentialFile: join(linkedParent, "client-key"),
      boundOrigin: ORIGIN,
    }).resolveBearerForUrl({ targetUrl: ORIGIN });
    expect(result).toMatchObject({ ok: false, code: "PROFILE_INVALID" });
    noSecrets(result);
  });
  it("rechecks a file replaced by a symlink", async () => {
    const client = provider();
    expect(
      await client.resolveBearerForUrl({ targetUrl: ORIGIN }),
    ).toMatchObject({ ok: true, bearerToken: KEY });
    await fs.rename(credentialFile, `${credentialFile}.original`);
    await fs.symlink(`${credentialFile}.original`, credentialFile);
    const result = await client.resolveBearerForUrl({ targetUrl: ORIGIN });
    expect(result).toMatchObject({ ok: false, code: "PROFILE_INVALID" });
    noSecrets(result);
  });
  it("rejects a directory without reading its contents", async () => {
    const result = await createHttpClientCredentialProvider({
      credentialFile: directory,
      boundOrigin: ORIGIN,
    }).resolveBearerForUrl({ targetUrl: ORIGIN });
    expect(result).toMatchObject({ ok: false, code: "PROFILE_INVALID" });
    noSecrets(result);
  });
  it("rejects a FIFO without waiting for a writer", async () => {
    const fifo = join(directory, "fifo-key");
    execFileSync("mkfifo", ["-m", "600", fifo]);
    const result = await createHttpClientCredentialProvider({
      credentialFile: fifo,
      boundOrigin: ORIGIN,
    }).resolveBearerForUrl({ targetUrl: ORIGIN });
    expect(result).toMatchObject({ ok: false, code: "PROFILE_INVALID" });
    noSecrets(result);
  }, 3_000);
  it.each([
    "",
    "CANARY",
    "Bearer CANARY",
    `gwrk_v2.id.${"a".repeat(43)}`,
    `gwrk_v1.id.${"a".repeat(42)}`,
    `${KEY}\n\n`,
    `${KEY} CANARY`,
    ` ${KEY}`,
    `${KEY}\0`,
    `${KEY}\nCANARY`,
    "eyJhbGciOiJSUzI1NiJ9.CANARY.signature",
  ])("rejects malformed opaque file material %#", async (content) => {
    await fs.writeFile(credentialFile, content);
    const result = await provider().resolveBearerForUrl({ targetUrl: ORIGIN });
    expect(result).toMatchObject({ ok: false, code: "PROFILE_INVALID" });
    noSecrets(result);
  });
  it("rejects oversized secret input", async () => {
    await fs.writeFile(credentialFile, "CANARY".repeat(1000));
    const result = await provider().resolveBearerForUrl({ targetUrl: ORIGIN });
    expect(result).toMatchObject({ ok: false, code: "PROFILE_INVALID" });
    noSecrets(result);
  });
  it("returns static errors and never fetches or logs keys, URLs, or filesystem errors", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetch = vi.spyOn(globalThis, "fetch");
    const missing = createHttpClientCredentialProvider({
      credentialFile: join(directory, "CANARY-missing"),
      boundOrigin: ORIGIN,
    });
    const result = await missing.resolveBearerForUrl({
      targetUrl: `${ORIGIN}/api/status?projectId=CANARY`,
    });
    expect(result).toEqual({
      ok: false,
      code: "PROFILE_INVALID",
      message: "Client credential profile is invalid",
    });
    noSecrets(result);
    expect(fetch).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
