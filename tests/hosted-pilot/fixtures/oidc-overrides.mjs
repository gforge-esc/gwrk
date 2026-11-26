import { CLIENT_ID, GOOGLE_ISSUER } from "./issuer.mjs";

// Fixture transport replacements use maintained v7.15.6 options. Production URLs
// stay in the production bundle. No issuer, audience, signature or nonce bypass.
export const OIDC_FIXTURE_ARGUMENTS = Object.freeze([
  "--provider=oidc",
  `--client-id=${CLIENT_ID}`,
  `--oidc-issuer-url=${GOOGLE_ISSUER}`,
  "--skip-oidc-discovery=true",
  "--login-url=https://127.0.0.1:18443/authorize",
  "--redeem-url=https://127.0.0.1:18443/token",
  "--oidc-jwks-url=https://127.0.0.1:18443/jwks",
  "--provider-ca-file=/fixture/public/ca.pem",
  "--oidc-enabled-signing-alg=RS256",
  "--insecure-oidc-skip-issuer-verification=false",
  "--insecure-oidc-skip-nonce=false",
  "--insecure-oidc-allow-unverified-email=false",
  "--ssl-insecure-skip-verify=false",
  "--code-challenge-method=S256",
]);

export const SAFE_PROXY_LOGGING_ARGUMENTS = Object.freeze([
  "--standard-logging=true",
  "--auth-logging=true",
  "--request-logging=true",
  "--standard-logging-format={{.Timestamp}} runtime {{.File}}",
  "--auth-logging-format={{.Timestamp}} auth {{.Status}}",
  "--request-logging-format={{.Timestamp}} request {{.StatusCode}} {{.ResponseSize}} {{.RequestDuration}}",
]);
