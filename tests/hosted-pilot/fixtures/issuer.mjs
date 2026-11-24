import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
  timingSafeEqual,
} from "node:crypto";
import { chownSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:https";
import { pathToFileURL } from "node:url";

export const GOOGLE_ISSUER = "https://accounts.google.com";
export const CALLBACK = "https://gwrk.gforge.ai/oauth2/callback";
export const CLIENT_ID = "105105105105-fixture.apps.googleusercontent.com";
const cases = new Set([
  "valid",
  "wrong-nonce",
  "missing-nonce",
  "wrong-audience",
  "wrong-issuer",
  "wrong-signature",
  "expired",
  "unverified",
  "unlisted",
  "token-error",
]);
const equal = (a, b) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

// This issuer substitutes transport only. Both verifiers must retain Google's issuer checks.
export function createFixtureIssuer({
  clientSecret,
  now = Date.now,
  maxCodes = 1000,
  onIssuedToken = () => {},
}) {
  if (!clientSecret) throw new Error("fixture client secret required");
  const signing = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const wrongSigning = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = {
    ...signing.publicKey.export({ format: "jwk" }),
    kid: "051-fixture",
    use: "sig",
    alg: "RS256",
  };
  const codes = new Map();
  const counts = { authorize: 0, token: 0, issued: 0, denied: 0, jwks: 0 };
  const json = (res, status, body) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
  };
  const deny = (res) => {
    counts.denied++;
    json(res, 400, { error: "invalid_request" });
  };
  const token = (claims, badSignature) => {
    const encode = (value) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const value = `${encode({ alg: "RS256", kid: jwk.kid })}.${encode(claims)}`;
    return `${value}.${sign("RSA-SHA256", Buffer.from(value), badSignature ? wrongSigning.privateKey : signing.privateKey).toString("base64url")}`;
  };
  async function handler(req, res) {
    try {
      const url = new URL(req.url, "https://127.0.0.1:18443");
      if (req.method === "GET" && url.pathname === "/jwks") {
        counts.jwks++;
        return json(res, 200, { keys: [jwk] });
      }
      if (req.method === "GET" && url.pathname === "/authorize") {
        counts.authorize++;
        for (const [code, grant] of codes)
          if (grant.expires <= now()) codes.delete(code);
        const p = url.searchParams;
        const selected = p.get("fixture_case") ?? "valid";
        if (
          p.get("client_id") !== CLIENT_ID ||
          p.get("redirect_uri") !== CALLBACK ||
          p.get("response_type") !== "code" ||
          p.get("code_challenge_method") !== "S256" ||
          !/^[A-Za-z0-9_-]{43}$/.test(p.get("code_challenge") ?? "") ||
          !p.get("nonce") ||
          !p.get("state") ||
          !cases.has(selected) ||
          codes.size >= maxCodes
        )
          return deny(res);
        const code = randomBytes(32).toString("base64url");
        codes.set(code, {
          challenge: p.get("code_challenge"),
          nonce: p.get("nonce"),
          selected,
          expires: now() + 300_000,
        });
        const target = new URL(CALLBACK);
        target.searchParams.set("code", code);
        target.searchParams.set("state", p.get("state"));
        res
          .writeHead(302, {
            Location: target.href,
            "Cache-Control": "no-store",
          })
          .end();
        return;
      }
      if (req.method === "POST" && url.pathname === "/token") {
        counts.token++;
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 8192) return deny(res);
        }
        const p = new URLSearchParams(body);
        const grant = codes.get(p.get("code"));
        codes.delete(p.get("code"));
        const basic = req.headers.authorization;
        const expectedBasic = `Basic ${Buffer.from(`${CLIENT_ID}:${clientSecret}`).toString("base64")}`;
        const clientAuthenticated = basic
          ? equal(basic, expectedBasic)
          : p.get("client_id") === CLIENT_ID &&
            equal(p.get("client_secret") ?? "", clientSecret);
        const verifier = p.get("code_verifier") ?? "";
        const challenge = createHash("sha256")
          .update(verifier)
          .digest("base64url");
        if (
          !grant ||
          grant.expires <= now() ||
          !clientAuthenticated ||
          p.get("grant_type") !== "authorization_code" ||
          p.get("redirect_uri") !== CALLBACK ||
          !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
          !equal(challenge, grant.challenge)
        )
          return deny(res);
        const seconds = Math.floor(now() / 1000);
        const selected = grant.selected;
        if (selected === "token-error") {
          counts.denied++;
          return json(res, 400, { error: "051_UPSTREAM_ERROR_CANARY" });
        }
        const idToken = token(
          {
            iss:
              selected === "wrong-issuer"
                ? "https://invalid.example"
                : GOOGLE_ISSUER,
            aud: selected === "wrong-audience" ? "other-client" : CLIENT_ID,
            sub: "051-synthetic-subject",
            nonce:
              selected === "missing-nonce"
                ? undefined
                : selected === "wrong-nonce"
                  ? "wrong-fixture-nonce"
                  : grant.nonce,
            iat: seconds - 1,
            exp: selected === "expired" ? seconds - 60 : seconds + 300,
            email:
              selected === "unlisted"
                ? "unlisted@example.invalid"
                : "allowed@example.invalid",
            email_verified: selected !== "unverified",
          },
          selected === "wrong-signature",
        );
        onIssuedToken({
          idTokenSha256: createHash("sha256").update(idToken).digest("hex"),
          accessTokenSha256: createHash("sha256")
            .update("synthetic-access")
            .digest("hex"),
        });
        counts.issued++;
        return json(res, 200, {
          access_token: "synthetic-access",
          token_type: "Bearer",
          expires_in: 300,
          id_token: idToken,
        });
      }
      json(res, 404, { error: "not_found" });
    } catch {
      deny(res);
    }
  }
  return { handler, counters: () => ({ ...counts, pendingCodes: codes.size }) };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const issued = [];
  const fixture = createFixtureIssuer({
    onIssuedToken(value) {
      if (issued.length >= 1000)
        throw new Error("fixture token observation bound exceeded");
      issued.push(value);
      writeFileSync(
        "/fixture/service/issuer-tokens.next",
        JSON.stringify({ issued }),
        { mode: 0o600 },
      );
      chownSync("/fixture/service/issuer-tokens.next", 10001, 10001);
      renameSync(
        "/fixture/service/issuer-tokens.next",
        "/fixture/service/issuer-tokens.json",
      );
    },
    clientSecret: readFileSync("/fixture/secrets/client-secret", "utf8").trim(),
  });
  const server = createServer(
    {
      cert: readFileSync("/fixture/secrets/issuer-fullchain.pem"),
      key: readFileSync("/fixture/secrets/issuer-key.pem"),
    },
    fixture.handler,
  );
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.listen(18443, "127.0.0.1", () =>
    console.log(JSON.stringify({ event: "fixture_issuer_ready", port: 18443 })),
  );
}
