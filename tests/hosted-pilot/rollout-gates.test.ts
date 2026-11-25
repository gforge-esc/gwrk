/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCorpus } from "../../src/engine/adr-parser.js";

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
    const gitTracked = spawnSync(
      "git",
      ["ls-files", "deploy/hosted-pilot", "deploy/linux-runner"],
      { cwd: root, encoding: "utf8" },
    );
    expect(gitTracked.status).toBe(0);
    const trackedFiles = gitTracked.stdout.trim().split("\n").filter(Boolean);
    const emailRegex = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

    for (const relPath of trackedFiles) {
      const fullPath = path.join(root, relPath);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, "utf8");
        const matches = content.match(emailRegex) ?? [];
        for (const email of matches) {
          const lower = email.toLowerCase();
          const isAllowedFixture =
            lower.endsWith(".invalid") || lower.endsWith("@example.com");
          expect(
            isAllowedFixture,
            `Real account detected in ${relPath}: ${email}`,
          ).toBe(true);
        }
      }
    }
  });

  it("preserves untouched deploy/hosted-auth-proof and tests/hosted-auth-proof/gateway-proof.mjs", () => {
    const pinnedDigests: Record<string, string> = {
      "tests/hosted-auth-proof/gateway-proof.mjs":
        "a7f6079db2ff651153fd96802282138ff96da8cb41462a831c07460a6e10741c",
      "deploy/hosted-auth-proof/.env.example":
        "31adbffe30510f0f1b2b8b81de48877939f4f2a81e22729c2660e16ff426d504",
      "deploy/hosted-auth-proof/.gitignore":
        "b95c89a7c1ad7a586f232f664eacd3cb77bd6875efcc608eb4c3d060b2e52977",
      "deploy/hosted-auth-proof/README.md":
        "42c876f0660b44c47beef06e8531a72553209e9a0c3890b280401a1a04f7d191",
      "deploy/hosted-auth-proof/compose.yaml":
        "bc089fb9fd9703f96f1ff7e214ca601ea5788604dd10bed55a46796418392e52",
      "deploy/hosted-auth-proof/live-acceptance.example.md":
        "3e78049d66ef32d779ac8645831e68df9d713d6ba1dcf61826befcf7e4829c79",
      "deploy/hosted-auth-proof/oauth2-proxy/oauth2-proxy.cfg":
        "8ea2834042ee7fe8286825767dc39830379502be058aa0351867f0767ce950d3",
      "deploy/hosted-auth-proof/preflight.sh":
        "35fbaa3a0db2664d43203e879274fa1593e05d8ad579b8c7d52c8a254af446c2",
      "deploy/hosted-auth-proof/status/default.conf":
        "c07109b76db64fc0367734732dfe9ffba2331dccf292a6c63ec9a72f67198290",
      "deploy/hosted-auth-proof/traefik/dynamic.yaml":
        "563a3fa414c5848b443e58099b65136522362862ea5a0f18ae288e179312f319",
    };

    for (const [relPath, expectedSha256] of Object.entries(pinnedDigests)) {
      const fullPath = path.join(root, relPath);
      expect(fs.existsSync(fullPath), `${relPath} must exist`).toBe(true);
      const fileBuffer = fs.readFileSync(fullPath);
      const actualSha256 = crypto
        .createHash("sha256")
        .update(fileBuffer)
        .digest("hex");
      expect(
        actualSha256,
        `Digest mismatch for legacy proof artifact ${relPath}`,
      ).toBe(expectedSha256);
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

  it("preserves Proposed status for ADR-013 and verified human ratification for Decided ADR-014", async () => {
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
    expect(adr014?.header.status).toBe("Decided");

    const adr014Content = fs.readFileSync(
      path.join(root, "docs/decisions/ADR-014-hosted-production-auth.md"),
      "utf8",
    );
    expect(adr014Content).toMatch(
      /^>\s*\*\*Approved by:\*\*\s*David Gonzo Gonzalez on 2026-11-25$/m,
    );

    const indexContent = fs.readFileSync(
      path.join(root, ".gwrk/decisions/index.md"),
      "utf8",
    );
    expect(indexContent).toMatch(/^\|\s*ADR-013\s*\|[^|]+\|\s*Proposed\s*\|/m);
    expect(indexContent).toMatch(/^\|\s*ADR-014\s*\|[^|]+\|\s*Decided\s*\|/m);
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
      [liveGateScript, "--mode=live", "--target=http://localhost:18790"],
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
      [liveGateScript, "--mode=live", "--target=https://example.invalid"],
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
      [
        liveGateScript,
        "--mode=live",
        "--target=https://gwrk.gforge.ai",
        `--record=${pendingRecord}`,
      ],
      {
        cwd: root,
        env: { ...process.env, GWRK_OPERATOR_LIVE_ACCEPTANCE: "1" },
        encoding: "utf8",
      },
    );
    expect(pendingRun.status).toBe(1);
    expect(pendingRun.stderr).toMatch(/pending|refuse/i);

    // Negative controls: 8 adversarial probe cases from independent review
    const tempDir = fs.mkdtempSync(
      path.join(root, "temp-live-acceptance-adversarial-"),
    );
    try {
      const failRowsRecord = path.join(tempDir, "fail-rows.md");
      fs.writeFileSync(
        failRowsRecord,
        `# Hosted pilot live acceptance record
- Host: gwrk.gforge.ai
| Google login | FAIL |
| Google denial | FAIL |
| API key lifecycle | FAIL |
| cross-project denial | FAIL |
| private origin | FAIL |
| header forgery | FAIL |
| CSRF | FAIL |
| logout replay | FAIL |
| webhook HMAC | FAIL |
| restart | FAIL |
| reboot | FAIL |
| restore | FAIL |
| zero leaked tokens | FAIL |
Verdict: PASS
`,
      );

      const passRowsRecord = path.join(tempDir, "pass-rows.md");
      fs.writeFileSync(
        passRowsRecord,
        `# Hosted pilot live acceptance record
- Host: gwrk.gforge.ai
| Google login | PASS |
| Google denial | PASS |
| API key lifecycle | PASS |
| cross-project denial | PASS |
| private origin | PASS |
| header forgery | PASS |
| CSRF | PASS |
| logout replay | PASS |
| webhook HMAC | PASS |
| restart | PASS |
| reboot | PASS |
| restore | PASS |
| zero leaked tokens | PASS |
Verdict: PASS
`,
      );

      const adversarialCases: Array<{ name: string; args: string[] }> = [
        {
          name: "--mode=synthetic",
          args: ["--mode=synthetic", `--record=${passRowsRecord}`],
        },
        {
          name: "missing --target",
          args: ["--mode=live", `--record=${passRowsRecord}`],
        },
        {
          name: "FAIL rows in record",
          args: [
            "--mode=live",
            "--target=https://gwrk.gforge.ai",
            `--record=${failRowsRecord}`,
          ],
        },
        {
          name: "https://[::1]",
          args: [
            "--mode=live",
            "--target=https://[::1]",
            `--record=${passRowsRecord}`,
          ],
        },
        {
          name: "https://127.0.0.2",
          args: [
            "--mode=live",
            "--target=https://127.0.0.2",
            `--record=${passRowsRecord}`,
          ],
        },
        {
          name: "https://localhost.",
          args: [
            "--mode=live",
            "--target=https://localhost.",
            `--record=${passRowsRecord}`,
          ],
        },
        {
          name: "https://foo.localhost",
          args: [
            "--mode=live",
            "--target=https://foo.localhost",
            `--record=${passRowsRecord}`,
          ],
        },
        {
          name: "https://example.com",
          args: [
            "--mode=live",
            "--target=https://example.com",
            `--record=${passRowsRecord}`,
          ],
        },
        {
          name: "https://10.0.0.1",
          args: [
            "--mode=live",
            "--target=https://10.0.0.1",
            `--record=${passRowsRecord}`,
          ],
        },
        {
          name: "--bogus=1",
          args: [
            "--mode=live",
            "--target=https://gwrk.gforge.ai",
            "--bogus=1",
            `--record=${passRowsRecord}`,
          ],
        },
      ];

      for (const probe of adversarialCases) {
        const runResult = spawnSync(
          process.execPath,
          [liveGateScript, ...probe.args],
          {
            cwd: root,
            env: { ...process.env, GWRK_OPERATOR_LIVE_ACCEPTANCE: "1" },
            encoding: "utf8",
          },
        );
        expect(
          runResult.status,
          `Adversarial probe case '${probe.name}' must exit 1, but exited ${runResult.status} (stdout: ${runResult.stdout}, stderr: ${runResult.stderr})`,
        ).toBe(1);
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
