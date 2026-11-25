/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  OIDC_FIXTURE_ARGUMENTS,
  SAFE_PROXY_LOGGING_ARGUMENTS,
} from "./fixtures/oidc-overrides.mjs";

const bundle = path.resolve("deploy/hosted-pilot");
const testDir = path.resolve("tests/hosted-pilot");

const read = (name: string) => readFileSync(path.join(bundle, name), "utf-8");
const readTest = (name: string) =>
  readFileSync(path.join(testDir, name), "utf-8");

describe("Production hosted gateway bundle", () => {
  it("enforces compose service names, host networking, digest pins, and hardened security", () => {
    expect(existsSync(path.join(bundle, "compose.yaml"))).toBe(true);
    const compose = parse(read("compose.yaml"));

    expect(Object.keys(compose.services).sort()).toEqual([
      "oauth2-proxy",
      "traefik",
    ]);

    const traefik = compose.services.traefik;
    const proxy = compose.services["oauth2-proxy"];

    expect(traefik.network_mode).toBe("host");
    expect(proxy.network_mode).toBe("host");
    expect(traefik.ports).toBeUndefined();
    expect(proxy.ports).toBeUndefined();

    expect(traefik.image).toBe(
      "traefik:v3.7.18@sha256:9c437ac4f09ce6f4980a8544902d3475fdf70a1a7c578729581d2535dfa7d635",
    );
    expect(proxy.image).toBe(
      "quay.io/oauth2-proxy/oauth2-proxy:v7.15.6@sha256:c3415e8660af553f5e18f5d90db050614c02493c0ac6260ac59442f6d9b12048",
    );

    expect(traefik.user).toBe("0:0");
    expect(proxy.user).toBe("0:0");
    expect(traefik.read_only).toBe(true);
    expect(proxy.read_only).toBe(true);
    expect(traefik.security_opt).toContain("no-new-privileges:true");
    expect(proxy.security_opt).toContain("no-new-privileges:true");
    expect(traefik.cap_drop).toEqual(["ALL"]);
    expect(proxy.cap_drop).toEqual(["ALL"]);
    expect(traefik.cap_add).toEqual(["NET_BIND_SERVICE"]);
    expect(proxy.cap_add).toBeUndefined();

    expect(traefik.command).toContain("--entrypoints.websecure.address=:443");
    expect(traefik.command).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/--entrypoints\.web\./)]),
    );
    expect(traefik.command).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/--certificatesresolvers\./),
      ]),
    );
    expect(traefik.command).toContain(
      "--providers.file.directory=/etc/traefik/dynamic",
    );
    expect(traefik.command).toContain("--providers.file.watch=false");
    expect(traefik.command).toContain("--log.level=INFO");
    expect(traefik.command).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/--accesslog/i)]),
    );
    expect(traefik.command).toContain(
      "--entrypoints.websecure.forwardedheaders.insecure=false",
    );
    expect(traefik.command).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /--entrypoints\.websecure\.http\.aliasheadersstrategy=reject/i,
        ),
      ]),
    );

    expect(Array.isArray(proxy.command)).toBe(true);
    expect(proxy.command[0]).toBe(
      "--config=/etc/oauth2-proxy/oauth2-proxy.cfg",
    );
    for (const logArg of SAFE_PROXY_LOGGING_ARGUMENTS) {
      expect(proxy.command).toContain(logArg);
    }

    expect(proxy.environment).toEqual({
      OAUTH2_PROXY_CLIENT_ID:
        "${GWRK_AUTH_GOOGLE_CLIENT_ID:?Set GWRK_AUTH_GOOGLE_CLIENT_ID}",
    });

    for (const volume of traefik.volumes) {
      expect(volume.type).toBe("bind");
      expect(volume.read_only).toBe(true);
      expect(volume.bind?.create_host_path).toBe(false);
    }
    const traefikSources = traefik.volumes.map(
      (v: { source: string }) => v.source,
    );
    expect(traefikSources).toContain("/etc/gwrk/gateway-secrets/tls");
    expect(traefikSources).toContain("./traefik");

    for (const volume of proxy.volumes) {
      expect(volume.type).toBe("bind");
      expect(volume.read_only).toBe(true);
      expect(volume.bind?.create_host_path).toBe(false);
    }
    const proxySources = proxy.volumes.map((v: { source: string }) => v.source);
    expect(proxySources).toContain(
      "/etc/gwrk/gateway-secrets/oauth-client-secret",
    );
    expect(proxySources).toContain(
      "/etc/gwrk/gateway-secrets/oauth-cookie-secret",
    );
    expect(proxySources).toContain(
      "/etc/gwrk/secrets/google-account-allowlist",
    );
    expect(proxySources).toContain("./oauth2-proxy/oauth2-proxy.cfg");
  });

  it("proves compatibility with bootstrap.mjs compose parsing and mutation", () => {
    const raw = read("compose.yaml");
    const compose = parse(raw);
    expect(Object.keys(compose.services).sort()).toEqual([
      "oauth2-proxy",
      "traefik",
    ]);
    for (const name of ["traefik", "oauth2-proxy"] as const) {
      expect(compose.services[name].network_mode).toBe("host");
      expect(compose.services[name].ports).toBeUndefined();
    }
    const proxy = compose.services["oauth2-proxy"];
    expect(Array.isArray(proxy.command)).toBe(true);
    proxy.command.push(...OIDC_FIXTURE_ARGUMENTS);
    proxy.volumes.push({
      type: "bind",
      source: "/fixture/public",
      target: "/fixture/public",
      read_only: true,
      bind: { create_host_path: false },
    });
    expect(proxy.command).toContain("--provider=oidc");
    expect(proxy.volumes).toHaveLength(5);
  });

  it("configures strict SNI, TLS 1.2, literal loopback backends, and isolated routing chains", () => {
    expect(existsSync(path.join(bundle, "traefik/dynamic.yaml"))).toBe(true);
    const dynamic = parse(read("traefik/dynamic.yaml"));

    expect(dynamic.tls.certificates).toEqual([
      {
        certFile: "/run/gwrk-gateway-tls/fullchain.pem",
        keyFile: "/run/gwrk-gateway-tls/privkey.pem",
      },
    ]);
    expect(dynamic.tls.options.default).toEqual({
      minVersion: "VersionTLS12",
      sniStrict: true,
    });

    for (const router of Object.values(dynamic.http.routers) as Array<{
      tls?: Record<string, unknown>;
    }>) {
      expect(router.tls).toBeDefined();
      expect(Object.keys(router.tls ?? {})).toHaveLength(0);
    }

    expect(dynamic.http.services.origin.loadBalancer.servers).toEqual([
      { url: "http://127.0.0.1:18790" },
    ]);
    expect(dynamic.http.services["oauth2-proxy"].loadBalancer.servers).toEqual([
      { url: "http://127.0.0.1:4180" },
    ]);

    const routers = dynamic.http.routers;
    expect(routers).toHaveProperty("webhook");
    expect(routers).toHaveProperty("login-admission");
    expect(routers).toHaveProperty("public-root");
    expect(routers).toHaveProperty("api");
    expect(routers).toHaveProperty("browser");

    expect(routers.webhook.rule).toBe(
      "Host(`gwrk.gforge.ai`) && PathPrefix(`/webhook`)",
    );
    expect(routers.webhook.service).toBe("origin");
    expect(routers.webhook.priority).toBeGreaterThan(routers.api.priority ?? 0);

    expect(routers["login-admission"].rule).toBe(
      "Host(`gwrk.gforge.ai`) && (Method(`GET`) || Method(`HEAD`)) && (Path(`/oauth2/start`) || Path(`/oauth2/callback`))",
    );
    expect(routers["login-admission"].service).toBe("oauth2-proxy");

    expect(routers["public-root"].rule).toBe(
      "Host(`gwrk.gforge.ai`) && Path(`/`) && (Method(`GET`) || Method(`HEAD`))",
    );
    expect(routers["public-root"].service).toBe("origin");

    expect(routers.api.rule).toBe(
      "Host(`gwrk.gforge.ai`) && PathPrefix(`/api`) && HeaderRegexp(`Authorization`, `.*`)",
    );
    expect(routers.api.service).toBe("origin");

    expect(routers.browser.rule).toBe(
      "Host(`gwrk.gforge.ai`) && PathPrefix(`/api`)",
    );
    expect(routers.browser.service).toBe("origin");
    expect(routers.api.priority).toBeGreaterThan(routers.browser.priority ?? 0);

    for (const rule of Object.values(routers).map(
      (r: { rule: string }) => r.rule,
    )) {
      expect(rule).not.toContain("/oauth2/sign_out");
      expect(rule).not.toContain("/health");
    }
  });

  it("configures login-admission ForwardAuth and header lifecycle according to contract", () => {
    const dynamic = parse(read("traefik/dynamic.yaml"));
    const loginMiddlewares =
      dynamic.http.routers["login-admission"].middlewares;
    expect(loginMiddlewares).toEqual([
      "login-admission-prep",
      "login-forward-auth",
    ]);

    const prep =
      dynamic.http.middlewares["login-admission-prep"].headers
        .customRequestHeaders;
    expect(prep).toEqual(
      expect.objectContaining({
        "X-Forwarded-Uri": "/",
        "X-Forwarded-Method": "GET",
        "X-Forwarded-Host": "gwrk.gforge.ai",
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Port": "443",
        "X-Forwarded-For": "",
        "X-Forwarded-Prefix": "",
        "X-Forwarded-Server": "",
        "X-Real-Ip": "",
        Forwarded: "",
        "X-Forwarded-Tls-Client-Cert": "",
        "X-Forwarded-Tls-Client-Cert-Info": "",
        "X-Forwarded-User": "",
        "X-Forwarded-Email": "",
        "X-Forwarded-Groups": "",
        "X-Forwarded-Preferred-Username": "",
        "X-Forwarded-Access-Token": "",
        "X-Auth-Request-User": "",
        "X-Auth-Request-Email": "",
        "X-Gwrk-Auth-Mode": "",
      }),
    );

    const fwdAuth = dynamic.http.middlewares["login-forward-auth"].forwardAuth;
    expect(fwdAuth).toEqual({
      address: "http://127.0.0.1:18790/",
      preserveRequestMethod: false,
      forwardBody: false,
      trustForwardHeader: true,
      authRequestHeaders: ["X-Forwarded-Uri"],
      authResponseHeaders: [
        "X-Forwarded-For",
        "X-Forwarded-Uri",
        "X-Forwarded-Method",
      ],
      maxResponseBodySize: 4096,
    });
  });

  it("configures header stripping and X-Gwrk-Auth-Mode values per chain", () => {
    const dynamic = parse(read("traefik/dynamic.yaml"));

    const webhookMiddlewares = dynamic.http.routers.webhook.middlewares;
    expect(webhookMiddlewares).toEqual([
      "strip-public-identity",
      "webhook-auth-mode",
    ]);
    expect(
      dynamic.http.middlewares["webhook-auth-mode"].headers
        .customRequestHeaders["X-Gwrk-Auth-Mode"],
    ).toBe("webhook");

    const apiMiddlewares = dynamic.http.routers.api.middlewares;
    expect(apiMiddlewares).toEqual(["strip-public-identity", "api-auth-mode"]);
    expect(
      dynamic.http.middlewares["api-auth-mode"].headers.customRequestHeaders[
        "X-Gwrk-Auth-Mode"
      ],
    ).toBe("api_key");
    const apiPrep =
      dynamic.http.middlewares["strip-public-identity"].headers
        .customRequestHeaders;
    expect(apiPrep.Authorization).toBeUndefined();
    expect(apiPrep.Cookie).toBeUndefined();
    expect(apiPrep["X-Forwarded-For"]).toBeUndefined();
    expect(
      dynamic.http.middlewares["strip-browser-identity"].headers
        .customRequestHeaders["X-Forwarded-For"],
    ).toBeUndefined();
    expect(apiPrep["X-Forwarded-User"]).toBe("");
    expect(apiPrep["X-Auth-Request-User"]).toBe("");

    const browserMiddlewares = dynamic.http.routers.browser.middlewares;
    expect(browserMiddlewares).toEqual([
      "strip-browser-identity",
      "browser-forward-auth",
      "browser-auth-mode",
    ]);
    expect(
      dynamic.http.middlewares["browser-auth-mode"].headers
        .customRequestHeaders["X-Gwrk-Auth-Mode"],
    ).toBe("google_id_token");
    expect(
      dynamic.http.middlewares["strip-browser-identity"].headers
        .customRequestHeaders.Authorization,
    ).toBe("");

    const browserFwd =
      dynamic.http.middlewares["browser-forward-auth"].forwardAuth;
    expect(browserFwd.address).toBe("http://127.0.0.1:4180/oauth2/auth");
    expect(browserFwd.trustForwardHeader).toBe(true);
    expect(browserFwd.authRequestHeaders).toEqual(
      expect.arrayContaining([
        "Cookie",
        "X-Forwarded-Uri",
        "X-Forwarded-Method",
      ]),
    );
    expect(browserFwd.authResponseHeaders).toEqual(["Authorization"]);
    expect(browserFwd.authSigninURL).toBeUndefined();
  });

  it("configures OAuth2 Proxy security and session invariants in oauth2-proxy.cfg", () => {
    expect(existsSync(path.join(bundle, "oauth2-proxy/oauth2-proxy.cfg"))).toBe(
      true,
    );
    const cfg = read("oauth2-proxy/oauth2-proxy.cfg");

    expect(cfg).toMatch(/^http_address\s*=\s*"127\.0\.0\.1:4180"$/m);
    expect(cfg).toMatch(
      /^oidc_issuer_url\s*=\s*"https:\/\/accounts\.google\.com"$/m,
    );
    expect(cfg).toMatch(
      /^redirect_url\s*=\s*"https:\/\/gwrk\.gforge\.ai\/oauth2\/callback"$/m,
    );
    expect(cfg).toMatch(/^scope\s*=\s*"openid email"$/m);
    expect(cfg).toMatch(
      /^whitelist_domains\s*=\s*\[\s*"gwrk\.gforge\.ai"\s*\]$/m,
    );
    expect(cfg).toMatch(/^code_challenge_method\s*=\s*"S256"$/m);

    expect(cfg).toMatch(
      /^client_secret_file\s*=\s*"\/etc\/gwrk\/gateway-secrets\/oauth-client-secret"$/m,
    );
    expect(cfg).toMatch(
      /^cookie_secret_file\s*=\s*"\/etc\/gwrk\/gateway-secrets\/oauth-cookie-secret"$/m,
    );
    expect(cfg).toMatch(
      /^authenticated_emails_file\s*=\s*"\/etc\/gwrk\/secrets\/google-account-allowlist"$/m,
    );

    expect(cfg).toMatch(/^insecure_oidc_skip_nonce\s*=\s*false$/m);
    expect(cfg).toMatch(/^insecure_oidc_allow_unverified_email\s*=\s*false$/m);
    expect(cfg).toMatch(
      /^insecure_oidc_skip_issuer_verification\s*=\s*false$/m,
    );

    expect(cfg).toMatch(/^reverse_proxy\s*=\s*true$/m);
    expect(cfg).toMatch(/^real_client_ip_header\s*=\s*"X-Forwarded-For"$/m);
    expect(cfg).toMatch(
      /^trusted_proxy_ips\s*=\s*\[\s*"127\.0\.0\.1\/32"\s*\]$/m,
    );
    expect(cfg).toMatch(/^trusted_ips\s*=\s*\[\s*\]$/m);
    expect(cfg).toMatch(/^upstreams\s*=\s*\[\s*"static:\/\/404"\s*\]$/m);

    expect(cfg).toMatch(/^set_authorization_header\s*=\s*true$/m);
    expect(cfg).toMatch(/^pass_authorization_header\s*=\s*false$/m);
    expect(cfg).toMatch(/^pass_access_token\s*=\s*false$/m);
    expect(cfg).toMatch(/^pass_user_headers\s*=\s*false$/m);
    expect(cfg).toMatch(/^set_xauthrequest\s*=\s*false$/m);

    expect(cfg).toMatch(/^cookie_name\s*=\s*"__Host-gwrk_session"$/m);
    expect(cfg).toMatch(/^cookie_secure\s*=\s*true$/m);
    expect(cfg).toMatch(/^cookie_httponly\s*=\s*true$/m);
    expect(cfg).toMatch(/^cookie_samesite\s*=\s*"lax"$/m);
    expect(cfg).toMatch(/^cookie_expire\s*=\s*"1h"$/m);
    expect(cfg).toMatch(/^cookie_refresh\s*=\s*"0s"$/m);
    expect(cfg).toMatch(/^cookie_csrf_per_request\s*=\s*true$/m);
    expect(cfg).toMatch(/^cookie_csrf_expire\s*=\s*"5m"$/m);

    expect(cfg).toMatch(/^oidc_enabled_signing_algs\s*=\s*\[\s*"RS256"\s*\]$/m);
    expect(cfg).toMatch(/^ssl_insecure_skip_verify\s*=\s*false$/m);
  });

  it("verifies deploy/hosted-pilot/.env.example has zero secrets and assumed accounts", () => {
    expect(existsSync(path.join(bundle, ".env.example"))).toBe(true);
    const envExample = read(".env.example");

    expect(envExample).toBe("GWRK_AUTH_GOOGLE_CLIENT_ID=\n");
    expect(envExample).not.toMatch(/@/);
    expect(envExample).not.toMatch(/[a-f0-9]{32,}/i);
    expect(envExample).not.toMatch(
      /[A-Za-z0-9_-]{20,}\.apps\.googleusercontent\.com/,
    );

    const filled = envExample.replace(
      /^GWRK_AUTH_GOOGLE_CLIENT_ID=$/m,
      "GWRK_AUTH_GOOGLE_CLIENT_ID=105105105105-fixture.apps.googleusercontent.com",
    );
    const runSh = read("run.sh");
    const awkMatch = /awk '([\s\S]*?)' "\$public_config"/.exec(runSh);
    expect(awkMatch).not.toBeNull();
    const check = spawnSync("awk", [awkMatch![1]], {
      input: filled,
      encoding: "utf8",
      timeout: 5000,
    });
    expect(check.status).toBe(0);
  });

  it("verifies tests/hosted-pilot/compose.test.yaml overlays synthetic OIDC without mutating production URLs", () => {
    expect(existsSync(path.join(testDir, "compose.test.yaml"))).toBe(true);
    const testCompose = parse(readTest("compose.test.yaml"));

    const proxy = testCompose.services["oauth2-proxy"];
    expect(proxy).toBeDefined();
    expect(Array.isArray(proxy.command)).toBe(true);
    expect(proxy.command[0]).toBe(
      "--config=/etc/oauth2-proxy/oauth2-proxy.cfg",
    );
    for (const logArg of SAFE_PROXY_LOGGING_ARGUMENTS) {
      expect(proxy.command).toContain(logArg);
    }
    for (const oidcArg of OIDC_FIXTURE_ARGUMENTS) {
      expect(proxy.command).toContain(oidcArg);
    }
    const publicVolume = proxy.volumes.find(
      (v: { source: string }) => v.source === "/fixture/public",
    );
    expect(publicVolume).toEqual({
      type: "bind",
      source: "/fixture/public",
      target: "/fixture/public",
      read_only: true,
      bind: { create_host_path: false },
    });
  });
});
