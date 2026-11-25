import assert from "node:assert/strict";
import { test } from "vitest";
import {
  OIDC_FIXTURE_ARGUMENTS,
  SAFE_PROXY_LOGGING_ARGUMENTS,
} from "./oidc-overrides.mjs";

test("manual transport retains Google issuer and rejects verification bypasses", () => {
  const args = new Map(
    OIDC_FIXTURE_ARGUMENTS.map((value) => {
      const index = value.indexOf("=");
      return [value.slice(2, index), value.slice(index + 1)];
    }),
  );
  assert.equal(args.get("oidc-issuer-url"), "https://accounts.google.com");
  assert.equal(args.get("oidc-enabled-signing-alg"), "RS256");
  assert.equal(args.get("code-challenge-method"), "S256");
  for (const name of [
    "insecure-oidc-skip-issuer-verification",
    "insecure-oidc-skip-nonce",
    "insecure-oidc-allow-unverified-email",
    "ssl-insecure-skip-verify",
  ])
    assert.equal(args.get(name), "false");
  for (const name of ["login-url", "redeem-url", "oidc-jwks-url"])
    assert.equal(new URL(args.get(name)).origin, "https://127.0.0.1:18443");
});

test("all log classes retain safe outcome fields without callback or caller fields", () => {
  for (const kind of ["standard", "auth", "request"]) {
    assert.ok(SAFE_PROXY_LOGGING_ARGUMENTS.includes(`--${kind}-logging=true`));
    const template = SAFE_PROXY_LOGGING_ARGUMENTS.find((value) =>
      value.startsWith(`--${kind}-logging-format=`),
    );
    for (const field of [
      ".Message",
      ".RequestURI",
      ".Username",
      ".UserAgent",
      ".RequestID",
      ".Client",
    ])
      assert.equal(template.includes(field), false);
    assert.equal(template.includes(".Timestamp"), true);
  }
});
