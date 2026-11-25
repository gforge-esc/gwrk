import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { requireExecutionCheckpoint } from "./runtime-policy.mjs";

// Invoke in the owned controller after the native lifecycle checkpoint. No installed
// secret is opened. The fixed bytes force both standard Base64 punctuation characters.
export async function checkStandardCookieSecret({
  receipt,
  proxyImageId,
  runId,
  clientSecretFile,
  caFile,
  issuerArguments,
}) {
  requireExecutionCheckpoint(receipt);
  assert.equal(process.env.GWRK_051_OWNED_CONTROLLER, "1");
  assert.match(proxyImageId, /^sha256:[a-f0-9]{64}$/);
  assert.match(runId, /^[a-f0-9]{24}$/);
  const directory = `/fixture/cookie-format-${runId}`;
  const cookie = Buffer.alloc(32, 0xfb).toString("base64url");
  assert.equal(Buffer.from(cookie, "base64url").length, 32);
  assert.equal(cookie.length, 43);
  assert.equal(/^[A-Za-z0-9_-]{43}$/.test(cookie), true);
  // The controller creates this owned root-only directory before invoking this check.
  writeFileSync(`${directory}/cookie-secret`, cookie, { mode: 0o600 });
  const name = `gwrk-051-cookie-format-${runId}`;
  const args = [
    "run",
    "--detach",
    "--name",
    name,
    "--label",
    `gwrk.fixture.run=${runId}`,
    "--pull",
    "never",
    "--network",
    "host",
    "--user",
    "0:0",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--read-only",
    "--mount",
    `type=bind,source=${directory},target=${directory},readonly`,
    "--mount",
    "type=bind,source=/fixture/public,target=/fixture/public,readonly",
    "--mount",
    "type=bind,source=/fixture/secrets,target=/fixture/secrets,readonly",
    proxyImageId,
    "--http-address=127.0.0.1:14180",
    "--upstream=static://200",
    "--email-domain=example.invalid",
    `--cookie-secret-file=${directory}/cookie-secret`,
    `--client-secret-file=${clientSecretFile}`,
    `--provider-ca-file=${caFile}`,
    ...issuerArguments,
  ];
  writeFileSync(
    `${directory}/ownership.json`,
    JSON.stringify({ name, runId, cleanup: ["rm", "--force", name] }),
    { mode: 0o600 },
  );
  try {
    execFileSync("docker", args, { stdio: "pipe", timeout: 15_000 });
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch("http://127.0.0.1:14180/ready", {
          redirect: "manual",
          signal: AbortSignal.timeout(500),
        });
        await response.body?.cancel();
        if (response.status === 200)
          return {
            standardPaddedBase64WithPunctuationAndNewlineAccepted: true,
          };
      } catch {}
      await sleep(100);
    }
    throw new Error("cookie format readiness deadline");
  } catch {
    throw new Error(
      "pinned proxy rejected standard padded synthetic cookie-secret input",
    );
  } finally {
    let labels;
    try {
      labels = JSON.parse(
        execFileSync(
          "docker",
          ["inspect", "--format", "{{json .Config.Labels}}", name],
          { encoding: "utf8", timeout: 5000 },
        ),
      );
    } catch {}
    if (labels?.["gwrk.fixture.run"] === runId)
      execFileSync("docker", ["rm", "--force", name], {
        stdio: "ignore",
        timeout: 10_000,
      });
  }
}
