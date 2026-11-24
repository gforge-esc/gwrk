import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FROZEN_SOURCE_PINS,
  LEGACY_IMAGE_ROLES,
  LegacyOfflineStageError,
  checkLegacyOfflinePreflight,
  stageLegacyOffline,
} from "./legacy-offline-stage.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function makeSampleLoadedImages() {
  return {
    traefik: {
      imageId:
        "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      rootfsLayers: [
        "sha256:aaaa111111111111111111111111111111111111111111111111111111111111",
      ],
    },
    proxy: {
      imageId:
        "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      rootfsLayers: [
        "sha256:bbbb222222222222222222222222222222222222222222222222222222222222",
      ],
    },
    nginx: {
      imageId:
        "sha256:583b7f2fce1cdb8da5ad5c39ebd3c33b98b87d493190e548bdee1fa8c619c311",
      rootfsLayers: [
        "sha256:75f1d9657d880da5f75298e8f40e9928bb6e260c50d26f97af196845307e3064",
      ],
    },
    issuerNode: {
      imageId:
        "sha256:09e2b3d9726018aecf269bd35325f46bf75046a643a66d28360ec71132750ec8",
      rootfsLayers: [
        "sha256:989e799e634906e94dc9a5ee2ee26fc92ad260522990f26e707861a5f52bf64e",
      ],
    },
  };
}

function makeInspectPort(loadedImages) {
  return {
    async inspectImage(imageId) {
      for (const role of Object.keys(loadedImages)) {
        const item = loadedImages[role];
        if (item.imageId === imageId) {
          return {
            Id: item.imageId,
            RootFS: {
              Layers: [...item.rootfsLayers],
            },
          };
        }
      }
      throw new Error(`Image not found: ${imageId}`);
    },
  };
}

function makeRealSourceFixture() {
  const tmpRoot = mkdtempSync(
    path.join(os.tmpdir(), "gwrk-legacy-stage-fixture-"),
  );
  const srcDir = path.join(tmpRoot, "source");
  mkdirSync(srcDir, { recursive: true });

  const deploySrc = path.join(repoRoot, "deploy/hosted-auth-proof");
  const testsSrc = path.join(repoRoot, "tests/hosted-auth-proof");

  cpSync(deploySrc, path.join(srcDir, "deploy/hosted-auth-proof"), {
    recursive: true,
  });
  cpSync(testsSrc, path.join(srcDir, "tests/hosted-auth-proof"), {
    recursive: true,
  });

  const trustedManifest = {};
  function collectHashes(dir, prefix) {
    const entries = readdirRecursive(dir);
    for (const rel of entries) {
      const relPath = `${prefix}/${rel}`;
      const full = path.join(srcDir, relPath);
      trustedManifest[relPath] = sha256(readFileSync(full));
    }
  }

  function readdirRecursive(current, relBase = "") {
    const result = [];
    const items = readDirSync(current);
    for (const item of items) {
      const sub = path.join(current, item);
      const rel = relBase ? `${relBase}/${item}` : item;
      const stat = statSync(sub);
      if (stat.isDirectory()) {
        result.push(...readdirRecursive(sub, rel));
      } else if (stat.isFile()) {
        result.push(rel);
      }
    }
    return result;
  }

  collectHashes(
    path.join(srcDir, "deploy/hosted-auth-proof"),
    "deploy/hosted-auth-proof",
  );
  collectHashes(
    path.join(srcDir, "tests/hosted-auth-proof"),
    "tests/hosted-auth-proof",
  );

  return {
    tmpRoot,
    srcDir,
    trustedManifest,
    cleanup: () => rmSync(tmpRoot, { recursive: true, force: true }),
  };
}

import { readdirSync as readDirSync, statSync } from "node:fs";

describe("offline legacy 041 proof staging adapter", () => {
  it("exports the four frozen roles and pins", () => {
    expect(LEGACY_IMAGE_ROLES).toEqual([
      "traefik",
      "proxy",
      "nginx",
      "issuerNode",
    ]);
    expect(FROZEN_SOURCE_PINS.traefik).toBe(
      "traefik:v3.7.18@sha256:9c437ac4f09ce6f4980a8544902d3475fdf70a1a7c578729581d2535dfa7d635",
    );
    expect(FROZEN_SOURCE_PINS.proxy).toBe(
      "quay.io/oauth2-proxy/oauth2-proxy:v7.15.6@sha256:c3415e8660af553f5e18f5d90db050614c02493c0ac6260ac59442f6d9b12048",
    );
    expect(FROZEN_SOURCE_PINS.nginx).toBe(
      "nginx:1.30.6-alpine@sha256:583b7f2fce1cdb8da5ad5c39ebd3c33b98b87d493190e548bdee1fa8c619c311",
    );
    expect(FROZEN_SOURCE_PINS.issuerNode).toBe(
      "node:20-alpine@sha256:09e2b3d9726018aecf269bd35325f46bf75046a643a66d28360ec71132750ec8",
    );
  });

  it("stages byte-identical non-compose files and substitutes only image locators in compose files", async () => {
    const { tmpRoot, srcDir, trustedManifest, cleanup } =
      makeRealSourceFixture();
    try {
      const destDir = path.join(tmpRoot, "dest/fixture/legacy-source");
      const loadedImages = makeSampleLoadedImages();
      const inspectPort = makeInspectPort(loadedImages);

      const result = await stageLegacyOffline({
        sourceRoot: srcDir,
        destinationRoot: destDir,
        trustedSourceManifest: trustedManifest,
        loadedImages,
        inspectPort,
        skipPreflight: true,
      });

      expect(result.stagedSourceRoot).toBe(destDir);
      expect(result.env.TMPDIR).toBe("/fixture/legacy-tmp");

      // Verify all files in trustedManifest are staged
      for (const relPath of Object.keys(trustedManifest)) {
        const destFile = path.join(destDir, relPath);
        const originalFile = path.join(srcDir, relPath);

        if (
          relPath === "deploy/hosted-auth-proof/compose.yaml" ||
          relPath === "tests/hosted-auth-proof/compose.test.yaml"
        ) {
          // Staged hash differs because image locators were replaced
          expect(result.stagedHashes[relPath]).not.toBe(
            result.originalHashes[relPath],
          );
        } else {
          // All other files MUST BE byte-identical
          expect(result.stagedHashes[relPath]).toBe(
            result.originalHashes[relPath],
          );
          expect(readFileSync(destFile)).toEqual(readFileSync(originalFile));
        }
      }

      // Check gateway-proof.mjs specifically: unchanged script bytes
      const origProof = readFileSync(
        path.join(srcDir, "tests/hosted-auth-proof/gateway-proof.mjs"),
        "utf8",
      );
      const stagedProof = readFileSync(
        path.join(destDir, "tests/hosted-auth-proof/gateway-proof.mjs"),
        "utf8",
      );
      expect(stagedProof).toBe(origProof);

      // Check compose.test.yaml custom tags survived: !override and !reset
      const stagedComposeTest = readFileSync(
        path.join(destDir, "tests/hosted-auth-proof/compose.test.yaml"),
        "utf8",
      );
      expect(stagedComposeTest).toContain("!override");
      expect(stagedComposeTest).toContain("!reset");
      expect(stagedComposeTest).toContain(loadedImages.issuerNode.imageId);
      expect(stagedComposeTest).not.toContain(FROZEN_SOURCE_PINS.issuerNode);

      // Check compose.yaml image substitutions
      const stagedCompose = readFileSync(
        path.join(destDir, "deploy/hosted-auth-proof/compose.yaml"),
        "utf8",
      );
      expect(stagedCompose).toContain(loadedImages.traefik.imageId);
      expect(stagedCompose).toContain(loadedImages.proxy.imageId);
      expect(stagedCompose).toContain(loadedImages.nginx.imageId);
      expect(stagedCompose).not.toContain(FROZEN_SOURCE_PINS.traefik);
      expect(stagedCompose).not.toContain(FROZEN_SOURCE_PINS.proxy);
      expect(stagedCompose).not.toContain(FROZEN_SOURCE_PINS.nginx);

      // Check locatorMap structure
      expect(result.locatorMap.traefik.sourcePin).toBe(
        FROZEN_SOURCE_PINS.traefik,
      );
      expect(result.locatorMap.traefik.stagedImageId).toBe(
        loadedImages.traefik.imageId,
      );
      expect(result.locatorMap.proxy.sourcePin).toBe(FROZEN_SOURCE_PINS.proxy);
      expect(result.locatorMap.proxy.stagedImageId).toBe(
        loadedImages.proxy.imageId,
      );
      expect(result.locatorMap.nginx.sourcePin).toBe(FROZEN_SOURCE_PINS.nginx);
      expect(result.locatorMap.nginx.stagedImageId).toBe(
        loadedImages.nginx.imageId,
      );
      expect(result.locatorMap.issuerNode.sourcePin).toBe(
        FROZEN_SOURCE_PINS.issuerNode,
      );
      expect(result.locatorMap.issuerNode.stagedImageId).toBe(
        loadedImages.issuerNode.imageId,
      );

      // Check relative path resolution from staged gateway-proof.mjs
      const fixtures = path.join(destDir, "tests/hosted-auth-proof");
      const bundle = path.resolve(fixtures, "../../deploy/hosted-auth-proof");
      expect(bundle).toBe(path.join(destDir, "deploy/hosted-auth-proof"));
    } finally {
      cleanup();
    }
  });

  it("rejects an edited legacy script", async () => {
    const { tmpRoot, srcDir, trustedManifest, cleanup } =
      makeRealSourceFixture();
    try {
      const destDir = path.join(tmpRoot, "dest");
      const loadedImages = makeSampleLoadedImages();
      const inspectPort = makeInspectPort(loadedImages);

      // Tamper with gateway-proof.mjs in the source tree
      const proofPath = path.join(
        srcDir,
        "tests/hosted-auth-proof/gateway-proof.mjs",
      );
      writeFileSync(
        proofPath,
        `${readFileSync(proofPath, "utf8")}\n// tampered`,
      );

      await expect(
        stageLegacyOffline({
          sourceRoot: srcDir,
          destinationRoot: destDir,
          trustedSourceManifest: trustedManifest,
          loadedImages,
          inspectPort,
          skipPreflight: true,
        }),
      ).rejects.toThrow(/source hash mismatch|hash mismatch/i);
    } finally {
      cleanup();
    }
  });

  it("rejects a changed custom tag in compose AST", async () => {
    const { tmpRoot, srcDir, trustedManifest, cleanup } =
      makeRealSourceFixture();
    try {
      const destDir = path.join(tmpRoot, "dest");
      const loadedImages = makeSampleLoadedImages();
      const inspectPort = makeInspectPort(loadedImages);

      // Alter !override tag in source compose.test.yaml
      const testYamlPath = path.join(
        srcDir,
        "tests/hosted-auth-proof/compose.test.yaml",
      );
      const content = readFileSync(testYamlPath, "utf8").replace(
        "ports: !override",
        "ports:",
      );
      writeFileSync(testYamlPath, content);
      // Update manifest hash so it passes file-level hash check and hits AST verification
      trustedManifest["tests/hosted-auth-proof/compose.test.yaml"] =
        sha256(content);

      await expect(
        stageLegacyOffline({
          sourceRoot: srcDir,
          destinationRoot: destDir,
          trustedSourceManifest: trustedManifest,
          loadedImages,
          inspectPort,
          skipPreflight: true,
        }),
      ).rejects.toThrow(/custom tag|!override/i);
    } finally {
      cleanup();
    }
  });

  it("rejects an attempted non-image edit in compose YAML", async () => {
    const { tmpRoot, srcDir, trustedManifest, cleanup } =
      makeRealSourceFixture();
    try {
      const destDir = path.join(tmpRoot, "dest");
      const loadedImages = makeSampleLoadedImages();
      const inspectPort = makeInspectPort(loadedImages);

      await expect(
        stageLegacyOffline({
          sourceRoot: srcDir,
          destinationRoot: destDir,
          trustedSourceManifest: trustedManifest,
          loadedImages,
          inspectPort,
          skipPreflight: true,
          _stagedModifier: (stagedDoc, relPath) => {
            if (relPath.includes("compose.yaml")) {
              stagedDoc.setIn(["services", "traefik", "restart"], "always");
            }
          },
        }),
      ).rejects.toThrow(/AST equality|non-image edit/i);
    } finally {
      cleanup();
    }
  });

  it("rejects path escape in source manifest", async () => {
    const { tmpRoot, srcDir, trustedManifest, cleanup } =
      makeRealSourceFixture();
    try {
      const destDir = path.join(tmpRoot, "dest");
      const loadedImages = makeSampleLoadedImages();
      const inspectPort = makeInspectPort(loadedImages);

      trustedManifest["../../etc/passwd"] = "0".repeat(64);

      await expect(
        stageLegacyOffline({
          sourceRoot: srcDir,
          destinationRoot: destDir,
          trustedSourceManifest: trustedManifest,
          loadedImages,
          inspectPort,
          skipPreflight: true,
        }),
      ).rejects.toThrow(/path escape/i);
    } finally {
      cleanup();
    }
  });

  it("rejects symlink in source tree", async () => {
    const { tmpRoot, srcDir, trustedManifest, cleanup } =
      makeRealSourceFixture();
    try {
      const destDir = path.join(tmpRoot, "dest");
      const loadedImages = makeSampleLoadedImages();
      const inspectPort = makeInspectPort(loadedImages);

      const linkRel = "tests/hosted-auth-proof/link.mjs";
      symlinkSync("./gateway-proof.mjs", path.join(srcDir, linkRel));
      trustedManifest[linkRel] =
        trustedManifest["tests/hosted-auth-proof/gateway-proof.mjs"];

      await expect(
        stageLegacyOffline({
          sourceRoot: srcDir,
          destinationRoot: destDir,
          trustedSourceManifest: trustedManifest,
          loadedImages,
          inspectPort,
          skipPreflight: true,
        }),
      ).rejects.toThrow(/symlink/i);
    } finally {
      cleanup();
    }
  });

  it("rejects destination overwrite or non-empty destination", async () => {
    const { tmpRoot, srcDir, trustedManifest, cleanup } =
      makeRealSourceFixture();
    try {
      const destDir = path.join(tmpRoot, "dest");
      mkdirSync(destDir, { recursive: true });
      writeFileSync(path.join(destDir, "pre-existing.txt"), "forbidden");

      const loadedImages = makeSampleLoadedImages();
      const inspectPort = makeInspectPort(loadedImages);

      await expect(
        stageLegacyOffline({
          sourceRoot: srcDir,
          destinationRoot: destDir,
          trustedSourceManifest: trustedManifest,
          loadedImages,
          inspectPort,
          skipPreflight: true,
        }),
      ).rejects.toThrow(/destination.*not empty|already exists/i);
    } finally {
      cleanup();
    }
  });

  it("rejects bad image identity from readonly inspect port", async () => {
    const { tmpRoot, srcDir, trustedManifest, cleanup } =
      makeRealSourceFixture();
    try {
      const destDir = path.join(tmpRoot, "dest");
      const loadedImages = makeSampleLoadedImages();
      // Bad inspect port returns wrong rootfs layer for nginx
      const badInspectPort = {
        async inspectImage(imageId) {
          const res = await makeInspectPort(loadedImages).inspectImage(imageId);
          if (imageId === loadedImages.nginx.imageId) {
            return {
              ...res,
              RootFS: { Layers: ["sha256:corrupted-layer"] },
            };
          }
          return res;
        },
      };

      await expect(
        stageLegacyOffline({
          sourceRoot: srcDir,
          destinationRoot: destDir,
          trustedSourceManifest: trustedManifest,
          loadedImages,
          inspectPort: badInspectPort,
          skipPreflight: true,
        }),
      ).rejects.toThrow(/payload identity|rootfs/i);
    } finally {
      cleanup();
    }
  });

  it("rejects missing image role", async () => {
    const { tmpRoot, srcDir, trustedManifest, cleanup } =
      makeRealSourceFixture();
    try {
      const destDir = path.join(tmpRoot, "dest");
      const { issuerNode: _, ...loadedImages } = makeSampleLoadedImages();
      const inspectPort = makeInspectPort(loadedImages);

      await expect(
        stageLegacyOffline({
          sourceRoot: srcDir,
          destinationRoot: destDir,
          trustedSourceManifest: trustedManifest,
          loadedImages,
          inspectPort,
          skipPreflight: true,
        }),
      ).rejects.toThrow(/missing.*role|image role/i);
    } finally {
      cleanup();
    }
  });

  it("rejects unknown or additional image role", async () => {
    const { tmpRoot, srcDir, trustedManifest, cleanup } =
      makeRealSourceFixture();
    try {
      const destDir = path.join(tmpRoot, "dest");
      const loadedImages = {
        ...makeSampleLoadedImages(),
        unexpectedRole: {
          imageId:
            "sha256:9999999999999999999999999999999999999999999999999999999999999999",
          rootfsLayers: ["sha256:9999"],
        },
      };
      const inspectPort = makeInspectPort(loadedImages);

      await expect(
        stageLegacyOffline({
          sourceRoot: srcDir,
          destinationRoot: destDir,
          trustedSourceManifest: trustedManifest,
          loadedImages,
          inspectPort,
          skipPreflight: true,
        }),
      ).rejects.toThrow(/unknown.*role|additional.*role|image role/i);
    } finally {
      cleanup();
    }
  });

  it("rejects wrong source pin in compose YAML", async () => {
    const { tmpRoot, srcDir, trustedManifest, cleanup } =
      makeRealSourceFixture();
    try {
      const destDir = path.join(tmpRoot, "dest");
      const loadedImages = makeSampleLoadedImages();
      const inspectPort = makeInspectPort(loadedImages);

      // Change pin to wrong digest in compose.yaml
      const composePath = path.join(
        srcDir,
        "deploy/hosted-auth-proof/compose.yaml",
      );
      const content = readFileSync(composePath, "utf8").replace(
        FROZEN_SOURCE_PINS.traefik,
        "traefik:v3.7.18@sha256:0000000000000000000000000000000000000000000000000000000000000000",
      );
      writeFileSync(composePath, content);
      trustedManifest["deploy/hosted-auth-proof/compose.yaml"] =
        sha256(content);

      await expect(
        stageLegacyOffline({
          sourceRoot: srcDir,
          destinationRoot: destDir,
          trustedSourceManifest: trustedManifest,
          loadedImages,
          inspectPort,
          skipPreflight: true,
        }),
      ).rejects.toThrow(/wrong.*source pin|source pin mismatch/i);
    } finally {
      cleanup();
    }
  });

  it("rejects absent source root directory", async () => {
    const tmpRoot = mkdtempSync(
      path.join(os.tmpdir(), "gwrk-absent-source-test-"),
    );
    try {
      const destDir = path.join(tmpRoot, "dest");
      const loadedImages = makeSampleLoadedImages();
      const inspectPort = makeInspectPort(loadedImages);

      await expect(
        stageLegacyOffline({
          sourceRoot: path.join(tmpRoot, "nonexistent-source"),
          destinationRoot: destDir,
          trustedSourceManifest: {},
          loadedImages,
          inspectPort,
          skipPreflight: true,
        }),
      ).rejects.toThrow(/source root directory does not exist/i);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("rejects destination that is a symlink", async () => {
    const { tmpRoot, srcDir, trustedManifest, cleanup } =
      makeRealSourceFixture();
    try {
      const realDir = path.join(tmpRoot, "real-dest");
      mkdirSync(realDir, { recursive: true });
      const linkDest = path.join(tmpRoot, "link-dest");
      symlinkSync(realDir, linkDest);

      const loadedImages = makeSampleLoadedImages();
      const inspectPort = makeInspectPort(loadedImages);

      await expect(
        stageLegacyOffline({
          sourceRoot: srcDir,
          destinationRoot: linkDest,
          trustedSourceManifest: trustedManifest,
          loadedImages,
          inspectPort,
          skipPreflight: true,
        }),
      ).rejects.toThrow(/symlink/i);
    } finally {
      cleanup();
    }
  });

  describe("preflight checks", () => {
    it("passes preflight on valid shared path and available dependencies", async () => {
      const tmpDir = mkdtempSync(path.join(os.tmpdir(), "gwrk-mount-pass-"));
      try {
        const result = await checkLegacyOfflinePreflight({
          tmpdir: path.join(tmpDir, "legacy-tmp"),
          sharedMountPath: tmpDir,
          mountChecker: () => true,
          commandRunner: () => "version ok",
        });
        expect(result.mode).toBe(0o755);
        expect(result.sharedMountPath).toBe(tmpDir);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
    it("rejects private /tmp location for TMPDIR", async () => {
      await expect(
        checkLegacyOfflinePreflight({
          tmpdir: "/tmp/legacy-tmp",
          sharedMountPath: "/fixture",
        }),
      ).rejects.toThrow(/private \/tmp/i);

      await expect(
        checkLegacyOfflinePreflight({
          tmpdir: "/tmp",
          sharedMountPath: "/fixture",
        }),
      ).rejects.toThrow(/private \/tmp/i);

      await expect(
        checkLegacyOfflinePreflight({
          tmpdir: "/var/tmp",
          sharedMountPath: "/fixture",
        }),
      ).rejects.toThrow(/private \/tmp/i);
    });

    it("rejects wrong mount identity when mount checker indicates mismatch", async () => {
      const tmpDir = mkdtempSync(path.join(os.tmpdir(), "gwrk-mount-test-"));
      try {
        await expect(
          checkLegacyOfflinePreflight({
            tmpdir: path.join(tmpDir, "legacy-tmp"),
            sharedMountPath: tmpDir,
            mountChecker: () => {
              throw new Error("wrong mount identity: path is not mounted");
            },
          }),
        ).rejects.toThrow(/wrong mount identity/i);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("rejects missing dependency (openssl, curl, or compose)", async () => {
      const tmpDir = mkdtempSync(path.join(os.tmpdir(), "gwrk-mount-test-"));
      try {
        const dummyChecker = () => true;

        // openssl missing
        await expect(
          checkLegacyOfflinePreflight({
            tmpdir: path.join(tmpDir, "legacy-tmp"),
            sharedMountPath: tmpDir,
            mountChecker: dummyChecker,
            commandRunner: (cmd) => {
              if (cmd[0] === "openssl") throw new Error("ENOENT openssl");
              return "";
            },
          }),
        ).rejects.toThrow(/openssl/i);

        // curl missing
        await expect(
          checkLegacyOfflinePreflight({
            tmpdir: path.join(tmpDir, "legacy-tmp"),
            sharedMountPath: tmpDir,
            mountChecker: dummyChecker,
            commandRunner: (cmd) => {
              if (cmd[0] === "curl") throw new Error("ENOENT curl");
              return "";
            },
          }),
        ).rejects.toThrow(/curl/i);

        // compose missing
        await expect(
          checkLegacyOfflinePreflight({
            tmpdir: path.join(tmpDir, "legacy-tmp"),
            sharedMountPath: tmpDir,
            mountChecker: dummyChecker,
            commandRunner: (cmd) => {
              if (cmd[0] === "docker" && cmd[1] === "compose")
                throw new Error("docker compose not available");
              return "";
            },
          }),
        ).rejects.toThrow(/compose/i);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
