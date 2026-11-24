/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalJsonSha256, toCanonicalJson } from "./canonical-json.ts";
import {
  type DetachedSignature,
  type ImagePayloadEntry,
  type NativeEvidenceEnvelope,
  REQUIRED_IMAGE_ROLES,
  REQUIRED_PILOT_CASES,
} from "./evidence-schema.ts";
import { CLOSED_RUNTIME_ROOTS } from "./runtime-manifest.ts";
import type { NativeEvidenceTrustAnchor } from "./trust-anchor.ts";

export interface TestKeyPair {
  publicKeyPem: string;
  privateKeyPem: string;
  keyId: string;
}

export function createTestKeyPair(): TestKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const keyId = createHash("sha256").update(publicKey, "utf8").digest("hex");
  return {
    publicKeyPem: publicKey,
    privateKeyPem: privateKey,
    keyId,
  };
}

export function createTestAnchor(
  keyPair: TestKeyPair,
): NativeEvidenceTrustAnchor {
  return {
    schemaVersion: "1.0.0",
    algorithm: "ed25519",
    keyId: keyPair.keyId,
    publicKeySpki: keyPair.publicKeyPem,
    role: "operator-root",
  };
}

export function signEnvelope(
  envelope: NativeEvidenceEnvelope,
  privateKeyPem: string,
  keyId: string,
): DetachedSignature {
  const canonicalBytes = Buffer.from(toCanonicalJson(envelope), "utf8");
  const signatureBytes = sign(undefined, canonicalBytes, privateKeyPem);
  return {
    schemaVersion: "1.0.0",
    keyId,
    signature: signatureBytes.toString("base64"),
  };
}

export function createValidImagePayloadMap(): Record<
  (typeof REQUIRED_IMAGE_ROLES)[number],
  ImagePayloadEntry
> {
  const result = {} as Record<
    (typeof REQUIRED_IMAGE_ROLES)[number],
    ImagePayloadEntry
  >;
  for (const role of REQUIRED_IMAGE_ROLES) {
    result[role] = {
      role,
      sourceDigest: `sha256:${createHash("sha256").update(`source-${role}`).digest("hex")}`,
      loadedImageId: `sha256:${createHash("sha256").update(`loaded-${role}`).digest("hex")}`,
    };
  }
  return result;
}

export function createValidEnvelope(params: {
  reviewedCommitSha: string;
  runtimeManifestSha256: string;
  legacy041ScriptSha256: string;
  trustAnchorSha256: string;
}): NativeEvidenceEnvelope {
  const pilotReceipt = JSON.stringify({
    event: "gateway_acceptance_passed",
    cases: [...REQUIRED_PILOT_CASES],
  });
  const legacyReceipt = JSON.stringify({
    event: "legacy_041_passed",
    marker: "Hosted sign-in fixture passed",
  });

  return {
    schemaVersion: "1.0.0",
    nativeSuiteStatus: "passed",
    livePilotAcceptance: false,
    reviewedCommitSha: params.reviewedCommitSha,
    runtimeManifestSha256: params.runtimeManifestSha256,
    legacy041ScriptSha256: params.legacy041ScriptSha256,
    trustAnchorSha256: params.trustAnchorSha256,
    buildProvenance: {
      architecture: "linux/amd64",
      applicationArtifact: {
        identity: "gwrk-application-linux-amd64",
        sha256: createHash("sha256").update("app-artifact").digest("hex"),
        runtimeManifestSha256: params.runtimeManifestSha256,
      },
      imagePayloadMap: createValidImagePayloadMap(),
    },
    executionProof: {
      runId: "0123456789abcdef01234567",
      ownedNamespaceProof: {
        controllerContainer: "gwrk-051-controller-0123456789abcdef01234567",
        nestedDaemonOnly: true,
      },
      cleanupComplete: true,
      hostMountsUnderChild: false,
      pilotProof: {
        exitCode: 0,
        cases: [...REQUIRED_PILOT_CASES],
        captureDrops: 0,
        captureFaults: 0,
        leakedSecrets: 0,
        rawReceiptSha256: createHash("sha256")
          .update(pilotReceipt)
          .digest("hex"),
      },
      legacyProof: {
        exitCode: 0,
        scriptSha256: params.legacy041ScriptSha256,
        successMarker: "Hosted sign-in fixture passed",
        cleanupComplete: true,
        rawReceiptSha256: createHash("sha256")
          .update(legacyReceipt)
          .digest("hex"),
      },
    },
    rawReceipts: {
      pilotReceipt,
      legacyReceipt,
    },
  };
}

export interface TestRepoContext {
  repoDir: string;
  commitSha: string;
  legacyScriptPath: string;
  legacyScriptSha256: string;
  cleanup: () => void;
}

export function setupHermeticTestRepo(): TestRepoContext {
  const repoDir = mkdtempSync(
    path.join(os.tmpdir(), "gwrk-native-evidence-test-"),
  );

  const git = (...args: string[]) => {
    return execFileSync("git", args, {
      cwd: repoDir,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "David Gonzo Gonzalez",
        GIT_AUTHOR_EMAIL: "gonzodbg@gmail.com",
        GIT_COMMITTER_NAME: "David Gonzo Gonzalez",
        GIT_COMMITTER_EMAIL: "gonzodbg@gmail.com",
      },
    }).trim();
  };

  git("init", "-b", "main");
  git("config", "user.name", "David Gonzo Gonzalez");
  git("config", "user.email", "gonzodbg@gmail.com");

  // Create required 10 runtime roots
  for (const root of CLOSED_RUNTIME_ROOTS) {
    const fullPath = path.join(repoDir, root);
    if (root.endsWith("/")) {
      mkdirSync(fullPath, { recursive: true });
      writeFileSync(
        path.join(fullPath, "placeholder.txt"),
        `content for ${root}\n`,
      );
    } else {
      mkdirSync(path.dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, `content for ${root}\n`);
    }
  }

  // Create legacy script
  const legacyScriptPath = path.join(
    repoDir,
    "tests/hosted-auth-proof/gateway-proof.mjs",
  );
  const legacyContent =
    '// legacy 041 gateway proof fixture\nprocess.stdout.write("Hosted sign-in fixture passed\\n");\n';
  writeFileSync(legacyScriptPath, legacyContent, { mode: 0o755 });
  const legacyScriptSha256 = createHash("sha256")
    .update(legacyContent)
    .digest("hex");

  // Create specs directory (bookkeeping, outside closed roots)
  mkdirSync(path.join(repoDir, "specs/051-hosted-aws-pilot/contracts"), {
    recursive: true,
  });
  mkdirSync(path.join(repoDir, "specs/051-hosted-aws-pilot/evidence"), {
    recursive: true,
  });

  git("add", ".");
  git("commit", "-m", "initial test commit");
  const commitSha = git("rev-parse", "HEAD");

  return {
    repoDir,
    commitSha,
    legacyScriptPath,
    legacyScriptSha256,
    cleanup: () => {
      rmSync(repoDir, { recursive: true, force: true });
    },
  };
}
