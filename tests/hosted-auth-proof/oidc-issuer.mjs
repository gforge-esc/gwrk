import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { createServer } from "node:http";

const issuer = "http://issuer:8081";
const clientId = "fixture.apps.googleusercontent.com";
const callback = "https://gwrk.gforge.ai/oauth2/callback";
const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: "fixture",
  use: "sig",
  alg: "RS256",
};
const codes = new Map();

function json(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}

function issueToken(claims) {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const payload = `${encode({ alg: "RS256", kid: jwk.kid })}.${encode(claims)}`;
  return `${payload}.${sign("RSA-SHA256", Buffer.from(payload), privateKey).toString("base64url")}`;
}

createServer(async (req, res) => {
  const url = new URL(req.url, issuer);
  switch (url.pathname) {
    case "/.well-known/openid-configuration":
      return json(res, 200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      });
    case "/jwks":
      return json(res, 200, { keys: [jwk] });
    case "/authorize": {
      const params = url.searchParams;
      if (
        params.get("redirect_uri") !== callback ||
        params.get("client_id") !== clientId ||
        params.get("code_challenge_method") !== "S256"
      ) {
        return json(res, 400, { error: "invalid_request" });
      }
      const code = randomUUID();
      codes.set(code, {
        nonce: params.get("nonce"),
        challenge: params.get("code_challenge"),
        identity: params.get("fixture_user") ?? "allowed",
      });
      const redirect = new URL(callback);
      redirect.searchParams.set("code", code);
      redirect.searchParams.set("state", params.get("state"));
      res.writeHead(302, { Location: redirect.href }).end();
      return;
    }
    case "/token": {
      let body = "";
      for await (const chunk of req) body += chunk;
      const params = new URLSearchParams(body);
      const code = params.get("code");
      const grant = codes.get(code);
      codes.delete(code);
      const challenge = createHash("sha256")
        .update(params.get("code_verifier") ?? "")
        .digest("base64url");
      if (
        !grant ||
        challenge !== grant.challenge ||
        params.get("redirect_uri") !== callback
      ) {
        return json(res, 400, { error: "invalid_grant" });
      }
      const now = Math.floor(Date.now() / 1000);
      const idToken = issueToken({
        iss: issuer,
        aud: grant.identity === "bad-audience" ? "wrong-client" : clientId,
        sub: grant.identity,
        nonce: grant.nonce,
        iat: now,
        exp: now + 300,
        email:
          grant.identity === "unlisted"
            ? "unlisted@example.invalid"
            : "allowed@example.invalid",
        email_verified: grant.identity !== "unverified",
      });
      return json(res, 200, {
        access_token: "synthetic",
        token_type: "Bearer",
        expires_in: 300,
        id_token: idToken,
      });
    }
    default:
      return json(res, 404, { error: "not_found" });
  }
}).listen(8081, "0.0.0.0");
