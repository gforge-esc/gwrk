/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at https://mozilla.org/MPL/2.0/. */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const bundle = path.resolve("deploy/hosted-auth-proof");
const read = (name: string) => readFileSync(path.join(bundle, name), "utf-8");

describe("Production hosted sign-in boundary", () => {
  it("leaves the checked-in live acceptance record pending", () => {
    const record = read("live-acceptance.example.md");
    expect(record).toContain("Status: pending live checks.");
    expect(record).toMatch(/\| Public DNS and certificate \| Pending \|/);
    expect(record).toMatch(/\| Google account allowed \| Pending \|/);
    expect(record).toMatch(/\| Google account denied \| Pending \|/);
  });

  it("publishes only the HTTPS edge and isolates the status origin", () => {
    const { services, networks } = parse(read("compose.yaml"));
    expect(services.traefik.ports).toEqual(["80:80", "443:443"]);
    expect(services["oauth2-proxy"].ports).toBeUndefined();
    expect(services.status.ports).toBeUndefined();
    expect(services.status.networks).toEqual(["status"]);
    expect(networks.status.internal).toBe(true);
    expect(services.traefik.networks).toHaveProperty("status");
    expect(services["oauth2-proxy"].networks).not.toContain("status");
    for (const service of Object.values(services) as Array<{ image: string }>) {
      expect(service.image).toMatch(
        /:v?[0-9]+\.[0-9]+\.[0-9]+(?:-[\w.]+)?@sha256:[a-f0-9]{64}$/,
      );
    }
  });

  it("uses the production callback, a file allowlist and verified identities", () => {
    const proxy = read("oauth2-proxy/oauth2-proxy.cfg");
    expect(proxy).toMatch(
      /^oidc_issuer_url\s*=\s*"https:\/\/accounts\.google\.com"$/m,
    );
    expect(proxy).toMatch(
      /^redirect_url\s*=\s*"https:\/\/gwrk\.gforge\.ai\/oauth2\/callback"$/m,
    );
    expect(proxy).toMatch(/^authenticated_emails_file\s*=\s*"[^"]+"$/m);
    expect(proxy).not.toMatch(/^email_domains\s*=.*\*/m);
    expect(proxy).not.toMatch(
      /^(?:skip_auth_routes|skip_auth_regex)\s*=\s*\[[^\]]*\S[^\]]*\]/m,
    );
    expect(proxy).not.toMatch(
      /^insecure_oidc_(?:allow_unverified_email|skip_issuer_verification)\s*=\s*true$/m,
    );
    expect(proxy).toMatch(/^cookie_secure\s*=\s*true$/m);
    expect(proxy).toMatch(/^cookie_httponly\s*=\s*true$/m);
  });

  it("checks the session before proxying the status routes", () => {
    const { http } = parse(read("traefik/dynamic.yaml"));
    const status = http.routers.status;
    expect(status.rule).toContain("Host(`gwrk.gforge.ai`)");
    expect(status.rule).toContain("Path(`/status`)");
    expect(http.routers.home.rule).toContain("Path(`/`)");
    expect(status.middlewares).toEqual([
      "strip-client-identity",
      "check-session",
      "strip-session",
    ]);
    expect(http.middlewares["check-session"].forwardAuth.address).toBe(
      "http://oauth2-proxy:4180/oauth2/auth",
    );
    expect(
      http.middlewares["check-session"].forwardAuth.authResponseHeaders ?? [],
    ).toEqual([]);
    expect(
      http.middlewares["strip-client-identity"].headers.customRequestHeaders,
    ).toMatchObject({
      Authorization: "",
      "X-Auth-Request-User": "",
      "X-Forwarded-Email": "",
    });
    expect(http.routers.oauth.rule).toContain("Path(`/oauth2/callback`)");
    expect(http.routers.oauth.rule).not.toContain("PathPrefix");
  });
});
