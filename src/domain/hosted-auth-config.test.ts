/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import {
  HostedAuthConfigInputSchema,
  resolveHostedAuthConfig,
} from "./hosted-auth-config.js";

const hosted = Object.freeze({
  mode: "hosted",
  publicOrigin: "https://gwrk.gforge.ai",
  googleClientId: "synthetic.apps.googleusercontent.com",
  googleAllowlistFile: "/etc/gwrk/secrets/google-account-allowlist",
  csrfHmacKeyFile: "/etc/gwrk/secrets/csrf-hmac-key",
});
const mappings = Object.freeze({
  mode: "GWRK_AUTH_MODE",
  publicOrigin: "GWRK_AUTH_PUBLIC_ORIGIN",
  googleClientId: "GWRK_AUTH_GOOGLE_CLIENT_ID",
  googleAllowlistFile: "GWRK_AUTH_GOOGLE_ALLOWLIST_FILE",
  csrfHmacKeyFile: "GWRK_AUTH_CSRF_HMAC_FILE",
});
const environment = Object.freeze(
  Object.fromEntries(
    Object.entries(mappings).map(([field, key]) => [
      key,
      hosted[field as keyof typeof hosted],
    ]),
  ),
);
const localResult = { ok: true, value: { mode: "trusted_local" } };

function denied(result: unknown, code?: string, field?: string) {
  expect(result).toMatchObject({
    ok: false,
    error: { ...(code ? { code } : {}), ...(field ? { field } : {}) },
  });
  const text = JSON.stringify(result);
  for (const value of [
    "CANARY",
    hosted.googleClientId,
    hosted.googleAllowlistFile,
    hosted.csrfHmacKeyFile,
  ])
    expect(text).not.toContain(value);
}

describe("pure hosted authentication configuration resolution", () => {
  it.each([
    {},
    { environment: {} },
    { environment: { HOME: "/synthetic/native", GITHUB_TOKEN: "CANARY" } },
    { environment: {}, auth: {} },
  ])("preserves local startup with no auth settings %#", (input) => {
    expect(resolveHostedAuthConfig(input)).toEqual(localResult);
  });
  it.each([
    { environment },
    { auth: hosted },
    { environment, auth: hosted },
    {
      environment: {
        GWRK_AUTH_MODE: "hosted",
        GWRK_AUTH_CSRF_HMAC_FILE: hosted.csrfHmacKeyFile,
      },
      auth: {
        publicOrigin: hosted.publicOrigin,
        googleClientId: hosted.googleClientId,
        googleAllowlistFile: hosted.googleAllowlistFile,
      },
    },
  ])(
    "resolves complete hosted configuration from explicit inputs %#",
    (input) => {
      expect(resolveHostedAuthConfig(input)).toEqual({
        ok: true,
        value: hosted,
      });
    },
  );
  it("keeps partial typed input representable so the environment can complete it", () => {
    const auth = { googleClientId: hosted.googleClientId };
    expect(HostedAuthConfigInputSchema.safeParse(auth).success).toBe(true);
    expect(resolveHostedAuthConfig({ auth, environment })).toEqual({
      ok: true,
      value: hosted,
    });
  });
  it("accepts another canonical HTTPS deployment origin without hardcoding pilot identity", () => {
    const auth = { ...hosted, publicOrigin: "https://other.example.test:8443" };
    expect(resolveHostedAuthConfig({ auth })).toEqual({
      ok: true,
      value: auth,
    });
  });
  it("defers file containment and file reads to the effect adapter", () => {
    const auth = {
      ...hosted,
      googleAllowlistFile: "/nonexistent/deployment/accounts",
      csrfHmacKeyFile: "/nonexistent/deployment/csrf",
    };
    expect(resolveHostedAuthConfig({ auth })).toEqual({
      ok: true,
      value: auth,
    });
  });
  it.each(Object.keys(mappings))("requires hosted field %s", (field) => {
    const auth = Object.fromEntries(
      Object.entries(hosted).filter(([key]) => key !== field),
    );
    denied(resolveHostedAuthConfig({ auth }), "AUTH_CONFIG_INCOMPLETE", field);
  });
  it.each(Object.keys(mappings))(
    "rejects conflict in %s rather than choosing precedence",
    (field) => {
      const alternatives = {
        mode: "trusted_local",
        publicOrigin: "https://other.example.test",
        googleClientId: "other-client",
        googleAllowlistFile: "/different/accounts",
        csrfHmacKeyFile: "/different/csrf",
      };
      denied(
        resolveHostedAuthConfig({
          environment,
          auth: {
            ...hosted,
            [field]: alternatives[field as keyof typeof alternatives],
          },
        }),
        "AUTH_CONFIG_CONFLICT",
        field,
      );
    },
  );
  it.each(Object.keys(mappings))(
    "treats an empty typed %s as invalid configured input",
    (field) => {
      denied(
        resolveHostedAuthConfig({ auth: { ...hosted, [field]: "" } }),
        "AUTH_CONFIG_INVALID",
        field,
      );
    },
  );
  it.each(Object.entries(mappings))(
    "treats an empty environment %s as invalid configured input",
    (field, key) => {
      denied(
        resolveHostedAuthConfig({ environment: { ...environment, [key]: "" } }),
        "AUTH_CONFIG_INVALID",
        field,
      );
    },
  );
  it.each(["local", "HOSTED", " hosted", "CANARY"])(
    "rejects unsupported mode %s",
    (mode) => {
      denied(
        resolveHostedAuthConfig({ auth: { ...hosted, mode } }),
        "AUTH_CONFIG_INVALID",
        "mode",
      );
    },
  );
  it.each([
    { auth: { mode: "trusted_local" } },
    { environment: { GWRK_AUTH_MODE: "trusted_local" } },
  ])("permits explicit local mode without hosted settings %#", (input) => {
    expect(resolveHostedAuthConfig(input)).toEqual(localResult);
  });
  it.each([
    "publicOrigin",
    "googleClientId",
    "googleAllowlistFile",
    "csrfHmacKeyFile",
  ])("cannot downgrade hosted %s to local mode", (field) => {
    denied(
      resolveHostedAuthConfig({
        auth: {
          mode: "trusted_local",
          [field]: hosted[field as keyof typeof hosted],
        },
      }),
      "AUTH_CONFIG_INVALID",
      "mode",
    );
  });
  it.each([
    "http://gwrk.gforge.ai",
    "https://gwrk.gforge.ai/",
    "https://GWRK.GFORGE.AI",
    "https://gwrk.gforge.ai:443",
    "https://gwrk.gforge.ai/path",
    "https://gwrk.gforge.ai?CANARY=secret",
    "https://CANARY@gwrk.gforge.ai",
  ])("rejects noncanonical public origin %s", (publicOrigin) => {
    denied(
      resolveHostedAuthConfig({ auth: { ...hosted, publicOrigin } }),
      "AUTH_CONFIG_INVALID",
      "publicOrigin",
    );
  });
  it.each([
    "relative/key",
    "/",
    "/etc//key",
    "/etc/key/",
    "/etc/./key",
    "/etc/../key",
    "/etc/key\0CANARY",
    "/etc\\CANARY",
    "/etc/key\nCANARY",
  ])("rejects noncanonical POSIX file path %#", (path) => {
    for (const field of ["googleAllowlistFile", "csrfHmacKeyFile"])
      denied(
        resolveHostedAuthConfig({ auth: { ...hosted, [field]: path } }),
        "AUTH_CONFIG_INVALID",
        field,
      );
  });
  it.each([" ", " client", "client ", "client\nCANARY", "client CANARY"])(
    "rejects empty or padded client identifier %#",
    (googleClientId) => {
      denied(
        resolveHostedAuthConfig({ auth: { ...hosted, googleClientId } }),
        "AUTH_CONFIG_INVALID",
        "googleClientId",
      );
    },
  );
  it.each([
    null,
    [],
    "CANARY",
    0,
    { ...hosted, mode: 7 },
    { ...hosted, googleAllowlistFile: false },
    { ...hosted, unexpected: "CANARY" },
  ])("rejects malformed or unknown typed settings %#", (auth) => {
    expect(HostedAuthConfigInputSchema.safeParse(auth).success).toBe(false);
    denied(resolveHostedAuthConfig({ auth }), "AUTH_CONFIG_INVALID");
  });
  it.each(["GWRK_AUTH_MDOE", "GWRK_AUTH_FUTURE_SETTING", "gwrk_auth_mode"])(
    "denies unsupported auth environment setting %s without local fallback",
    (key) => {
      denied(
        resolveHostedAuthConfig({ environment: { [key]: "CANARY" } }),
        "AUTH_CONFIG_INVALID",
        "environment",
      );
    },
  );
  it("leaves frozen environment and typed settings unchanged", () => {
    const auth = Object.freeze({ ...hosted });
    const env = Object.freeze({ ...environment, HOME: "/synthetic/native" });
    const first = resolveHostedAuthConfig({ auth, environment: env });
    const second = resolveHostedAuthConfig({ auth, environment: env });
    expect(first).toEqual({ ok: true, value: hosted });
    expect(second).toEqual(first);
    if (first.ok) expect(first.value).not.toBe(auth);
    expect(auth).toEqual(hosted);
    expect(env).toEqual({ ...environment, HOME: "/synthetic/native" });
  });
});
