/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentBackend } from "../plugins/agent-backend.js";
import { AgentBackendRegistry } from "../plugins/agent-registry.js";
import { dispatchToAgent, SAFE_AGENT_ENV } from "./agent.js";

vi.mock("../plugins/skill-runtime.js", () => ({
  resolveEnforcementSkills: vi.fn().mockResolvedValue(""),
}));
vi.mock("../plugins/extension-runtime.js", () => ({
  resolveExtensionContext: vi.fn().mockResolvedValue([]),
}));
vi.mock("../engine/profile-detector.js", async (original) => ({
  ...(await original<typeof import("../engine/profile-detector.js")>()),
  detectProfile: vi
    .fn()
    .mockResolvedValue({
      type: "nodejs",
      stack: { language: "TypeScript" },
      layout: "flat",
    }),
}));
vi.mock("./config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    agents: { throttleMs: 0, define: "fixture", implement: "fixture" },
  }),
}));

const inbound = {
  GWRK_AUTH_MODE: "hosted",
  GWRK_AUTH_PUBLIC_ORIGIN: "https://gwrk.gforge.ai",
  GWRK_AUTH_GOOGLE_CLIENT_ID: "synthetic.apps.googleusercontent.com",
  GWRK_AUTH_GOOGLE_ALLOWLIST_FILE: "/synthetic/origin/allowlist",
  GWRK_AUTH_CSRF_HMAC_FILE: "/synthetic/origin/csrf",
  gWrK_aUtH_future_secret: "synthetic-inbound-canary",
  OAUTH2_PROXY_CLIENT_SECRET: "synthetic-gateway-client-canary",
  oauth2_proxy_cookie_secret: "synthetic-gateway-cookie-canary",
  GWRK_API_KEY: "synthetic-inbound-api-canary",
  gwrk_server_api_key: "synthetic-inbound-server-canary",
  AUTHORIZATION: "synthetic-authorization-canary",
  HTTP_AUTHORIZATION: "synthetic-http-authorization-canary",
  Cookie: "synthetic-cookie-canary",
  HTTP_COOKIE: "synthetic-http-cookie-canary",
  set_cookie: "synthetic-set-cookie-canary",
};
const outbound = {
  GH_TOKEN: "synthetic-git-canary",
  SLACK_BOT_TOKEN: "synthetic-slack-bot-canary",
  SLACK_APP_TOKEN: "synthetic-slack-app-canary",
  GWRK_AGENT_CREDENTIAL_FILE: "/synthetic/provider/credential",
  DBUS_SESSION_BUS_ADDRESS: "unix:path=/synthetic/provider/bus",
  XDG_RUNTIME_DIR: "/synthetic/provider/runtime",
  AGY_MODEL: "synthetic-native-provider-model",
};

describe("FR-016: actual worker child authentication environment", () => {
  let root: string;
  let restoreBackend: (() => void) | undefined;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "gwrk-worker-auth-env-"));
    vi.stubEnv("GWRK_HOME", root);
    mkdirSync(join(root, ".gwrk"));
    writeFileSync(
      join(root, ".gwrkrc.json"),
      JSON.stringify({ project: { name: "synthetic-worker" } }),
    );
  });
  afterEach(() => {
    restoreBackend?.();
    restoreBackend = undefined;
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it.each(["inherited", "explicit", "both"] as const)(
    "removes inbound and gateway canaries after %s environment composition",
    async (source) => {
      const observedFile = join(root, "observed.json");
      const child = join(root, "child.cjs");
      const observedKeys = [
        ...Object.keys(inbound),
        ...Object.keys(outbound),
        ...Object.keys(SAFE_AGENT_ENV),
        "HOME",
      ];
      writeFileSync(
        child,
        `const fs = require("node:fs");
process.stdin.resume();
process.stdin.on("end", () => {
  const keys = ${JSON.stringify(observedKeys)};
  const selected = Object.fromEntries(keys.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  fs.writeFileSync(process.argv[2], JSON.stringify(selected));
});
`,
      );
      for (const [key, value] of Object.entries(outbound))
        vi.stubEnv(key, value);
      for (const [key, value] of Object.entries(inbound)) {
        if (source === "explicit") vi.stubEnv(key, undefined);
        else vi.stubEnv(key, value);
      }
      const explicit =
        source === "inherited"
          ? {}
          : Object.fromEntries(
              Object.entries(inbound).map(([key, value]) => [
                key,
                `${value}-explicit`,
              ]),
            );
      const taskEnv = { ...explicit, NODE_OPTIONS: undefined };
      const adapter: AgentBackend = {
        name: "fixture",
        supportsModelForwarding: true,
        isAvailable: async () => true,
        dispatch: (task) => ({
          command: process.execPath,
          args: [child, observedFile],
          stdin: "synthetic prompt",
          env: task.env,
        }),
        syncGovernance: async () => "",
        parseResult: (stdout, stderr, exitCode) => ({
          stdout,
          stderr,
          exitCode,
          durationS: 0,
        }),
      };
      const backend = vi
        .spyOn(AgentBackendRegistry.prototype, "getAgentBackend")
        .mockResolvedValue(adapter);
      restoreBackend = () => backend.mockRestore();
      const originalHome = process.env.HOME;
      const result = await dispatchToAgent({
        agent: "fixture",
        workflow: "gwrk-implement",
        workDir: root,
        stdin: "synthetic prompt",
        env: taskEnv,
        quiet: true,
        timeoutMs: 5000,
        logPath: join(root, "dispatch.log"),
      });
      expect(result.exitCode).toBe(0);
      const observed = JSON.parse(readFileSync(observedFile, "utf8"));
      for (const key of Object.keys(inbound))
        expect
          .soft(observed, `${key} must not reach the worker`)
          .not.toHaveProperty(key);
      for (const [key, value] of Object.entries(outbound))
        expect(observed[key]).toBe(value);
      for (const [key, value] of Object.entries(SAFE_AGENT_ENV))
        expect(observed[key]).toBe(value);
      expect(observed.HOME).toBe(originalHome);
      for (const [key, value] of Object.entries(inbound)) {
        if (source !== "explicit") expect(process.env[key]).toBe(value);
      }
      expect(taskEnv).toEqual({ ...explicit, NODE_OPTIONS: undefined });
    },
  );
});
