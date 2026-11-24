/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseAndVerifyCanonicalJson,
  toCanonicalJson,
} from "./native-evidence/canonical-json.mjs";
import {
  REQUIRED_IMAGE_ROLES,
  REQUIRED_PILOT_CASES,
} from "./native-evidence/evidence-schema.mjs";
import {
  CLOSED_RUNTIME_ROOTS,
  computeRuntimeManifest,
  isUnderClosedRoot,
} from "./native-evidence/runtime-manifest.mjs";
import {
  createTestAnchor,
  createTestKeyPair,
  createValidEnvelope,
  setupHermeticTestRepo,
  signEnvelope,
} from "./native-evidence/test-helpers.mjs";
import { loadTrustAnchor } from "./native-evidence/trust-anchor.mjs";
import { verifyNativeEvidence } from "./native-evidence/verifier.mjs";

interface TestKeyPair {
  publicKeyPem: string;
  privateKeyPem: string;
  keyId: string;
}

interface TestRepoContext {
  repoDir: string;
  commitSha: string;
  legacyScriptPath: string;
  legacyScriptSha256: string;
  cleanup: () => void;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gatewayProductionEntrypoint = path.join(
  __dirname,
  "gateway-production.mjs",
);

describe("native-evidence adapter regression controls", () => {
  let repo: TestRepoContext;
  let keyPair: TestKeyPair;
  let trustAnchorPath: string;
  let envelopePath: string;
  let signaturePath: string;

  beforeEach(() => {
    repo = setupHermeticTestRepo();
    keyPair = createTestKeyPair();

    trustAnchorPath = path.join(
      repo.repoDir,
      "specs/051-hosted-aws-pilot/contracts/native-evidence-trust-anchor.json",
    );
    envelopePath = path.join(
      repo.repoDir,
      "specs/051-hosted-aws-pilot/evidence/native-evidence-envelope.json",
    );
    signaturePath = path.join(
      repo.repoDir,
      "specs/051-hosted-aws-pilot/evidence/native-evidence-envelope.sig.json",
    );

    const anchor = createTestAnchor(keyPair);
    writeFileSync(trustAnchorPath, `${toCanonicalJson(anchor)}\n`, "utf8");
  });

  afterEach(() => {
    repo.cleanup();
  });

  async function prepareValidFixtures() {
    const { manifestSha256 } = await computeRuntimeManifest(repo.repoDir);
    const anchorBytes = toCanonicalJson(createTestAnchor(keyPair));
    const trustAnchorSha256 = createHash("sha256")
      .update(anchorBytes, "utf8")
      .digest("hex");

    const envelope = createValidEnvelope({
      reviewedCommitSha: repo.commitSha,
      runtimeManifestSha256: manifestSha256,
      legacy041ScriptSha256: repo.legacyScriptSha256,
      trustAnchorSha256,
    });

    writeFileSync(envelopePath, `${toCanonicalJson(envelope)}\n`, "utf8");
    const sig = signEnvelope(envelope, keyPair.privateKeyPem, keyPair.keyId);
    writeFileSync(signaturePath, `${toCanonicalJson(sig)}\n`, "utf8");

    return { envelope, sig, manifestSha256, trustAnchorSha256 };
  }

  it("regression (R-01): missing detached signature fails verification", async () => {
    await prepareValidFixtures();
    unlinkSync(signaturePath);

    await expect(
      verifyNativeEvidence({
        repoRoot: repo.repoDir,
        trustAnchorPath,
        envelopePath,
        signaturePath,
      }),
    ).rejects.toThrow(/signature.*(?:missing|not found)/i);
  });

  it("regression (R-02): bad signature bytes fail Ed25519 verification", async () => {
    await prepareValidFixtures();
    const badSig = {
      schemaVersion: "1.0.0",
      keyId: keyPair.keyId,
      signature: Buffer.from(
        "bad_signature_bytes_that_fail_verification",
      ).toString("base64"),
    };
    writeFileSync(signaturePath, `${toCanonicalJson(badSig)}\n`, "utf8");

    await expect(
      verifyNativeEvidence({
        repoRoot: repo.repoDir,
        trustAnchorPath,
        envelopePath,
        signaturePath,
      }),
    ).rejects.toThrow(/signature.*(?:invalid|failed|verification)/i);
  });

  it("regression (R-03): wrong key or mismatched keyId fails verification", async () => {
    await prepareValidFixtures();
    const otherKey = createTestKeyPair();
    const { envelope } = await prepareValidFixtures();

    // Case A: keyId matches anchor, but signature made with otherKey
    const wrongSigA = signEnvelope(
      envelope,
      otherKey.privateKeyPem,
      keyPair.keyId,
    );
    writeFileSync(signaturePath, `${toCanonicalJson(wrongSigA)}\n`, "utf8");
    await expect(
      verifyNativeEvidence({
        repoRoot: repo.repoDir,
        trustAnchorPath,
        envelopePath,
        signaturePath,
      }),
    ).rejects.toThrow(/signature.*(?:invalid|failed|verification)/i);

    // Case B: signature has different keyId
    const wrongSigB = signEnvelope(
      envelope,
      otherKey.privateKeyPem,
      otherKey.keyId,
    );
    writeFileSync(signaturePath, `${toCanonicalJson(wrongSigB)}\n`, "utf8");
    await expect(
      verifyNativeEvidence({
        repoRoot: repo.repoDir,
        trustAnchorPath,
        envelopePath,
        signaturePath,
      }),
    ).rejects.toThrow(/keyId mismatch|untrusted key/i);
  });

  it("regression (R-04): changed runtime file in closed root fails verification", async () => {
    await prepareValidFixtures();

    // Case A: uncommitted dirty change in tracked runtime file
    writeFileSync(
      path.join(repo.repoDir, "src/placeholder.txt"),
      "// change\n",
      "utf8",
    );
    await expect(
      verifyNativeEvidence({
        repoRoot: repo.repoDir,
        trustAnchorPath,
        envelopePath,
        signaturePath,
      }),
    ).rejects.toThrow(/dirty runtime file/i);

    // Case B: committed change in runtime root causes manifest mismatch
    execFileSync("git", ["commit", "-am", "change src file"], {
      cwd: repo.repoDir,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "David Gonzo Gonzalez",
        GIT_AUTHOR_EMAIL: "gonzodbg@gmail.com",
        GIT_COMMITTER_NAME: "David Gonzo Gonzalez",
        GIT_COMMITTER_EMAIL: "gonzodbg@gmail.com",
      },
    });

    await expect(
      verifyNativeEvidence({
        repoRoot: repo.repoDir,
        trustAnchorPath,
        envelopePath,
        signaturePath,
      }),
    ).rejects.toThrow(/runtime manifest mismatch/i);
  });

  it("regression (R-05): symlink in runtime root fails manifest generation", async () => {
    const symlinkTarget = path.join(repo.repoDir, "package.json");
    const linkPath = path.join(repo.repoDir, "src/evil-symlink");
    symlinkSync(symlinkTarget, linkPath);

    await expect(computeRuntimeManifest(repo.repoDir)).rejects.toThrow(
      /symlink/i,
    );
  });

  it("regression (R-06): untracked file in runtime root fails manifest generation", async () => {
    const untrackedFile = path.join(repo.repoDir, "src/untracked.ts");
    writeFileSync(untrackedFile, "// untracked\n", "utf8");

    await expect(computeRuntimeManifest(repo.repoDir)).rejects.toThrow(
      /untracked file in runtime root/i,
    );
  });

  it("regression (R-07): changed legacy 041 script bytes fail verification", async () => {
    await prepareValidFixtures();
    // Tamper with legacy script
    writeFileSync(repo.legacyScriptPath, "// tampered\n", "utf8");

    await expect(
      verifyNativeEvidence({
        repoRoot: repo.repoDir,
        trustAnchorPath,
        envelopePath,
        signaturePath,
      }),
    ).rejects.toThrow(/legacy.*(?:script|041).*(?:mismatch|changed)/i);
  });

  it("regression (R-08): stale build provenance fails verification", async () => {
    const { envelope } = await prepareValidFixtures();
    // Tamper with applicationArtifact.runtimeManifestSha256
    envelope.buildProvenance.applicationArtifact.runtimeManifestSha256 =
      "1".repeat(64);
    writeFileSync(envelopePath, `${toCanonicalJson(envelope)}\n`, "utf8");
    const sig = signEnvelope(envelope, keyPair.privateKeyPem, keyPair.keyId);
    writeFileSync(signaturePath, `${toCanonicalJson(sig)}\n`, "utf8");

    await expect(
      verifyNativeEvidence({
        repoRoot: repo.repoDir,
        trustAnchorPath,
        envelopePath,
        signaturePath,
      }),
    ).rejects.toThrow(/stale build|build provenance.*manifest mismatch/i);
  });

  it("regression (R-09): wrong image payload map fails verification", async () => {
    const { envelope } = await prepareValidFixtures();
    // Omit one required role (e.g. legacy_node20)
    const { legacy_node20: _, ...incompleteMap } = envelope.buildProvenance
      .imagePayloadMap as Record<string, unknown>;
    (
      envelope.buildProvenance as unknown as { imagePayloadMap: unknown }
    ).imagePayloadMap = incompleteMap;
    writeFileSync(envelopePath, `${toCanonicalJson(envelope)}\n`, "utf8");
    const sig = signEnvelope(envelope, keyPair.privateKeyPem, keyPair.keyId);
    writeFileSync(signaturePath, `${toCanonicalJson(sig)}\n`, "utf8");

    await expect(
      verifyNativeEvidence({
        repoRoot: repo.repoDir,
        trustAnchorPath,
        envelopePath,
        signaturePath,
      }),
    ).rejects.toThrow(/image payload.*missing role|invalid image roles/i);
  });

  it("regression (R-10): diagnostic or partial proof fails verification", async () => {
    const { envelope } = await prepareValidFixtures();
    // Case A: nativeSuiteStatus is diagnostic instead of passed
    (envelope as unknown as { nativeSuiteStatus: string }).nativeSuiteStatus =
      "diagnostic";
    writeFileSync(envelopePath, `${toCanonicalJson(envelope)}\n`, "utf8");
    let sig = signEnvelope(envelope, keyPair.privateKeyPem, keyPair.keyId);
    writeFileSync(signaturePath, `${toCanonicalJson(sig)}\n`, "utf8");

    await expect(
      verifyNativeEvidence({
        repoRoot: repo.repoDir,
        trustAnchorPath,
        envelopePath,
        signaturePath,
      }),
    ).rejects.toThrow(/nativeSuiteStatus.*passed/i);

    // Case B: partial cases (omit one case)
    const { envelope: envB } = await prepareValidFixtures();
    envB.executionProof.pilotProof.cases.pop();
    writeFileSync(envelopePath, `${toCanonicalJson(envB)}\n`, "utf8");
    sig = signEnvelope(envB, keyPair.privateKeyPem, keyPair.keyId);
    writeFileSync(signaturePath, `${toCanonicalJson(sig)}\n`, "utf8");

    await expect(
      verifyNativeEvidence({
        repoRoot: repo.repoDir,
        trustAnchorPath,
        envelopePath,
        signaturePath,
      }),
    ).rejects.toThrow(/missing.*case inventory|incomplete cases/i);
  });

  it("regression (R-11): dropped capture or capture faults fail verification", async () => {
    // Case A: capture drops > 0
    const { envelope: envA } = await prepareValidFixtures();
    (
      envA.executionProof.pilotProof as unknown as { captureDrops: number }
    ).captureDrops = 1;
    writeFileSync(envelopePath, `${toCanonicalJson(envA)}\n`, "utf8");
    let sig = signEnvelope(envA, keyPair.privateKeyPem, keyPair.keyId);
    writeFileSync(signaturePath, `${toCanonicalJson(sig)}\n`, "utf8");

    await expect(
      verifyNativeEvidence({
        repoRoot: repo.repoDir,
        trustAnchorPath,
        envelopePath,
        signaturePath,
      }),
    ).rejects.toThrow(/captureDrops must be 0/i);

    // Case B: capture faults > 0
    const { envelope: envB } = await prepareValidFixtures();
    (
      envB.executionProof.pilotProof as unknown as { captureFaults: number }
    ).captureFaults = 1;
    writeFileSync(envelopePath, `${toCanonicalJson(envB)}\n`, "utf8");
    sig = signEnvelope(envB, keyPair.privateKeyPem, keyPair.keyId);
    writeFileSync(signaturePath, `${toCanonicalJson(sig)}\n`, "utf8");

    await expect(
      verifyNativeEvidence({
        repoRoot: repo.repoDir,
        trustAnchorPath,
        envelopePath,
        signaturePath,
      }),
    ).rejects.toThrow(/captureFaults must be 0/i);
  });

  it("regression (R-12): bad cleanup or child host mounts fail verification", async () => {
    const { envelope } = await prepareValidFixtures();
    (
      envelope.executionProof as unknown as { cleanupComplete: boolean }
    ).cleanupComplete = false;
    writeFileSync(envelopePath, `${toCanonicalJson(envelope)}\n`, "utf8");
    const sig = signEnvelope(envelope, keyPair.privateKeyPem, keyPair.keyId);
    writeFileSync(signaturePath, `${toCanonicalJson(sig)}\n`, "utf8");

    await expect(
      verifyNativeEvidence({
        repoRoot: repo.repoDir,
        trustAnchorPath,
        envelopePath,
        signaturePath,
      }),
    ).rejects.toThrow(/cleanup.*complete.*true/i);
  });

  it("regression (R-13): live acceptance confusion (livePilotAcceptance true) fails verification", async () => {
    const { envelope } = await prepareValidFixtures();
    (
      envelope as unknown as { livePilotAcceptance: boolean }
    ).livePilotAcceptance = true;
    writeFileSync(envelopePath, `${toCanonicalJson(envelope)}\n`, "utf8");
    const sig = signEnvelope(envelope, keyPair.privateKeyPem, keyPair.keyId);
    writeFileSync(signaturePath, `${toCanonicalJson(sig)}\n`, "utf8");

    await expect(
      verifyNativeEvidence({
        repoRoot: repo.repoDir,
        trustAnchorPath,
        envelopePath,
        signaturePath,
      }),
    ).rejects.toThrow(/livePilotAcceptance.*false/i);
  });

  it("regression (R-14): tampered trust anchor fails verification", async () => {
    const anchor = createTestAnchor(keyPair);
    // Tamper with keyId
    anchor.keyId = "f".repeat(64);
    writeFileSync(trustAnchorPath, `${toCanonicalJson(anchor)}\n`, "utf8");

    expect(() => loadTrustAnchor(trustAnchorPath)).toThrow(
      /tampered trust anchor|keyId mismatch/i,
    );
  });

  it("regression (R-15): non-canonical JSON with duplicate keys or unsorted keys fails verification", () => {
    // Duplicate key in raw JSON
    const duplicateKeyJson =
      '{"schemaVersion":"1.0.0","keyId":"abc","keyId":"def"}';
    expect(() => parseAndVerifyCanonicalJson(duplicateKeyJson)).toThrow(
      /canonical json validation failed/i,
    );

    // Unsorted keys in raw JSON
    const unsortedKeysJson = '{"z":1,"a":2}';
    expect(() => parseAndVerifyCanonicalJson(unsortedKeysJson)).toThrow(
      /canonical json validation failed/i,
    );
  });

  it("regression (R-16): production verifier fails when pinned trust anchor file is absent", async () => {
    unlinkSync(trustAnchorPath);
    await expect(
      verifyNativeEvidence({
        repoRoot: repo.repoDir,
        trustAnchorPath,
        envelopePath,
        signaturePath,
      }),
    ).rejects.toThrow(/trust anchor.*(?:not found|absent)/i);
  });

  it("control (C-01): unchanged runtime survives bookkeeping-only commits and spec edits", async () => {
    const { manifestSha256 } = await prepareValidFixtures();

    // Modify a file under specs/ (outside closed runtime roots)
    const specNote = path.join(
      repo.repoDir,
      "specs/051-hosted-aws-pilot/note.txt",
    );
    writeFileSync(specNote, "bookkeeping note\n", "utf8");

    // Commit bookkeeping change
    execFileSync("git", ["add", "specs/"], { cwd: repo.repoDir });
    execFileSync("git", ["commit", "-m", "bookkeeping update"], {
      cwd: repo.repoDir,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "David Gonzo Gonzalez",
        GIT_AUTHOR_EMAIL: "gonzodbg@gmail.com",
        GIT_COMMITTER_NAME: "David Gonzo Gonzalez",
        GIT_COMMITTER_EMAIL: "gonzodbg@gmail.com",
      },
    });

    // Compute manifest again: it must remain identical!
    const updated = await computeRuntimeManifest(repo.repoDir);
    expect(updated.manifestSha256).toBe(manifestSha256);

    const result = await verifyNativeEvidence({
      repoRoot: repo.repoDir,
      trustAnchorPath,
      envelopePath,
      signaturePath,
    });
    expect(result.ok).toBe(true);
  });

  it("control (C-02): valid envelope with hermetic test key passes verification", async () => {
    await prepareValidFixtures();
    const result = await verifyNativeEvidence({
      repoRoot: repo.repoDir,
      trustAnchorPath,
      envelopePath,
      signaturePath,
    });

    expect(result.ok).toBe(true);
    expect(result.envelope?.nativeSuiteStatus).toBe("passed");
    expect(result.envelope?.executionProof.pilotProof.cases).toEqual(
      expect.arrayContaining([...REQUIRED_PILOT_CASES]),
    );
  });

  describe("gateway-production.mjs CLI entrypoint", () => {
    it("fails closed on default execution when production evidence is missing", () => {
      let failed = false;
      try {
        execFileSync("node", [gatewayProductionEntrypoint], {
          cwd: repo.repoDir,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error: unknown) {
        failed = true;
        const procError = error as {
          status?: number;
          stderr?: string;
          stdout?: string;
        };
        expect(procError.status).not.toBe(0);
        expect(String(procError.stderr || procError.stdout)).toMatch(
          /evidence.*missing|anchor.*not found|verification failed/i,
        );
      }
      expect(failed).toBe(true);
    });

    it("fails closed when --execute-native flag is passed", () => {
      let failed = false;
      try {
        execFileSync(
          "node",
          [gatewayProductionEntrypoint, "--execute-native"],
          {
            cwd: repo.repoDir,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
      } catch (error: unknown) {
        failed = true;
        const procError = error as {
          status?: number;
          stderr?: string;
          stdout?: string;
        };
        expect(procError.status).not.toBe(0);
        expect(String(procError.stderr || procError.stdout)).toMatch(
          /unavailable in this component/i,
        );
      }
      expect(failed).toBe(true);
    });

    it("passes when valid evidence is provided and supports --grep filter", async () => {
      await prepareValidFixtures();
      const output = execFileSync(
        "node",
        [
          gatewayProductionEntrypoint,
          "--grep",
          "direct_root",
          "--repo-root",
          repo.repoDir,
          "--anchor",
          trustAnchorPath,
          "--envelope",
          envelopePath,
          "--signature",
          signaturePath,
        ],
        {
          cwd: repo.repoDir,
          encoding: "utf8",
        },
      );
      expect(output).toMatch(/verified.*direct_root/i);
    });

    it("fails closed when unknown flags are passed (O-01)", () => {
      let failed = false;
      try {
        execFileSync(
          "node",
          [gatewayProductionEntrypoint, "--execute-native=true"],
          {
            cwd: repo.repoDir,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
      } catch (error: unknown) {
        failed = true;
        const procError = error as { status?: number; stderr?: string };
        expect(procError.status).not.toBe(0);
        expect(String(procError.stderr)).toMatch(/unknown or malformed flag/i);
      }
      expect(failed).toBe(true);
    });

    it("fails closed when --grep matches zero cases (O-01)", async () => {
      await prepareValidFixtures();
      let failed = false;
      try {
        execFileSync(
          "node",
          [
            gatewayProductionEntrypoint,
            "--grep",
            "AUTH-05",
            "--repo-root",
            repo.repoDir,
            "--anchor",
            trustAnchorPath,
            "--envelope",
            envelopePath,
            "--signature",
            signaturePath,
          ],
          {
            cwd: repo.repoDir,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
      } catch (error: unknown) {
        failed = true;
        const procError = error as { status?: number; stderr?: string };
        expect(procError.status).not.toBe(0);
        expect(String(procError.stderr)).toMatch(/no pilot cases matched/i);
      }
      expect(failed).toBe(true);
    });

    it("regression (B-02): rejects omitted or false ownedNamespaceProof", async () => {
      const { envelope } = await prepareValidFixtures();
      const missingNs = structuredClone(envelope) as Record<string, unknown>;
      const execObj = missingNs.executionProof as Record<string, unknown>;
      const { ownedNamespaceProof: _, ...execWithoutNs } = execObj;
      missingNs.executionProof = execWithoutNs;
      writeFileSync(envelopePath, `${toCanonicalJson(missingNs)}\n`, "utf8");
      writeFileSync(
        signaturePath,
        `${toCanonicalJson(signEnvelope(missingNs as typeof envelope, keyPair.privateKeyPem, keyPair.keyId))}\n`,
        "utf8",
      );
      await expect(
        verifyNativeEvidence({
          repoRoot: repo.repoDir,
          trustAnchorPath,
          envelopePath,
          signaturePath,
        }),
      ).rejects.toThrow(/ownedNamespaceProof/i);

      const falseNs = structuredClone(envelope);
      falseNs.executionProof.ownedNamespaceProof = {
        controllerContainer: "",
        nestedDaemonOnly: false,
      };
      writeFileSync(envelopePath, `${toCanonicalJson(falseNs)}\n`, "utf8");
      writeFileSync(
        signaturePath,
        `${toCanonicalJson(signEnvelope(falseNs, keyPair.privateKeyPem, keyPair.keyId))}\n`,
        "utf8",
      );
      await expect(
        verifyNativeEvidence({
          repoRoot: repo.repoDir,
          trustAnchorPath,
          envelopePath,
          signaturePath,
        }),
      ).rejects.toThrow(
        /ownedNamespaceProof|nestedDaemonOnly|controllerContainer/i,
      );
    });

    it("regression (B-03): rejects symlinked closed directory root", async () => {
      const extDir = mkdtempSync(path.join(os.tmpdir(), "gwrk-ext-root-"));
      try {
        writeFileSync(path.join(extDir, "placeholder.txt"), "external\n");
        rmSync(path.join(repo.repoDir, "src"), {
          recursive: true,
          force: true,
        });
        symlinkSync(extDir, path.join(repo.repoDir, "src"));
        await expect(computeRuntimeManifest(repo.repoDir)).rejects.toThrow(
          /symlink/i,
        );
      } finally {
        rmSync(extDir, { recursive: true, force: true });
      }
    });

    it("regression (B-04): rejects non-ASCII untracked and staged rename-out files", async () => {
      writeFileSync(path.join(repo.repoDir, "src/café.ts"), "// untracked\n");
      await expect(computeRuntimeManifest(repo.repoDir)).rejects.toThrow(
        /untracked|dirty/i,
      );
      rmSync(path.join(repo.repoDir, "src/café.ts"));

      execFileSync("git", ["mv", "src/placeholder.txt", "specs/moved.txt"], {
        cwd: repo.repoDir,
      });
      await expect(computeRuntimeManifest(repo.repoDir)).rejects.toThrow(
        /dirty/i,
      );
    });

    it("regression (B-05): rejects extra schema fields and malleable base64 signatures", async () => {
      const { sig } = await prepareValidFixtures();
      writeFileSync(
        signaturePath,
        `${toCanonicalJson({ ...sig, extra: "injected" })}\n`,
        "utf8",
      );
      await expect(
        verifyNativeEvidence({
          repoRoot: repo.repoDir,
          trustAnchorPath,
          envelopePath,
          signaturePath,
        }),
      ).rejects.toThrow(/unknown|extra|field|schema/i);

      writeFileSync(
        signaturePath,
        `${toCanonicalJson({ ...sig, signature: `${sig.signature}!!!` })}\n`,
        "utf8",
      );
      await expect(
        verifyNativeEvidence({
          repoRoot: repo.repoDir,
          trustAnchorPath,
          envelopePath,
          signaturePath,
        }),
      ).rejects.toThrow(/base64|signature/i);
    });

    it("regression (B-06): rejects prototype keys, non-finite numbers, and invalid UTF-8", () => {
      expect(() =>
        parseAndVerifyCanonicalJson('{"__proto__":{"polluted":true}}'),
      ).toThrow(/forbidden|proto/i);
      expect(() => toCanonicalJson({ a: Number.NaN })).toThrow(
        /finite|nan|number/i,
      );
      expect(() => toCanonicalJson([1, undefined, 2])).toThrow(/undefined/i);
      expect(() =>
        parseAndVerifyCanonicalJson(
          Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]),
        ),
      ).toThrow(/utf-?8/i);
    });

    it("regression (B-07): rejects invented cases, malformed image digests, and empty receipts", async () => {
      const { envelope } = await prepareValidFixtures();
      const badCases = structuredClone(envelope);
      badCases.executionProof.pilotProof.cases = [
        ...REQUIRED_PILOT_CASES,
        "invented_case",
      ];
      writeFileSync(envelopePath, `${toCanonicalJson(badCases)}\n`, "utf8");
      writeFileSync(
        signaturePath,
        `${toCanonicalJson(signEnvelope(badCases, keyPair.privateKeyPem, keyPair.keyId))}\n`,
        "utf8",
      );
      await expect(
        verifyNativeEvidence({
          repoRoot: repo.repoDir,
          trustAnchorPath,
          envelopePath,
          signaturePath,
        }),
      ).rejects.toThrow(/case|unexpected|unknown/i);

      const badImg = structuredClone(envelope);
      badImg.buildProvenance.imagePayloadMap.dind.sourceDigest = "sha256:";
      writeFileSync(envelopePath, `${toCanonicalJson(badImg)}\n`, "utf8");
      writeFileSync(
        signaturePath,
        `${toCanonicalJson(signEnvelope(badImg, keyPair.privateKeyPem, keyPair.keyId))}\n`,
        "utf8",
      );
      await expect(
        verifyNativeEvidence({
          repoRoot: repo.repoDir,
          trustAnchorPath,
          envelopePath,
          signaturePath,
        }),
      ).rejects.toThrow(/sourceDigest|sha256/i);
    });

    it("coverage (O-03): CLOSED_RUNTIME_ROOTS covers all build inputs in package.json, tsconfig.json, and NodeArtifact.Dockerfile", () => {
      const rootDir = path.resolve(__dirname, "../..");

      expect(isUnderClosedRoot("package.json")).toBe(true);
      expect(isUnderClosedRoot("pnpm-lock.yaml")).toBe(true);
      expect(isUnderClosedRoot("pnpm-workspace.yaml")).toBe(true);
      expect(isUnderClosedRoot("tsconfig.json")).toBe(true);

      const tsconfig = JSON.parse(
        readFileSync(path.join(rootDir, "tsconfig.json"), "utf8"),
      );
      for (const inc of tsconfig.include) {
        const baseDir = inc.replace(/\/\*\*.*$/, "").replace(/\/\*.*$/, "");
        expect(isUnderClosedRoot(baseDir)).toBe(true);
      }

      const dockerfilePath = path.join(
        rootDir,
        "tests/hosted-pilot/fixtures/NodeArtifact.Dockerfile",
      );
      const dockerfileContent = readFileSync(dockerfilePath, "utf8");
      const copyLines = dockerfileContent
        .split("\n")
        .filter(
          (line) => line.startsWith("COPY ") && !line.includes("--from="),
        );

      for (const line of copyLines) {
        const parts = line.trim().split(/\s+/).slice(1, -1);
        for (const part of parts) {
          expect(isUnderClosedRoot(part)).toBe(true);
        }
      }
    });
  });
});
