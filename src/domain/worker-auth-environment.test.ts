/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { filterWorkerAuthEnvironment } from "./worker-auth-environment.js";

const blockedKeys = [
  "GWRK_AUTH_MODE",
  "gWrK_aUtH_future_secret",
  "GWRK_AUTH_",
  "OAUTH2_PROXY_CLIENT_SECRET",
  "oauth2_proxy_cookie_secret",
  "OAUTH2_PROXY_",
  "GWRK_API_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "gwrk_server_api_key",
  "AUTHORIZATION",
  "Http_Authorization",
  "Cookie",
  "HTTP_COOKIE",
  "set_cookie",
];
const outbound = Object.freeze({
  HOME: "/synthetic/native/home",
  DBUS_SESSION_BUS_ADDRESS: "unix:path=/synthetic/provider/bus",
  XDG_RUNTIME_DIR: "/synthetic/provider/runtime",
  GH_TOKEN: "synthetic-git-canary",
  GITHUB_TOKEN: "synthetic-github-canary",
  SLACK_BOT_TOKEN: "synthetic-slack-bot-canary",
  SLACK_APP_TOKEN: "synthetic-slack-app-canary",
  GWRK_AGENT_CREDENTIAL_FILE: "/synthetic/provider/credential",
  OPENAI_API_KEY: "synthetic-approved-provider-canary",
  ANTHROPIC_API_KEY: "synthetic-other-provider-canary",
  GOOGLE_APPLICATION_CREDENTIALS: "/synthetic/native/provider-account",
  AGY_MODEL: "synthetic-native-model",
  GIT_TERMINAL_PROMPT: "0",
  GIT_EDITOR: "true",
  GIT_SEQUENCE_EDITOR: "true",
  EDITOR: "true",
  PAGER: "cat",
  EMPTY_ALLOWED_VALUE: "",
  NODE_OPTIONS: undefined,
});

describe("pure worker authentication environment filter", () => {
  it.each(blockedKeys)(
    "strips inbound key %s regardless of its value",
    (key) => {
      for (const value of ["synthetic-inbound-canary", "", undefined]) {
        const input = Object.freeze({ ...outbound, [key]: value });
        expect(filterWorkerAuthEnvironment(input)).toEqual(outbound);
        expect(input).toHaveProperty(key, value);
      }
    },
  );
  it.each(["inherited", "explicit", "both"])(
    "filters after %s environment composition without permitting restoration",
    (source) => {
      const inherited = Object.freeze({
        ...outbound,
        ...Object.fromEntries(
          blockedKeys.map((key) => [key, "synthetic-inherited-inbound"]),
        ),
      });
      const explicit = Object.freeze({
        ...Object.fromEntries(
          blockedKeys.map((key) => [key, "synthetic-explicit-inbound"]),
        ),
        HOME: "/synthetic/selected/native/home",
      });
      const merged = Object.freeze({
        ...(source !== "explicit" ? inherited : outbound),
        ...(source !== "inherited" ? explicit : {}),
      });
      const result = filterWorkerAuthEnvironment(merged);
      expect(result).toEqual({
        ...outbound,
        HOME: source === "inherited" ? outbound.HOME : explicit.HOME,
      });
      for (const key of blockedKeys) expect(result).not.toHaveProperty(key);
      expect(inherited.GWRK_AUTH_MODE).toBe("synthetic-inherited-inbound");
      expect(explicit.GWRK_AUTH_MODE).toBe("synthetic-explicit-inbound");
    },
  );
  it.each([
    "GITHUB_WEBHOOK_SECRET",
    "github_webhook_secret",
    "GitHub_Webhook_Secret",
  ])(
    "strips inbound webhook HMAC key %s after explicit overrides while retaining outbound Git keys",
    (key) => {
      const inherited = Object.freeze({
        GH_TOKEN: "synthetic-outbound-gh",
        GITHUB_TOKEN: "synthetic-outbound-github",
        GITHUB_WEBHOOK_SECRET: "synthetic-inbound-webhook",
      });
      const explicit = Object.freeze({ [key]: "synthetic-explicit-webhook" });
      const merged = Object.freeze({ ...inherited, ...explicit });
      const filtered = filterWorkerAuthEnvironment(merged);
      expect(filtered).toEqual({
        GH_TOKEN: inherited.GH_TOKEN,
        GITHUB_TOKEN: inherited.GITHUB_TOKEN,
      });
      expect(filtered).not.toHaveProperty("GITHUB_WEBHOOK_SECRET");
      expect(filtered).not.toHaveProperty(key);
      expect(inherited.GITHUB_WEBHOOK_SECRET).toBe("synthetic-inbound-webhook");
      expect(explicit[key]).toBe("synthetic-explicit-webhook");
    },
  );
  it("preserves ordinary environment names and values without normalizing their case", () => {
    const input = Object.freeze({
      ...outbound,
      home: "lowercase-preserved",
      GWRK_AUTH: "no-prefix-underscore",
      OAUTH2_PROXY: "no-prefix-underscore",
      GWRK_API_KEY_FILE: "separate-explicit-provider-file",
    });
    expect(filterWorkerAuthEnvironment(input)).toEqual(input);
  });
  it("does not mutate or return the supplied environment object", () => {
    const input = Object.freeze({
      HOME: "/synthetic/home",
      COOKIE: "synthetic-inbound",
    });
    const result = filterWorkerAuthEnvironment(input);
    expect(result).not.toBe(input);
    expect(result).toEqual({ HOME: "/synthetic/home" });
    expect(input).toEqual({
      HOME: "/synthetic/home",
      COOKIE: "synthetic-inbound",
    });
    result.HOME = "/synthetic/new-output";
    expect(input.HOME).toBe("/synthetic/home");
  });
  it("returns deterministic independent results and is idempotent", () => {
    const input = Object.freeze({ ...outbound, GWRK_AUTH_MODE: "hosted" });
    const first = filterWorkerAuthEnvironment(input);
    const second = filterWorkerAuthEnvironment(input);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(filterWorkerAuthEnvironment(first)).toEqual(first);
  });
  it("handles an empty environment without consulting process state", () => {
    expect(filterWorkerAuthEnvironment({})).toEqual({});
    expect(Object.keys(filterWorkerAuthEnvironment({}))).toHaveLength(0);
  });
  it("preserves allowed undefined values while removing undefined forbidden properties", () => {
    const input = Object.freeze({
      NORMAL_UNSET: undefined,
      GWRK_AUTH_FUTURE: undefined,
    });
    const result = filterWorkerAuthEnvironment(input);
    expect(Object.hasOwn(result, "NORMAL_UNSET")).toBe(true);
    expect(Object.hasOwn(result, "GWRK_AUTH_FUTURE")).toBe(false);
    expect(result.NORMAL_UNSET).toBeUndefined();
  });
});
