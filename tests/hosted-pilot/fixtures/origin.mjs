import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { createBrowserCsrfAdapter } from "/app/dist/adapters/auth/browser-csrf.js";
import { createCredentialCryptoAdapter } from "/app/dist/adapters/auth/credential-crypto.js";
import {
  GOOGLE_JWKS_URL,
  createGoogleIdentityVerifier,
} from "/app/dist/adapters/auth/google-id-token.js";
import { createProtectedHostedAuthFiles } from "/app/dist/adapters/auth/protected-hosted-auth-files.js";
import { createProxySessionLogout } from "/app/dist/adapters/auth/proxy-logout.js";
import { createRateAdmission } from "/app/dist/adapters/auth/rate-admission.js";
import {
  createSqliteAuthStoreAdapter,
  createSqliteOperationsStoreAdapter,
  createSqliteProjectRegistryAdapter,
} from "/app/dist/adapters/sqlite/index.js";
import { createRequestAuthenticator } from "/app/dist/application/auth/authenticate-request.js";
import { createBrowserSessionService } from "/app/dist/application/auth/browser-session.js";
import { openDatabase } from "/app/dist/db/index.js";
import { computeProjectId } from "/app/dist/domain/project-id.js";
import { startServer } from "/app/dist/server/index.js";
import { GwrkConfigSchema } from "/app/dist/utils/config.js";
import { CLIENT_ID } from "./issuer.mjs";

const directory = "/fixture/service";
const expectedOrigin = "https://gwrk.gforge.ai";
const clock = {
  nowMs: () => Date.now(),
  nowIso: () => new Date().toISOString(),
};
const requestScope = new AsyncLocalStorage();
const counters = {
  loginAttempts: 0,
  loginAllowed: 0,
  apiReservations: 0,
  apiVerified: 0,
  apiUnverified: 0,
  droppedCommittedResponses: 0,
  googleVerification: 0,
  jwksFetches: 0,
  worker: 0,
  notify: 0,
  requests: [],
  effects: 0,
};
const persist = () => {
  writeFileSync(`${directory}/observations.next`, JSON.stringify(counters), {
    mode: 0o600,
  });
  renameSync(
    `${directory}/observations.next`,
    `${directory}/observations.json`,
  );
};
mkdirSync(directory, { recursive: true, mode: 0o700 });
const repo = `${directory}/repo`;
mkdirSync(repo, { recursive: true });
const gitEnv = {
  PATH: "/usr/bin:/bin",
  HOME: "/fixture/service-home",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Gwrk Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Gwrk Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};
execFileSync("git", ["init", "--template=", "--initial-branch=main"], {
  cwd: repo,
  env: gitEnv,
  stdio: "ignore",
});
execFileSync(
  "git",
  ["remote", "add", "origin", "https://example.invalid/fixture/repo.git"],
  { cwd: repo, env: gitEnv, stdio: "ignore" },
);
const projectId = computeProjectId({
  projectRoot: repo,
  remoteOriginUrl: "https://example.invalid/fixture/repo.git",
  gitCommonDir: `${repo}/.git`,
});
const db = openDatabase({ dbPath: `${directory}/auth.db` });
const registry = createSqliteProjectRegistryAdapter({ db });
const operationsStore = createSqliteOperationsStoreAdapter({ db });
const store = createSqliteAuthStoreAdapter({ db });
const crypto = createCredentialCryptoAdapter();
registry.enrollProject({
  projectId,
  slug: "gateway-fixture",
  name: "Gateway Fixture",
  repoSlug: "fixture/repo",
  trunkBranch: "main",
  localRoot: repo,
  mirrorPath: null,
  runnerPolicy: { allowedKinds: ["local", "hosted"] },
  slack: {
    workspaceId: "W_FIXTURE",
    channelId: "C_FIXTURE",
    sharedChannel: false,
  },
  legacyProjectIds: [],
  createdAt: clock.nowIso(),
  updatedAt: clock.nowIso(),
});
registry.setRoleBinding({
  projectId,
  principalType: "google_sub",
  principalId: "https://accounts.google.com:051-synthetic-subject",
  role: "operator",
});
const key = crypto.generateApiCredential("fixture-operator");
store.createCredentialWithGrants({
  credentialId: "fixture-operator",
  verifierSha256: key.verifierSha256,
  label: "fixture",
  issuer: "local-admin",
  audienceOrigin: expectedOrigin,
  createdAt: clock.nowIso(),
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  grants: [{ projectId, role: "operator" }],
});
// Controller reads this private file through the owned daemon, never process argv or logs.
writeFileSync(
  `${directory}/client-input.json`,
  JSON.stringify({ projectId, apiKey: key.rawCredential }),
  { mode: 0o600 },
);
const fixtureCa = readFileSync("/fixture/public/ca.pem");
const protectedFiles = createProtectedHostedAuthFiles({
  secretsRoot: "/etc/gwrk/secrets",
  googleAllowlistFile: "/etc/gwrk/secrets/google-account-allowlist",
  csrfHmacKeyFile: "/etc/gwrk/secrets/csrf-hmac-key",
  trustedGroupId: 10001,
});
if (process.getuid() !== 10001 || process.getgid() !== 10001)
  throw new Error("fixture origin service identity differs");
async function fetchFixtureJwks(url, options) {
  if (
    url !== GOOGLE_JWKS_URL ||
    options.method !== "GET" ||
    options.redirect !== "manual"
  )
    throw new Error("fixture JWKS transport denied");
  counters.jwksFetches++;
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        hostname: "127.0.0.1",
        port: 18443,
        path: "/jwks",
        method: "GET",
        ca: fixtureCa,
        rejectUnauthorized: true,
        signal: options.signal,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > 65536)
            req.destroy(new Error("fixture JWKS exceeds bound"));
          else chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () =>
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode,
              headers: { "Content-Type": "application/json" },
            }),
          ),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}
const verifier = createGoogleIdentityVerifier({
  clientId: CLIENT_ID,
  readAllowlist: protectedFiles.readAllowlist,
  fetch: fetchFixtureJwks,
});
const google = {
  verifyIdToken: async (input) => {
    counters.googleVerification++;
    persist();
    return verifier.verifyIdToken(input);
  },
};
const authenticate = createRequestAuthenticator({
  store,
  crypto,
  google,
  clock,
  expectedOrigin,
});
const sessions = createBrowserSessionService({
  store,
  proxy: createProxySessionLogout(),
  clock,
});
const csrf = createBrowserCsrfAdapter({
  hmacKey: await protectedFiles.readCsrfHmacKey(),
  clock,
});
const ownedAdmission = createRateAdmission({ clock });
const admission = {
  consumeLogin(input) {
    counters.loginAttempts++;
    const result = ownedAdmission.consumeLogin(input);
    if (result.allowed) {
      counters.loginAllowed++;
      const incoming = requestScope.getStore();
      if (incoming && existsSync(`${directory}/drop-next-committed`)) {
        unlinkSync(`${directory}/drop-next-committed`);
        counters.droppedCommittedResponses++;
        persist();
        incoming.socket.destroy();
      }
    }
    persist();
    return result;
  },
  reserveApi(input) {
    counters.apiReservations++;
    persist();
    return ownedAdmission.reserveApi(input);
  },
  completeVerified(input) {
    counters.apiVerified++;
    persist();
    return ownedAdmission.completeVerified(input);
  },
  completeUnverified(input) {
    counters.apiUnverified++;
    persist();
    return ownedAdmission.completeUnverified(input);
  },
  expire: () => ownedAdmission.expire(),
  close: () => ownedAdmission.close(),
};
const forbidden = async (kind) => {
  counters.effects++;
  counters[kind]++;
  persist();
  throw new Error("fixture operational effect forbidden");
};
const sandbox = {
  checkGit: async () => true,
  checkDocker: async () => true,
  listSandboxes: async () => [],
  pruneSandboxes: async () => {},
  pauseAll: async () => {},
  unpauseAll: async () => {},
};
const worker = {
  inspectRecoveredWork: async () => ({
    workerState: "stopped",
    pullRequestLookup: "complete",
    openPullRequest: null,
    mergedPullRequest: null,
    completedManifestRunId: null,
    sandboxDir: null,
  }),
  launchPhaseShip: () => forbidden("worker"),
  cleanupStaleSandbox: () => forbidden("worker"),
};
const notifier = {
  notify: () => forbidden("notify"),
  getDeliveryStatus: async () => ({
    mode: "socket_connected",
    workspaceId: "W_FIXTURE",
    connected: true,
  }),
};
const github = {
  verifyWebhookSignature(body, signature, secret) {
    const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    return (
      typeof signature === "string" &&
      signature.length === expected.length &&
      timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    );
  },
  listTerminalPullRequests: async () => [],
  getPullRequest: async () => null,
};
const config = GwrkConfigSchema.parse({
  project: { name: "gateway-fixture" },
  agents: { define: "gemini", implement: "claude" },
  server: {
    host: "127.0.0.1",
    port: 18790,
    githubWebhookSecret: readFileSync(
      `${directory}/webhook-secret`,
      "utf8",
    ).trim(),
    heartbeatIntervalMs: 60_000,
    networkCheckIntervalMs: 60_000,
  },
});
const server = await startServer(config, {
  handleSignals: false,
  transport: "hosted",
  projectRoot: repo,
  ledger: { db, projectId },
  registry,
  operationsStore,
  sandbox,
  worker,
  notifier,
  github,
  clock,
  pid: { writePid() {}, removePid() {} },
  heartbeatIntervalMs: null,
  hostedAuth: {
    authenticate,
    sessions,
    csrf,
    expectedOrigin,
    rateAdmission: admission,
  },
});
server.server.prependListener("request", (incoming) => {
  requestScope.enterWith(incoming);
  if (counters.requests.length < 4096) {
    const root = (incoming.url ?? "").split("?")[0] === "/";
    counters.requests.push({
      method: incoming.method,
      path: (incoming.url ?? "").split("?")[0],
      peer: incoming.socket.remoteAddress,
      ...(root
        ? {
            hasQuery: incoming.url.includes("?"),
            hasAuthorization: incoming.headers.authorization !== undefined,
            hasCookie: incoming.headers.cookie !== undefined,
            forwardedFor:
              typeof incoming.headers["x-forwarded-for"] === "string" &&
              isIP(incoming.headers["x-forwarded-for"])
                ? incoming.headers["x-forwarded-for"]
                : "INVALID",
            forwardedMethodIsGet:
              incoming.headers["x-forwarded-method"] === "GET",
            forwardedUriIsRoot: incoming.headers["x-forwarded-uri"] === "/",
          }
        : {}),
    });
  }
  persist();
});
persist();
console.log(JSON.stringify({ event: "fixture_origin_ready", port: 18790 }));
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, async () => {
    await server.close();
    if (db.open) db.close();
    process.exitCode = 0;
  });
