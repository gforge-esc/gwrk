/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCorpus, parseRecord } from "../../src/engine/adr-parser.js";

const root = path.resolve(".");

describe("Hosted pilot rollout gates (TR-020, TR-021, TC-010, TC-011, TC-012)", () => {
  it("enforces private defaults with loopback bind", () => {
    const projectConfigPath = path.join(root, ".gwrkrc.json");
    expect(fs.existsSync(projectConfigPath)).toBe(true);
    const projectConfig = JSON.parse(
      fs.readFileSync(projectConfigPath, "utf8"),
    );
    expect(["127.0.0.1", "localhost"]).toContain(projectConfig.server?.host);
    expect(projectConfig.server?.port).toBe(18790);

    const runnerEnvExamplePath = path.join(
      root,
      "deploy/linux-runner/.env.example",
    );
    expect(fs.existsSync(runnerEnvExamplePath)).toBe(true);
    const runnerEnv = fs.readFileSync(runnerEnvExamplePath, "utf8");
    expect(runnerEnv).toMatch(/^GWRK_LISTEN_HOST=127\.0\.0\.1$/m);
    expect(runnerEnv).toMatch(/^GWRK_LISTEN_PORT=18790$/m);
  });

  it("contains zero assumed Google accounts in deployment templates and configs", () => {
    const filesToCheck = [
      path.join(root, "deploy/linux-runner/.env.example"),
      path.join(root, "deploy/hosted-pilot/.env.example"),
    ];

    for (const filePath of filesToCheck) {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf8");
        expect(content).not.toMatch(/[\w.-]+@gmail\.com/i);
        expect(content).not.toMatch(/[\w.-]+@google\.com/i);
      }
    }

    const runnerSecretsDir = path.join(root, "deploy/linux-runner");
    const allowlistTemplate = path.join(
      runnerSecretsDir,
      "google-account-allowlist.example",
    );
    if (fs.existsSync(allowlistTemplate)) {
      const content = fs.readFileSync(allowlistTemplate, "utf8");
      expect(content).not.toMatch(/[\w.-]+@gmail\.com/i);
    }
  });

  it("preserves untouched deploy/hosted-auth-proof and tests/hosted-auth-proof/gateway-proof.mjs", () => {
    const legacyGatewayProof = path.join(
      root,
      "tests/hosted-auth-proof/gateway-proof.mjs",
    );
    expect(fs.existsSync(legacyGatewayProof)).toBe(true);

    const proofFiles = [
      "deploy/hosted-auth-proof/traefik/dynamic.yaml",
      "deploy/hosted-auth-proof/oauth2-proxy/oauth2-proxy.cfg",
      "deploy/hosted-auth-proof/status/default.conf",
    ];
    for (const rel of proofFiles) {
      expect(fs.existsSync(path.join(root, rel))).toBe(true);
    }

    const gitDiff = spawnSync(
      "git",
      [
        "status",
        "--porcelain",
        "deploy/hosted-auth-proof",
        "tests/hosted-auth-proof",
      ],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    expect(gitDiff.status).toBe(0);
    expect(gitDiff.stdout.trim()).toBe("");
  });

  it("preserves Proposed status for ADR-013 and ADR-014 without autonomous drift", async () => {
    const corpus = await parseCorpus(path.join(root, "docs/decisions"));

    for (let i = 1; i <= 12; i++) {
      const id = `ADR-${String(i).padStart(3, "0")}`;
      const record = corpus.find((entry) => entry.id === id);
      expect(record, `${id} must exist in docs/decisions`).toBeDefined();
      expect(record?.header.status, `${id} must remain Decided`).toBe(
        "Decided",
      );
    }

    const adr013 = corpus.find((entry) => entry.id === "ADR-013");
    expect(adr013, "ADR-013 must exist").toBeDefined();
    expect(adr013?.header.status).toBe("Proposed");

    const adr014 = corpus.find((entry) => entry.id === "ADR-014");
    expect(adr014, "ADR-014 must exist").toBeDefined();
    expect(adr014?.header.status).toBe("Proposed");

    const indexContent = fs.readFileSync(
      path.join(root, ".gwrk/decisions/index.md"),
      "utf8",
    );
    expect(indexContent).toMatch(/^\|\s*ADR-013\s*\|[^|]+\|\s*Proposed\s*\|/m);
    expect(indexContent).toMatch(/^\|\s*ADR-014\s*\|[^|]+\|\s*Proposed\s*\|/m);
  });

  it("blocks Phase 9 auto-completion fail-closed", () => {
    const gateScript = path.join(
      root,
      "specs/051-hosted-aws-pilot/gates/phase-09.sh",
    );
    expect(fs.existsSync(gateScript)).toBe(true);

    const gateResult = spawnSync("bash", [gateScript], {
      cwd: root,
      env: { ...process.env, GWRK_OPERATOR_LIVE_ACCEPTANCE: "0" },
      encoding: "utf8",
    });
    expect(gateResult.status).toBe(1);
    expect(gateResult.stderr).toContain(
      "live acceptance requires the authorized coordinator",
    );

    const tasksFile = path.join(
      root,
      "specs/051-hosted-aws-pilot/.gwrk/tasks.json",
    );
    if (fs.existsSync(tasksFile)) {
      const tasks = JSON.parse(fs.readFileSync(tasksFile, "utf8"));
      const phase09 = tasks.phases?.find(
        (p: { id: string }) => p.id === "phase-09",
      );
      if (phase09) {
        for (const task of phase09.tasks) {
          expect(task.status).not.toBe("completed");
        }
      }
    }
  });

  it("enforces fail-closed behavior in live-acceptance-gate.mjs", () => {
    const liveGateScript = path.join(
      root,
      "tests/hosted-pilot/live-acceptance-gate.mjs",
    );
    expect(
      fs.existsSync(liveGateScript),
      "live-acceptance-gate.mjs must exist",
    ).toBe(true);

    const unauthorized = spawnSync(process.execPath, [liveGateScript], {
      cwd: root,
      env: { ...process.env, GWRK_OPERATOR_LIVE_ACCEPTANCE: "" },
      encoding: "utf8",
    });
    expect(unauthorized.status).toBe(1);
    expect(unauthorized.stderr).toMatch(/operator/i);

    const syntheticProbe = spawnSync(
      process.execPath,
      [liveGateScript, "--target=http://localhost:18790"],
      {
        cwd: root,
        env: { ...process.env, GWRK_OPERATOR_LIVE_ACCEPTANCE: "1" },
        encoding: "utf8",
      },
    );
    expect(syntheticProbe.status).toBe(1);
    expect(syntheticProbe.stderr).toMatch(/reject|synthetic|localhost/i);

    const invalidProbe = spawnSync(
      process.execPath,
      [liveGateScript, "--target=https://example.invalid"],
      {
        cwd: root,
        env: { ...process.env, GWRK_OPERATOR_LIVE_ACCEPTANCE: "1" },
        encoding: "utf8",
      },
    );
    expect(invalidProbe.status).toBe(1);

    const pendingRecord = path.join(
      root,
      "deploy/hosted-pilot/live-acceptance.example.md",
    );
    const pendingRun = spawnSync(
      process.execPath,
      [liveGateScript, `--record=${pendingRecord}`],
      {
        cwd: root,
        env: { ...process.env, GWRK_OPERATOR_LIVE_ACCEPTANCE: "1" },
        encoding: "utf8",
      },
    );
    expect(pendingRun.status).toBe(1);
    expect(pendingRun.stderr).toMatch(/pending|refuse/i);
  });
});
