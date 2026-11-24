/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveHostedAuthConfig } from "../domain/hosted-auth-config.js";
import { GwrkConfigSchema, loadConfig } from "./config.js";

const ORIGIN = "https://gwrk.example.invalid";
const CANARY = "auth-private-canary-never-echo";
const COMPLETE = {
  mode: "hosted" as const,
  publicOrigin: ORIGIN,
  googleClientId: "fixture.apps.googleusercontent.com",
  googleAllowlistFile: "/etc/gwrk/secrets/allowed-accounts",
  csrfHmacKeyFile: "/etc/gwrk/secrets/csrf-hmac-key",
};
const LAYERS = ["project", "local", "global"] as const;
type Layer = (typeof LAYERS)[number];

describe("typed hosted auth config loading", () => {
  let root: string;
  let project: string;
  let home: string;
  function write(layer: Layer, auth: unknown) {
    const file =
      layer === "project"
        ? path.join(project, ".gwrkrc.json")
        : layer === "local"
          ? path.join(project, ".gwrkrc.local.json")
          : path.join(home, "config.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        ...(layer === "project" ? { project: { name: "config-fixture" } } : {}),
        server: {
          ...(layer === "project" ? { host: "localhost", port: 18790 } : {}),
          auth,
        },
      }),
    );
  }
  beforeEach(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "config-auth-")),
    );
    project = path.join(root, "project");
    home = path.join(root, "home");
    fs.mkdirSync(project);
    fs.mkdirSync(home);
    fs.writeFileSync(
      path.join(project, ".gwrkrc.json"),
      JSON.stringify({
        project: { name: "config-fixture" },
        server: { host: "localhost", port: 18790 },
      }),
    );
    vi.stubEnv("GWRK_HOME", home);
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "");
    for (const key of [
      "GWRK_AUTH_MODE",
      "GWRK_AUTH_PUBLIC_ORIGIN",
      "GWRK_AUTH_GOOGLE_CLIENT_ID",
      "GWRK_AUTH_GOOGLE_ALLOWLIST_FILE",
      "GWRK_AUTH_CSRF_HMAC_FILE",
    ])
      vi.stubEnv(key, undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("preserves absent auth without injecting a trusted-local default", () => {
    expect(loadConfig(project).server).not.toHaveProperty("auth");
  });

  it.each(LAYERS)("preserves partial auth from %s", (layer) => {
    write(layer, { googleClientId: COMPLETE.googleClientId });
    const auth = Reflect.get(loadConfig(project).server, "auth");
    expect(auth).toEqual({ googleClientId: COMPLETE.googleClientId });
    expect(resolveHostedAuthConfig({ auth })).toMatchObject({
      ok: false,
      error: { code: "AUTH_CONFIG_INCOMPLETE" },
    });
  });

  it("merges partial typed fields using existing project/local/global precedence", () => {
    write("project", { mode: "hosted", googleClientId: "project-client" });
    write("local", {
      googleClientId: "local-client",
      googleAllowlistFile: COMPLETE.googleAllowlistFile,
    });
    write("global", {
      googleClientId: COMPLETE.googleClientId,
      publicOrigin: ORIGIN,
      csrfHmacKeyFile: COMPLETE.csrfHmacKeyFile,
    });
    const auth = Reflect.get(loadConfig(project).server, "auth");
    expect(auth).toEqual(COMPLETE);
    expect(resolveHostedAuthConfig({ auth })).toEqual({
      ok: true,
      value: COMPLETE,
    });
  });

  it("keeps environment separate so the resolver can reject actual conflicts", () => {
    write("project", { googleClientId: COMPLETE.googleClientId });
    vi.stubEnv("GWRK_AUTH_MODE", "hosted");
    vi.stubEnv("GWRK_AUTH_GOOGLE_CLIENT_ID", "conflicting-client");
    vi.stubEnv("GWRK_AUTH_PUBLIC_ORIGIN", ORIGIN);
    const auth = Reflect.get(loadConfig(project).server, "auth");
    expect(auth).toEqual({ googleClientId: COMPLETE.googleClientId });
    expect(
      resolveHostedAuthConfig({ auth, environment: process.env }),
    ).toMatchObject({
      ok: false,
      error: { code: "AUTH_CONFIG_CONFLICT", field: "googleClientId" },
    });
  });

  it.each([{}, { mode: "trusted_local" }])(
    "preserves valid explicit partial/local auth %#",
    (auth) => {
      write("project", auth);
      expect(Reflect.get(loadConfig(project).server, "auth")).toEqual(auth);
    },
  );

  const invalid = [
    null,
    "",
    [],
    false,
    0,
    { mode: "" },
    { mode: CANARY },
    { googleClientId: "" },
    { publicOrigin: "" },
    { publicOrigin: `http://${CANARY}.invalid` },
    { googleAllowlistFile: "" },
    { googleAllowlistFile: `../${CANARY}` },
    { csrfHmacKeyFile: "" },
    { csrfHmacKeyFile: `/etc/../${CANARY}` },
    { mode: "hosted", [CANARY]: CANARY },
  ];
  it.each(
    LAYERS.flatMap((layer) =>
      invalid.map((auth, index) => ({ layer, auth, index })),
    ),
  )(
    "rejects invalid $layer auth case$index without echoing values",
    ({ layer, auth }) => {
      write(layer, auth);
      let error: unknown;
      try {
        loadConfig(project);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(
        "Authentication configuration denied",
      );
      expect((error as Error).message).not.toContain(CANARY);
    },
  );

  it.each(["project", "local"] as const)(
    "does not hide invalid %s auth behind a valid later overlay",
    (layer) => {
      write(layer, { mode: CANARY });
      write("global", COMPLETE);
      expect(() => loadConfig(project)).toThrow(
        "Authentication configuration denied",
      );
    },
  );

  it("rejects unknown auth fields in the exported schema", () => {
    expect(
      GwrkConfigSchema.safeParse({
        project: { name: "fixture" },
        server: { host: "localhost", port: 18790, auth: { [CANARY]: CANARY } },
      }).success,
    ).toBe(false);
  });

  it("preserves auth in the exported schema without filling absent fields", () => {
    const config = GwrkConfigSchema.parse({
      project: { name: "fixture" },
      server: { host: "localhost", port: 18790, auth: { mode: "hosted" } },
    });
    expect(Reflect.get(config.server, "auth")).toEqual({ mode: "hosted" });
  });

  it("reads only config files, without opening referenced secrets or making network calls", () => {
    const auth = {
      ...COMPLETE,
      googleAllowlistFile: path.join(root, "missing-allowlist"),
      csrfHmacKeyFile: path.join(root, "missing-hmac"),
    };
    write("project", auth);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    try {
      const config = loadConfig(project);
      expect(Reflect.get(config.server, "auth")).toEqual(auth);
      expect(fs.existsSync(auth.googleAllowlistFile)).toBe(false);
      expect(fs.existsSync(auth.csrfHmacKeyFile)).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves unrelated server fields and webhook environment injection", () => {
    write("project", { mode: "hosted" });
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "existing-webhook-control");
    const config = loadConfig(project);
    expect(config.server.host).toBe("localhost");
    expect(config.server.port).toBe(18790);
    expect(config.server.githubWebhookSecret).toBe("existing-webhook-control");
    expect(Reflect.get(config.server, "auth")).toEqual({ mode: "hosted" });
  });
});
