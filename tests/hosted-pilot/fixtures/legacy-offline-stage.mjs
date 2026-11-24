import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as defaultFs from "node:fs";
import path from "node:path";
import { isMap, isScalar, isSeq, parseDocument } from "yaml";

export const LEGACY_IMAGE_ROLES = Object.freeze([
  "traefik",
  "proxy",
  "nginx",
  "issuerNode",
]);

export const FROZEN_SOURCE_PINS = Object.freeze({
  traefik:
    "traefik:v3.7.18@sha256:9c437ac4f09ce6f4980a8544902d3475fdf70a1a7c578729581d2535dfa7d635",
  proxy:
    "quay.io/oauth2-proxy/oauth2-proxy:v7.15.6@sha256:c3415e8660af553f5e18f5d90db050614c02493c0ac6260ac59442f6d9b12048",
  nginx:
    "nginx:1.30.6-alpine@sha256:583b7f2fce1cdb8da5ad5c39ebd3c33b98b87d493190e548bdee1fa8c619c311",
  issuerNode:
    "node:20-alpine@sha256:09e2b3d9726018aecf269bd35325f46bf75046a643a66d28360ec71132750ec8",
});

export const FROZEN_LEGACY_SOURCE_MANIFEST = Object.freeze({
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
  "tests/hosted-auth-proof/compose.test.yaml":
    "9e42ae1762e0e2b25cc417c2d506c87c1c8f9a025c4700cc96b31544e7a91e12",
  "tests/hosted-auth-proof/gateway-proof.mjs":
    "a7f6079db2ff651153fd96802282138ff96da8cb41462a831c07460a6e10741c",
  "tests/hosted-auth-proof/oidc-issuer.mjs":
    "226071c60405713828f9778d9199c5d3838aabb2b430b05c772ca0cb676ea6d2",
  "tests/hosted-auth-proof/preflight.test.ts":
    "dc9a9585dc0607d6702fc04237defb4dd3552ef382b859d55d3254bdb0dc90c1",
  "tests/hosted-auth-proof/production-bundle.test.ts":
    "4267ba0cc3c8bb8244efa25ca925a4bdbfc40fb81b86f1dca66ed0e3ef04464f",
});

export const YAML_CUSTOM_TAGS = [
  { tag: "!override", collection: "seq" },
  { tag: "!override", collection: "map" },
  { tag: "!override", resolve: (val) => val },
  { tag: "!reset", collection: "seq" },
  { tag: "!reset", collection: "map" },
  { tag: "!reset", resolve: (val) => (val === "null" ? null : val) },
];

export class LegacyOfflineStageError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "LegacyOfflineStageError";
    this.details = details;
  }
}

export function assertSafeRelativePath(relPath) {
  if (typeof relPath !== "string" || !relPath.trim()) {
    throw new LegacyOfflineStageError("Path must be a non-empty string");
  }
  if (relPath.startsWith("/") || relPath.startsWith("\\")) {
    throw new LegacyOfflineStageError(
      `path escape: absolute path rejected: ${relPath}`,
    );
  }
  const segments = relPath.split(/[/\\]/);
  if (segments.includes("..")) {
    throw new LegacyOfflineStageError(
      `path escape: '..' rejected in path: ${relPath}`,
    );
  }
}

export function normalizeAst(node, pathArr = []) {
  if (isMap(node)) {
    return {
      type: "map",
      tag: node.tag ?? null,
      items: node.items.map((pair) => {
        const keyStr = String(pair.key?.value ?? pair.key);
        return {
          key: normalizeAst(pair.key, pathArr),
          value: normalizeAst(pair.value, [...pathArr, keyStr]),
        };
      }),
    };
  }
  if (isSeq(node)) {
    return {
      type: "seq",
      tag: node.tag ?? null,
      items: node.items.map((item, idx) =>
        normalizeAst(item, [...pathArr, String(idx)]),
      ),
    };
  }
  if (isScalar(node)) {
    const isImageField =
      pathArr.length === 3 &&
      pathArr[0] === "services" &&
      pathArr[2] === "image";
    return {
      type: "scalar",
      tag: node.tag ?? null,
      value: isImageField ? "__PERMITTED_IMAGE_SCALAR__" : node.value,
    };
  }
  return {
    type: "primitive",
    tag: node?.tag ?? null,
    value: node?.value ?? node,
  };
}

export function verifyRequiredComposeTags(doc, fileName = "") {
  if (!fileName.endsWith("compose.test.yaml")) return;
  const traefik = doc.getIn(["services", "traefik"]);
  if (!traefik) {
    throw new LegacyOfflineStageError(
      `Missing services.traefik in ${fileName}`,
    );
  }
  const ports = traefik.get?.("ports", true);
  if (ports?.tag !== "!override") {
    throw new LegacyOfflineStageError(
      `Changed custom tag: expected !override on services.traefik.ports in ${fileName}, got ${ports?.tag}`,
      {
        service: "traefik",
        field: "ports",
        expectedTag: "!override",
        actualTag: ports?.tag,
      },
    );
  }
  const command = traefik.get?.("command", true);
  if (command?.tag !== "!override") {
    throw new LegacyOfflineStageError(
      `Changed custom tag: expected !override on services.traefik.command in ${fileName}, got ${command?.tag}`,
      {
        service: "traefik",
        field: "command",
        expectedTag: "!override",
        actualTag: command?.tag,
      },
    );
  }
  const volumes = traefik.get?.("volumes", true);
  if (volumes?.tag !== "!override") {
    throw new LegacyOfflineStageError(
      `Changed custom tag: expected !override on services.traefik.volumes in ${fileName}, got ${volumes?.tag}`,
      {
        service: "traefik",
        field: "volumes",
        expectedTag: "!override",
        actualTag: volumes?.tag,
      },
    );
  }
  const networks = traefik.get?.("networks", true);
  if (networks?.tag !== "!override") {
    throw new LegacyOfflineStageError(
      `Changed custom tag: expected !override on services.traefik.networks in ${fileName}, got ${networks?.tag}`,
      {
        service: "traefik",
        field: "networks",
        expectedTag: "!override",
        actualTag: networks?.tag,
      },
    );
  }
  const auth = doc.getIn(["networks", "auth"]);
  const ipam = auth?.get?.("ipam", true);
  if (ipam?.tag !== "!reset") {
    throw new LegacyOfflineStageError(
      `Changed custom tag: expected !reset on networks.auth.ipam in ${fileName}, got ${ipam?.tag}`,
      {
        network: "auth",
        field: "ipam",
        expectedTag: "!reset",
        actualTag: ipam?.tag,
      },
    );
  }
}

export function assertNormalizedAstEquality(
  sourceDoc,
  stagedDoc,
  fileName = "",
) {
  const normSource = normalizeAst(sourceDoc.contents);
  const normStaged = normalizeAst(stagedDoc.contents);
  try {
    assert.deepEqual(normSource, normStaged);
  } catch (err) {
    throw new LegacyOfflineStageError(
      `Normalized AST equality check failed: non-image edit or altered custom tag in ${fileName}`,
      { originalError: err.message, fileName },
    );
  }
}

export function validateLoadedImages(loadedImages) {
  if (!loadedImages || typeof loadedImages !== "object") {
    throw new LegacyOfflineStageError("Missing loaded images map");
  }
  const keys = Object.keys(loadedImages);
  for (const role of LEGACY_IMAGE_ROLES) {
    if (!loadedImages[role]) {
      throw new LegacyOfflineStageError(
        `missing required legacy image role: ${role}`,
        { role },
      );
    }
  }
  for (const key of keys) {
    if (!LEGACY_IMAGE_ROLES.includes(key)) {
      throw new LegacyOfflineStageError(
        `unknown or additional legacy image role: ${key}`,
        { role: key },
      );
    }
  }
}

export async function verifyLoadedImageIdentities(loadedImages, inspectPort) {
  validateLoadedImages(loadedImages);
  if (!inspectPort) {
    throw new LegacyOfflineStageError(
      "Missing inspectPort for loaded image verification",
    );
  }

  for (const role of LEGACY_IMAGE_ROLES) {
    const item = loadedImages[role];
    const imageId = typeof item === "string" ? item : item.imageId;
    const expectedLayers = Array.isArray(item?.rootfsLayers)
      ? item.rootfsLayers
      : Array.isArray(item?.rootfsDiffIds)
        ? item.rootfsDiffIds
        : null;

    if (
      !imageId ||
      typeof imageId !== "string" ||
      !imageId.startsWith("sha256:")
    ) {
      throw new LegacyOfflineStageError(
        `Invalid loaded image ID for role ${role}: ${imageId}`,
        { role, imageId },
      );
    }

    let inspected;
    try {
      if (typeof inspectPort.inspectImage === "function") {
        inspected = await inspectPort.inspectImage(imageId);
      } else if (typeof inspectPort === "function") {
        inspected = await inspectPort(imageId);
      } else {
        throw new Error("inspectPort does not provide inspectImage function");
      }
    } catch (err) {
      throw new LegacyOfflineStageError(
        `Failed to inspect loaded image payload for role ${role} (${imageId}): ${err.message}`,
        { role, imageId, originalError: err.message },
      );
    }

    if (!inspected) {
      throw new LegacyOfflineStageError(
        `No inspection result returned for role ${role} (${imageId})`,
        { role, imageId },
      );
    }

    const actualId = inspected.Id ?? inspected.imageId;
    if (actualId !== imageId) {
      throw new LegacyOfflineStageError(
        `payload identity mismatch for role ${role}: expected ${imageId}, inspected ${actualId}`,
        { role, expected: imageId, actual: actualId },
      );
    }

    if (expectedLayers) {
      const actualLayers =
        inspected.RootFS?.Layers ??
        inspected.rootfsLayers ??
        inspected.rootfsDiffIds;
      if (!Array.isArray(actualLayers)) {
        throw new LegacyOfflineStageError(
          `Missing rootfs layers in inspect result for role ${role}`,
          { role, inspected },
        );
      }
      try {
        assert.deepEqual(actualLayers, expectedLayers);
      } catch (err) {
        throw new LegacyOfflineStageError(
          `payload identity rootfs layer mismatch for role ${role}`,
          { role, expectedLayers, actualLayers },
        );
      }
    }
  }
}

export async function checkLegacyOfflinePreflight({
  tmpdir = process.env.TMPDIR || "/fixture/legacy-tmp",
  sharedMountPath = "/fixture",
  mountChecker,
  commandRunner,
  filesystem,
} = {}) {
  const fs = filesystem ?? defaultFs;

  if (!tmpdir || typeof tmpdir !== "string") {
    throw new LegacyOfflineStageError("TMPDIR must be a non-empty path string");
  }
  const normalizedTmp = path.resolve(tmpdir);
  if (
    normalizedTmp === "/tmp" ||
    normalizedTmp === "/var/tmp" ||
    normalizedTmp.startsWith("/tmp/") ||
    normalizedTmp.startsWith("/var/tmp/")
  ) {
    throw new LegacyOfflineStageError(
      `private /tmp location rejected for legacy proof: TMPDIR must be under shared ${sharedMountPath}, got ${tmpdir}`,
      { tmpdir },
    );
  }

  try {
    fs.mkdirSync(tmpdir, { recursive: true, mode: 0o755 });
    fs.chmodSync(tmpdir, 0o755);
  } catch (err) {
    throw new LegacyOfflineStageError(
      `Failed to create or set mode 0755 on TMPDIR ${tmpdir}: ${err.message}`,
      { tmpdir, originalError: err.message },
    );
  }

  if (typeof mountChecker === "function") {
    try {
      const ok = await mountChecker({ sharedMountPath, tmpdir });
      if (ok === false) {
        throw new Error("mountChecker returned false");
      }
    } catch (err) {
      throw new LegacyOfflineStageError(
        `wrong mount identity for shared path ${sharedMountPath}: ${err.message}`,
        { sharedMountPath, originalError: err.message },
      );
    }
  } else {
    const mountinfoPath = "/proc/self/mountinfo";
    if (fs.existsSync(mountinfoPath)) {
      const lines = fs.readFileSync(mountinfoPath, "utf8").trim().split("\n");
      const isMounted = lines.some((line) => {
        const parts = line.split(" ");
        return (
          parts[4] === sharedMountPath ||
          parts[4] === path.resolve(sharedMountPath)
        );
      });
      if (!isMounted) {
        throw new LegacyOfflineStageError(
          `wrong mount identity: ${sharedMountPath} is not a mounted target in ${mountinfoPath}`,
          { sharedMountPath },
        );
      }
    }
  }

  const runner =
    commandRunner ??
    ((cmd) => {
      return execFileSync(cmd[0], cmd.slice(1), {
        encoding: "utf8",
        timeout: 5000,
        stdio: "pipe",
      });
    });

  try {
    runner(["openssl", "version"]);
  } catch (err) {
    throw new LegacyOfflineStageError(
      `missing required dependency 'openssl': ${err.message}`,
      { dependency: "openssl", originalError: err.message },
    );
  }

  try {
    runner(["curl", "--version"]);
  } catch (err) {
    throw new LegacyOfflineStageError(
      `missing required dependency 'curl': ${err.message}`,
      { dependency: "curl", originalError: err.message },
    );
  }

  try {
    runner(["docker", "compose", "version"]);
  } catch (err) {
    throw new LegacyOfflineStageError(
      `missing required dependency 'compose': ${err.message}`,
      { dependency: "compose", originalError: err.message },
    );
  }

  return {
    tmpdir,
    sharedMountPath,
    mode: 0o755,
  };
}

export async function stageLegacyOffline({
  sourceRoot,
  destinationRoot,
  trustedSourceManifest = FROZEN_LEGACY_SOURCE_MANIFEST,
  loadedImages,
  inspectPort,
  tmpdir = "/fixture/legacy-tmp",
  sharedMountPath = "/fixture",
  filesystem,
  mountChecker,
  commandRunner,
  skipPreflight = false,
  _stagedModifier,
}) {
  const fs = filesystem ?? defaultFs;

  if (!skipPreflight) {
    await checkLegacyOfflinePreflight({
      tmpdir,
      sharedMountPath,
      mountChecker,
      commandRunner,
      filesystem: fs,
    });
  }

  await verifyLoadedImageIdentities(loadedImages, inspectPort);

  if (!sourceRoot || !fs.existsSync(sourceRoot)) {
    throw new LegacyOfflineStageError(
      `Source root directory does not exist: ${sourceRoot}`,
      { sourceRoot },
    );
  }

  if (fs.existsSync(destinationRoot)) {
    const destStat = fs.lstatSync(destinationRoot);
    if (destStat.isSymbolicLink()) {
      throw new LegacyOfflineStageError(
        `symlink rejected: destination directory is a symbolic link: ${destinationRoot}`,
        { destinationRoot },
      );
    }
    const existing = fs.readdirSync(destinationRoot);
    if (existing.length > 0) {
      throw new LegacyOfflineStageError(
        `destination directory already exists and is not empty: ${destinationRoot}`,
        { destinationRoot },
      );
    }
  } else {
    fs.mkdirSync(destinationRoot, { recursive: true, mode: 0o755 });
  }

  const originalHashes = {};
  const stagedHashes = {};

  for (const [relPath, expectedHash] of Object.entries(trustedSourceManifest)) {
    assertSafeRelativePath(relPath);
    const fullSourcePath = path.join(sourceRoot, relPath);

    if (!fs.existsSync(fullSourcePath)) {
      throw new LegacyOfflineStageError(
        `Source file missing from source tree: ${relPath}`,
        { relPath, fullSourcePath },
      );
    }

    const lstat = fs.lstatSync(fullSourcePath);
    if (lstat.isSymbolicLink()) {
      throw new LegacyOfflineStageError(
        `symlink rejected in source tree: ${relPath}`,
        { relPath },
      );
    }
    if (!lstat.isFile()) {
      throw new LegacyOfflineStageError(
        `Source entry is not a regular file: ${relPath}`,
        { relPath },
      );
    }

    const raw = fs.readFileSync(fullSourcePath);
    const actualHash = createHash("sha256").update(raw).digest("hex");
    if (actualHash !== expectedHash) {
      throw new LegacyOfflineStageError(
        `source hash mismatch for ${relPath}: expected ${expectedHash}, got ${actualHash}`,
        { relPath, expectedHash, actualHash },
      );
    }
    originalHashes[relPath] = actualHash;
  }

  const composeYamlRel = "deploy/hosted-auth-proof/compose.yaml";
  const composeTestYamlRel = "tests/hosted-auth-proof/compose.test.yaml";

  for (const relPath of Object.keys(trustedSourceManifest)) {
    const fullSourcePath = path.join(sourceRoot, relPath);
    const fullDestPath = path.join(destinationRoot, relPath);
    const srcStat = fs.statSync(fullSourcePath);

    const parentDir = path.dirname(fullDestPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true, mode: 0o755 });
    }

    if (fs.existsSync(fullDestPath)) {
      throw new LegacyOfflineStageError(
        `destination file already exists: ${fullDestPath}`,
        { fullDestPath },
      );
    }

    if (relPath === composeYamlRel) {
      const sourceContent = fs.readFileSync(fullSourcePath, "utf8");
      const sourceDoc = parseDocument(sourceContent, {
        customTags: YAML_CUSTOM_TAGS,
      });
      const stagedDoc = parseDocument(sourceContent, {
        customTags: YAML_CUSTOM_TAGS,
      });

      const traefikSrc = sourceDoc.getIn(["services", "traefik", "image"]);
      if (traefikSrc !== FROZEN_SOURCE_PINS.traefik) {
        throw new LegacyOfflineStageError(
          `wrong source pin for traefik in ${relPath}: expected ${FROZEN_SOURCE_PINS.traefik}, got ${traefikSrc}`,
          {
            service: "traefik",
            expected: FROZEN_SOURCE_PINS.traefik,
            actual: traefikSrc,
          },
        );
      }
      const proxySrc = sourceDoc.getIn(["services", "oauth2-proxy", "image"]);
      if (proxySrc !== FROZEN_SOURCE_PINS.proxy) {
        throw new LegacyOfflineStageError(
          `wrong source pin for oauth2-proxy in ${relPath}: expected ${FROZEN_SOURCE_PINS.proxy}, got ${proxySrc}`,
          {
            service: "oauth2-proxy",
            expected: FROZEN_SOURCE_PINS.proxy,
            actual: proxySrc,
          },
        );
      }
      const nginxSrc = sourceDoc.getIn(["services", "status", "image"]);
      if (nginxSrc !== FROZEN_SOURCE_PINS.nginx) {
        throw new LegacyOfflineStageError(
          `wrong source pin for status/nginx in ${relPath}: expected ${FROZEN_SOURCE_PINS.nginx}, got ${nginxSrc}`,
          {
            service: "status",
            expected: FROZEN_SOURCE_PINS.nginx,
            actual: nginxSrc,
          },
        );
      }

      const traefikId = loadedImages.traefik.imageId ?? loadedImages.traefik;
      const proxyId = loadedImages.proxy.imageId ?? loadedImages.proxy;
      const nginxId = loadedImages.nginx.imageId ?? loadedImages.nginx;

      stagedDoc.setIn(["services", "traefik", "image"], traefikId);
      stagedDoc.setIn(["services", "oauth2-proxy", "image"], proxyId);
      stagedDoc.setIn(["services", "status", "image"], nginxId);

      if (typeof _stagedModifier === "function") {
        _stagedModifier(stagedDoc, relPath);
      }

      assertNormalizedAstEquality(sourceDoc, stagedDoc, relPath);

      const stagedYamlStr = stagedDoc.toString();
      fs.writeFileSync(fullDestPath, stagedYamlStr, {
        mode: srcStat.mode & 0o777,
      });
      fs.chmodSync(fullDestPath, srcStat.mode & 0o777);

      const reReadDoc = parseDocument(stagedYamlStr, {
        customTags: YAML_CUSTOM_TAGS,
      });
      assertNormalizedAstEquality(sourceDoc, reReadDoc, relPath);

      stagedHashes[relPath] = createHash("sha256")
        .update(stagedYamlStr)
        .digest("hex");
    } else if (relPath === composeTestYamlRel) {
      const sourceContent = fs.readFileSync(fullSourcePath, "utf8");
      const sourceDoc = parseDocument(sourceContent, {
        customTags: YAML_CUSTOM_TAGS,
      });
      const stagedDoc = parseDocument(sourceContent, {
        customTags: YAML_CUSTOM_TAGS,
      });

      verifyRequiredComposeTags(sourceDoc, relPath);

      const issuerSrc = sourceDoc.getIn(["services", "issuer", "image"]);
      if (issuerSrc !== FROZEN_SOURCE_PINS.issuerNode) {
        throw new LegacyOfflineStageError(
          `wrong source pin for issuer in ${relPath}: expected ${FROZEN_SOURCE_PINS.issuerNode}, got ${issuerSrc}`,
          {
            service: "issuer",
            expected: FROZEN_SOURCE_PINS.issuerNode,
            actual: issuerSrc,
          },
        );
      }

      const issuerId =
        loadedImages.issuerNode.imageId ?? loadedImages.issuerNode;
      stagedDoc.setIn(["services", "issuer", "image"], issuerId);

      if (typeof _stagedModifier === "function") {
        _stagedModifier(stagedDoc, relPath);
      }

      verifyRequiredComposeTags(stagedDoc, relPath);
      assertNormalizedAstEquality(sourceDoc, stagedDoc, relPath);

      const stagedYamlStr = stagedDoc.toString();
      fs.writeFileSync(fullDestPath, stagedYamlStr, {
        mode: srcStat.mode & 0o777,
      });
      fs.chmodSync(fullDestPath, srcStat.mode & 0o777);

      const reReadDoc = parseDocument(stagedYamlStr, {
        customTags: YAML_CUSTOM_TAGS,
      });
      assertNormalizedAstEquality(sourceDoc, reReadDoc, relPath);

      stagedHashes[relPath] = createHash("sha256")
        .update(stagedYamlStr)
        .digest("hex");
    } else {
      const content = fs.readFileSync(fullSourcePath);
      fs.writeFileSync(fullDestPath, content, {
        mode: srcStat.mode & 0o777,
      });
      fs.chmodSync(fullDestPath, srcStat.mode & 0o777);
      stagedHashes[relPath] = createHash("sha256")
        .update(content)
        .digest("hex");
    }
  }

  const locatorMap = {
    traefik: {
      sourcePin: FROZEN_SOURCE_PINS.traefik,
      stagedImageId: loadedImages.traefik.imageId ?? loadedImages.traefik,
    },
    proxy: {
      sourcePin: FROZEN_SOURCE_PINS.proxy,
      stagedImageId: loadedImages.proxy.imageId ?? loadedImages.proxy,
    },
    nginx: {
      sourcePin: FROZEN_SOURCE_PINS.nginx,
      stagedImageId: loadedImages.nginx.imageId ?? loadedImages.nginx,
    },
    issuerNode: {
      sourcePin: FROZEN_SOURCE_PINS.issuerNode,
      stagedImageId: loadedImages.issuerNode.imageId ?? loadedImages.issuerNode,
    },
  };

  return {
    originalHashes,
    stagedHashes,
    locatorMap,
    env: {
      TMPDIR: tmpdir,
    },
    stagedSourceRoot: destinationRoot,
    stagedScriptPath: path.join(
      destinationRoot,
      "tests/hosted-auth-proof/gateway-proof.mjs",
    ),
  };
}
