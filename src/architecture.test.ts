/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  architectureViolations,
  inspectArchitectureSource,
} from "../tests/helpers/architecture-boundary.js";
import {
  buildDiagnosisPrompt,
  evaluateReviewVerdict,
  evaluateScopedTestOutcome,
  extractFixLines,
  extractOpenTaskErrors,
} from "./application/ship/index.js";
import { checkIndex } from "./engine/adr-index.js";
import { parseCorpus, parseRecord } from "./engine/adr-parser.js";

function walkTsFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkTsFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      results.push(full);
    }
  }
  return results;
}

function fixture(name: string): string {
  return fs.readFileSync(
    path.resolve("tests/fixtures/architecture-boundary", name),
    "utf-8",
  );
}

describe("Architecture import detection", () => {
  it("detects static, package and dynamic dependencies", () => {
    const { imports } = inspectArchitectureSource(
      "domain/fixture.ts",
      fixture("imports.txt"),
    );
    expect(imports.map((entry) => entry.specifier)).toEqual([
      "node:fs",
      "fastify",
      "better-sqlite3",
      "node:fs/promises",
      "node:net",
      "node:child_process",
      null,
    ]);
    expect(
      architectureViolations("domain/fixture.ts", fixture("imports.txt")),
    ).toEqual([
      "domain/fixture.ts -> package:node:fs",
      "domain/fixture.ts -> package:fastify",
      "domain/fixture.ts -> package:better-sqlite3",
      "domain/fixture.ts -> package:node:fs/promises",
      "domain/fixture.ts -> dynamic:node:net",
      "domain/fixture.ts -> require:node:child_process",
      "domain/fixture.ts -> dynamic:<non-literal>",
    ]);
  });

  it("ignores import syntax inside prompt text", () => {
    expect(
      architectureViolations("application/prompt.ts", fixture("prompt.txt")),
    ).toEqual([]);
  });

  it("detects direct ambient process and clock reads", () => {
    expect(
      architectureViolations("domain/fixture.ts", fixture("ambient.txt")),
    ).toEqual([
      "domain/fixture.ts -> ambient:process.cwd",
      "domain/fixture.ts -> ambient:process.env",
      "domain/fixture.ts -> ambient:Date.now",
      "domain/fixture.ts -> ambient:new Date()",
    ]);
  });

  it("allows domain types and rejects domain values in port imports", () => {
    const source = [
      'import type { A } from "../domain/types.js";',
      'import { type B } from "../domain/types.js";',
      'export { type C } from "../domain/types.js";',
      'import { type D, value } from "../domain/types.js";',
      'export { otherValue } from "../domain/types.js";',
    ].join("\n");

    expect(architectureViolations("ports/fixture.ts", source)).toEqual([
      "ports/fixture.ts -> runtime-domain-dependency:domain/types.js",
      "ports/fixture.ts -> runtime-domain-dependency:domain/types.js",
    ]);
  });

  it("rejects direct legacy re-exports from adapter entry points", () => {
    expect(
      architectureViolations(
        "adapters/notifications/index.ts",
        'export { notifySlack } from "../../server/slack-notify.js";',
      ),
    ).toEqual([
      "adapters/notifications/index.ts -> legacy-adapter-re-export:server/slack-notify.js",
    ]);
  });

  it("detects cross-layer dynamic imports", () => {
    expect(
      architectureViolations(
        "application/fixture.ts",
        'await import("../adapters/git/index.js");',
      ),
    ).toEqual([
      "application/fixture.ts -> dynamic-dependency:adapters/git/index.js",
    ]);
  });
});

const layers = [
  "domain",
  "ports",
  "application",
  "db",
  "utils",
  "engine",
  "adapters",
];

describe("Hexagonal boundary gates (ADR-011)", () => {
  it("keeps routing definitions and registry loading out of server shims", () => {
    const removedShims = [
      "agent-registry",
      "model-selector",
      "task-classifier",
    ];
    const retained = removedShims.filter((name) =>
      fs.existsSync(path.resolve("src/server", `${name}.ts`)),
    );
    expect(retained).toEqual([]);
  });

  it.each(layers)("rejects new boundary violations in %s", (layer) => {
    const srcRoot = path.resolve("src");
    const files = walkTsFiles(path.join(srcRoot, layer));
    expect(files.length).toBeGreaterThan(0);

    const violations = files.flatMap((file) =>
      architectureViolations(
        path.relative(srcRoot, file).split(path.sep).join("/"),
        fs.readFileSync(file, "utf-8"),
      ),
    );

    expect(violations.sort()).toEqual([]);
  });
});

function inspectFileImports(file: string) {
  const source = fs.readFileSync(file, "utf-8");
  return inspectArchitectureSource(file, source).imports;
}

function importsFromServerShims(
  file: string,
  imports: ReturnType<typeof inspectFileImports>,
  shims: readonly string[],
) {
  return imports.filter(({ specifier }) => {
    if (!specifier?.startsWith(".")) return false;
    const target = path.posix.join(path.posix.dirname(file), specifier);
    return shims.includes(target.replace(/\.js$/, ""));
  });
}

describe("Unified agent routing dependencies", () => {
  const registryShim = "src/server/agent-registry";

  it.each([
    "src/engine/model-routing.test.ts",
    "src/server/backend-selector.test.ts",
    "src/server/backend-selector.integration.test.ts",
  ])("%s does not depend on server routing shims", (file) => {
    expect(
      importsFromServerShims(file, inspectFileImports(file), [
        registryShim,
        "src/server/model-selector",
        "src/server/task-classifier",
      ]),
    ).toEqual([]);
  });

  it("keeps routing effects in adapters", () => {
    const file = "src/adapters/agents/index.ts";
    expect(
      importsFromServerShims(file, inspectFileImports(file), [
        "src/server/quota-prober",
        "src/server/routing-decisions",
      ]),
    ).toEqual([]);
  });

  it("uses domain types in the quota prober", () => {
    const file = "src/adapters/agents/quota-prober.ts";
    const imports = inspectFileImports(file);
    expect
      .soft(importsFromServerShims(file, imports, [registryShim]))
      .toEqual([]);
    expect(imports).toContainEqual({
      kind: "static",
      specifier: "../../domain/agent-config.js",
      typeOnly: true,
    });
  });

  it.each([
    "src/server/index.ts",
    "src/server/agent-registry.test.ts",
    "src/server/agent-registry.integration.test.ts",
  ])("%s uses the adapter registry loader", (file) => {
    const imports = inspectFileImports(file);
    const specifier = "../adapters/agents/registry-loader.js";
    expect
      .soft(importsFromServerShims(file, imports, [registryShim]))
      .toEqual([]);
    expect.soft(imports).toContainEqual({
      kind: "static",
      specifier,
      typeOnly: false,
    });
    if (file === "src/server/index.ts") {
      expect(imports).toContainEqual({
        kind: "re-export",
        specifier,
        typeOnly: false,
      });
    }
  });
});

describe("034-hexagonal-architecture: Decomposed Ship Stage Handlers", () => {
  it("extracts open task errors and builds review-aware diagnosis prompts", () => {
    const errors = extractOpenTaskErrors([
      {
        id: "T001",
        status: "completed",
        description: "BUILD_CHECK FAILED: old",
      },
      {
        id: "T002",
        status: "open",
        description: "Impl\n\nREVIEW FINDING: missing null guard",
      },
    ]);
    expect(errors).toEqual(["Task T002: REVIEW FINDING: missing null guard"]);

    const prompt = buildDiagnosisPrompt(errors, "");
    expect(prompt).toContain("## Review Findings (build and gates are GREEN)");
    expect(prompt).toContain("Task T002: REVIEW FINDING: missing null guard");
  });

  it("unwraps stream-json when extracting FIX: lines", () => {
    const streamOut = JSON.stringify({
      type: "result",
      result: "FIX: src/foo.ts — Add null check\nNotes: done",
    });
    expect(extractFixLines(streamOut)).toEqual([
      "FIX: src/foo.ts — Add null check",
    ]);
  });

  it("evaluates review verdict as a one-way ratchet and detects divergence", () => {
    expect(
      evaluateReviewVerdict({
        agentStdout: '{"verdict": "GO"}',
        reopenedTasks: ["T001"],
        failedGateTasks: [],
      }),
    ).toEqual({
      verdict: "NO-GO",
      divergenceTasks: ["T001"],
    });
  });

  it("evaluates scoped test liveness and baseline regressions", () => {
    expect(
      evaluateScopedTestOutcome({ testsRun: 0, failed: 0, baselineFailed: 0 })
        .passed,
    ).toBe(false);
    expect(
      evaluateScopedTestOutcome({ testsRun: 5, failed: 1, baselineFailed: 0 })
        .passed,
    ).toBe(false);
    expect(
      evaluateScopedTestOutcome({ testsRun: 5, failed: 0, baselineFailed: 0 })
        .passed,
    ).toBe(true);
  });
});

describe("FR-006 durable operation boundaries", () => {
  it("TR-005 exports durable policy through the domain barrel with pure implementations", async () => {
    const domain = await import("./domain/index.js");
    expect(Object.keys(domain)).toEqual(
      expect.arrayContaining([
        "computeDispatchWorkKey",
        "evaluateDispatchAcceptance",
        "validateLeaseFence",
        "evaluateStaleDispatchReconciliation",
        "computeHarvestWorkKey",
        "verifyHarvestTarget",
        "planHarvestStages",
        "deriveHarvestTerminalStatus",
        "evaluateBranchCleanupSafety",
        "EvidenceLevelSchema",
        "DispatchOperationStatusSchema",
        "DispatchAttemptStatusSchema",
        "DeliverySourceSchema",
        "HarvestTerminalEventSchema",
        "HarvestOperationStatusSchema",
        "HarvestStageNameSchema",
        "HarvestStageStatusSchema",
        "OutboxStatusSchema",
      ]),
    );
    for (const file of [
      "domain/durable-dispatch.ts",
      "domain/durable-harvest.ts",
    ]) {
      const source = fs.readFileSync(path.resolve("src", file), "utf8");
      expect(architectureViolations(file, source)).toEqual([]);
      expect(architectureViolations(file, `${source}\nDate.now();`)).toContain(
        `${file} -> ambient:Date.now`,
      );
      expect(
        architectureViolations(file, `${source}\nimport fs from 'node:fs';`),
      ).toContain(`${file} -> package:node:fs`);
    }
  });

  it("TR-005 declares durable effect ports using type-only inward imports", async () => {
    const ts = await import("typescript");
    const required: Record<string, Record<string, string[]>> = {
      "ports/operations-port.ts": {
        ClockPort: ["nowIso", "nowMs"],
        OperationsStorePort: [
          "acceptDispatch",
          "claimDispatchLease",
          "heartbeatDispatchLease",
          "completeDispatchAttempt",
          "listRecoverableDispatches",
          "getDispatchOperation",
          "recordHarvestIntake",
          "listRecoverableHarvests",
          "claimHarvestLease",
          "heartbeatHarvestLease",
          "initializeHarvestStages",
          "transitionHarvestStage",
          "enqueueOutbox",
          "getOutboxItem",
          "listRecoverableOutboxItems",
          "claimOutboxItem",
          "markOutboxUncertain",
          "completeOutboxItem",
          "getHarvestCursor",
          "saveHarvestCursor",
          "getOperationsStatus",
        ],
        GitHubHarvestPort: [
          "verifyWebhookSignature",
          "listTerminalPullRequests",
          "getPullRequest",
        ],
        WorkerExecutionPort: [
          "inspectRecoveredWork",
          "launchPhaseShip",
          "cleanupStaleSandbox",
        ],
        HarvestExecutionPort: [
          "discoverPhasesAtCheckout",
          "verifyGatesAtCheckout",
          "recordLearningAtCheckout",
        ],
      },
      "ports/vcs-port.ts": {
        VcsPort: [
          "fetchBranch",
          "resolveRefSha",
          "isCommitAncestorOfRef",
          "createDetachedCheckout",
          "removeDetachedCheckout",
          "getRemoteBranchSha",
          "deleteRemoteBranchAtTip",
        ],
        VcsHarvestExtensions: [
          "fetchBranch",
          "resolveRefSha",
          "isCommitAncestorOfRef",
          "createDetachedCheckout",
          "removeDetachedCheckout",
          "getRemoteBranchSha",
          "deleteRemoteBranchAtTip",
        ],
      },
      "ports/notification-port.ts": {
        NotificationPayload: ["clientMetadataKey"],
        NotificationPort: ["reconcileDelivery"],
      },
    };
    const files = Object.keys(required).map((file) =>
      path.resolve("src", file),
    );
    const program = ts.createProgram(files, {
      noEmit: true,
      skipLibCheck: true,
      strictNullChecks: true,
    });
    const checker = program.getTypeChecker();
    for (const [file, interfaces] of Object.entries(required)) {
      const source = fs.readFileSync(path.resolve("src", file), "utf8");
      expect(architectureViolations(file, source)).toEqual([]);
      expect(
        architectureViolations(
          file,
          `${source}\nimport { value } from '../domain/durable-dispatch.js';`,
        ),
      ).toContain(
        `${file} -> runtime-domain-dependency:domain/durable-dispatch.js`,
      );
      const ast = program.getSourceFile(path.resolve("src", file));
      expect(ast).toBeDefined();
      if (!ast) throw new Error(`Missing source ${file}`);
      for (const [name, methods] of Object.entries(interfaces)) {
        const declaration = ast.statements.find(
          (node) => ts.isInterfaceDeclaration(node) && node.name.text === name,
        );
        expect(declaration, `${file} must declare ${name}`).toBeDefined();
        if (!declaration || !ts.isInterfaceDeclaration(declaration))
          throw new Error(`Missing interface ${name}`);
        expect(
          checker
            .getTypeAtLocation(declaration)
            .getProperties()
            .map((symbol) => symbol.name),
        ).toEqual(expect.arrayContaining(methods));
        const requiredInputs: Record<string, string> = {
          launchPhaseShip: "taskIds",
          claimOutboxItem: "destination",
          heartbeatHarvestLease: "fence",
        };
        for (const member of declaration.members) {
          if (!ts.isMethodSignature(member) || !ts.isIdentifier(member.name))
            continue;
          if (
            name === "HarvestExecutionPort" &&
            member.name.text === "recordLearningAtCheckout"
          ) {
            const parameter = checker.getTypeAtLocation(member.parameters[0]);
            const prNumber = parameter.getProperty("prNumber");
            expect(prNumber).toBeDefined();
            if (!prNumber) throw new Error("Missing prNumber");
            expect(
              checker.typeToString(
                checker.getTypeOfSymbolAtLocation(prNumber, member),
              ),
            ).toBe("number | null");
          }
          const field = requiredInputs[member.name.text];
          if (!field) continue;
          const property = checker
            .getTypeAtLocation(member.parameters[0])
            .getProperty(field);
          expect(
            property && (property.flags & ts.SymbolFlags.Optional) === 0,
            `${name}.${member.name.text} must require ${field}`,
          ).toBe(true);
        }
      }
    }
  });
});

describe("FR-015 hosted production auth boundaries", () => {
  it("TR-020 TC-004 keeps src/domain/auth-policy.ts pure and exported from the domain barrel", async () => {
    const policyPath = path.resolve("src/domain/auth-policy.ts");
    expect(
      fs.existsSync(policyPath),
      "src/domain/auth-policy.ts must exist",
    ).toBe(true);
    const source = fs.readFileSync(policyPath, "utf-8");

    expect(architectureViolations("domain/auth-policy.ts", source)).toEqual([]);
    expect(
      architectureViolations("domain/auth-policy.ts", `${source}\nDate.now();`),
    ).toContain("domain/auth-policy.ts -> ambient:Date.now");
    expect(
      architectureViolations(
        "domain/auth-policy.ts",
        `${source}\nimport fs from "node:fs";`,
      ),
    ).toContain("domain/auth-policy.ts -> package:node:fs");
    expect(
      architectureViolations(
        "domain/auth-policy.ts",
        `${source}\nimport fastify from "fastify";`,
      ),
    ).toContain("domain/auth-policy.ts -> package:fastify");
    expect(
      architectureViolations(
        "domain/auth-policy.ts",
        `${source}\nimport Database from "better-sqlite3";`,
      ),
    ).toContain("domain/auth-policy.ts -> package:better-sqlite3");
    expect(
      architectureViolations(
        "domain/auth-policy.ts",
        `${source}\nimport { jwtVerify } from "jose";`,
      ),
    ).toContain("domain/auth-policy.ts -> package:jose");

    const domain = await import("./domain/index.js");
    expect(Object.keys(domain)).toEqual(
      expect.arrayContaining([
        "CANONICAL_GOOGLE_ISSUER",
        "ALLOWED_GOOGLE_ISSUERS",
        "ALLOWED_GOOGLE_ALGORITHMS",
        "FORBIDDEN_PUBLIC_IDENTITY_HEADERS",
        "FORBIDDEN_PUBLIC_IDENTITY_HEADER_PREFIX",
        "DEFAULT_HOSTED_SECURITY_POLICY",
        "HostedSecurityPolicySchema",
        "validateHostedSecurityPolicy",
        "normalizeGoogleIssuer",
        "formatGooglePrincipalId",
        "validateGoogleTokenHeader",
        "validateAccountAllowlist",
        "evaluateGoogleTokenClaims",
        "computeBrowserSessionCap",
        "evaluateGoogleSessionLifecycle",
        "parseOpaqueApiCredential",
        "validateApiCredentialExpiry",
        "evaluateApiCredentialLifecycle",
        "classifyHostedRoute",
        "selectRequestCredentialMechanism",
        "evaluateBrowserMutationPolicy",
        "isForbiddenPublicIdentityHeader",
        "evaluateOutboundCredentialTarget",
        "redactAuthHeaders",
        "redactAuthUrl",
        "redactAuthText",
      ]),
    );
  });

  it("TR-020 TC-004 freezes VerifiedAuthContext and seven auth ports in src/ports/auth-port.ts with type-only domain imports", async () => {
    const ts = await import("typescript");
    const portFile = "ports/auth-port.ts";
    const absPortPath = path.resolve("src", portFile);
    expect(
      fs.existsSync(absPortPath),
      "src/ports/auth-port.ts must exist",
    ).toBe(true);

    const source = fs.readFileSync(absPortPath, "utf-8");
    expect(architectureViolations(portFile, source)).toEqual([]);
    expect(
      architectureViolations(
        portFile,
        `${source}\nimport { classifyHostedRoute } from "../domain/auth-policy.js";`,
      ),
    ).toContain(
      `${portFile} -> runtime-domain-dependency:domain/auth-policy.js`,
    );
    expect(
      architectureViolations(
        portFile,
        `${source}\nimport type { FastifyRequest } from "fastify";`,
      ),
    ).toContain(`${portFile} -> package:fastify`);
    expect(
      architectureViolations(
        portFile,
        `${source}\nimport { jwtVerify } from "jose";`,
      ),
    ).toContain(`${portFile} -> package:jose`);

    const portsIndexImports = inspectFileImports("src/ports/index.ts");
    expect(portsIndexImports).toContainEqual({
      kind: "re-export",
      specifier: "./auth-port.js",
      typeOnly: false,
    });

    const program = ts.createProgram([absPortPath], {
      noEmit: true,
      skipLibCheck: true,
      strictNullChecks: true,
    });
    const checker = program.getTypeChecker();
    const ast = program.getSourceFile(absPortPath);
    expect(ast).toBeDefined();
    if (!ast) throw new Error("Missing src/ports/auth-port.ts AST");

    const requiredInterfaces: Record<string, string[]> = {
      VerifiedAuthContext: [
        "principalType",
        "principalId",
        "credentialId",
        "expiresAt",
        "authMethod",
        "sessionDigest",
      ],
      GoogleIdentityVerifierPort: ["verifyIdToken"],
      CredentialCryptoPort: [
        "generateApiCredential",
        "hashCredential",
        "hashTokenDigest",
        "verifySha256Equal",
      ],
      AuthStorePort: [
        "findApiCredentialById",
        "listApiCredentials",
        "revokeApiCredential",
        "observeGoogleSession",
        "getGoogleSession",
        "revokeGoogleSession",
        "appendAuditEvent",
        "close",
      ],
      CredentialGrantAdminPort: [
        "createCredentialWithGrants",
        "rotateCredential",
      ],
      BrowserCsrfPort: ["issueToken", "verifyToken", "clearCookieHeader"],
      ProxySessionLogoutPort: ["clearProxySession"],
      HttpClientCredentialPort: ["resolveBearerForUrl"],
    };

    const requiredMethodParams: Record<string, string[]> = {
      "GoogleIdentityVerifierPort.verifyIdToken": ["token", "nowMs"],
      "AuthStorePort.observeGoogleSession": [
        "tokenDigestSha256",
        "principalId",
        "issuedAt",
        "expiresAt",
        "sessionCapAt",
      ],
      "CredentialGrantAdminPort.createCredentialWithGrants": [
        "credentialId",
        "verifierSha256",
        "label",
        "issuer",
        "audienceOrigin",
        "createdAt",
        "expiresAt",
        "grants",
      ],
      "CredentialGrantAdminPort.rotateCredential": [
        "targetCredentialId",
        "newCredentialId",
        "newVerifierSha256",
        "issuer",
        "audienceOrigin",
        "createdAt",
        "expiresAt",
        "reason",
      ],
      "BrowserCsrfPort.verifyToken": [
        "sessionDigest",
        "headerToken",
        "cookieValue",
      ],
      "HttpClientCredentialPort.resolveBearerForUrl": ["targetUrl"],
    };

    for (const [name, members] of Object.entries(requiredInterfaces)) {
      const declaration = ast.statements.find(
        (node) => ts.isInterfaceDeclaration(node) && node.name.text === name,
      );
      expect(declaration, `auth-port.ts must declare ${name}`).toBeDefined();
      if (!declaration || !ts.isInterfaceDeclaration(declaration)) {
        throw new Error(`Missing interface ${name}`);
      }
      const type = checker.getTypeAtLocation(declaration);
      expect(type.getProperties().map((symbol) => symbol.name)).toEqual(
        expect.arrayContaining(members),
      );

      if (name === "VerifiedAuthContext") {
        for (const requiredField of [
          "principalType",
          "principalId",
          "credentialId",
          "expiresAt",
          "authMethod",
        ]) {
          const prop = type.getProperty(requiredField);
          expect(
            prop && (prop.flags & ts.SymbolFlags.Optional) === 0,
            `VerifiedAuthContext.${requiredField} must be required`,
          ).toBe(true);
        }
        const sessionDigest = type.getProperty("sessionDigest");
        expect(
          sessionDigest &&
            (sessionDigest.flags & ts.SymbolFlags.Optional) !== 0,
          "VerifiedAuthContext.sessionDigest must be optional",
        ).toBe(true);
      }

      for (const member of declaration.members) {
        if (!ts.isMethodSignature(member) || !ts.isIdentifier(member.name)) {
          continue;
        }
        const key = `${name}.${member.name.text}`;
        const requiredFields = requiredMethodParams[key];
        if (!requiredFields) continue;
        const paramType = checker.getTypeAtLocation(member.parameters[0]);
        for (const field of requiredFields) {
          const prop = paramType.getProperty(field);
          expect(
            prop && (prop.flags & ts.SymbolFlags.Optional) === 0,
            `${key} must require ${field}`,
          ).toBe(true);
        }
        if (key === "CredentialGrantAdminPort.rotateCredential") {
          const overlapUntil = paramType.getProperty("overlapUntil");
          expect(
            overlapUntil &&
              (overlapUntil.flags & ts.SymbolFlags.Optional) !== 0,
            "CredentialGrantAdminPort.rotateCredential.overlapUntil must be optional",
          ).toBe(true);
        }
      }
    }
  });

  it("TR-020 TC-011 records ADR-014 as Proposed and keeps .gwrk/decisions/index.md synchronized", async () => {
    const adrPath = path.resolve(
      "docs/decisions/ADR-014-hosted-production-auth.md",
    );
    expect(
      fs.existsSync(adrPath),
      "docs/decisions/ADR-014-hosted-production-auth.md must exist",
    ).toBe(true);

    const record = parseRecord(fs.readFileSync(adrPath, "utf-8"), adrPath);
    expect(record.id).toBe("ADR-014");
    expect(record.header.status).toBe("Proposed");
    expect(record.header.decision.trim().length).toBeGreaterThan(0);
    expect(record.header.scope?.trim().length ?? 0).toBeGreaterThan(0);
    expect(record.header.constraint ?? "").toMatch(/\bMUST(?:\s+NOT)?\b/);

    const corpus = await parseCorpus(path.resolve("docs/decisions"));
    for (let num = 1; num <= 12; num++) {
      const id = `ADR-${String(num).padStart(3, "0")}`;
      const existing = corpus.find((entry) => entry.id === id);
      expect(existing?.header.status, `${id} must remain Decided`).toBe(
        "Decided",
      );
    }
    const adr013 = corpus.find((entry) => entry.id === "ADR-013");
    expect(adr013?.header.status).toBe("Proposed");

    const indexCheck = await checkIndex(process.cwd(), corpus);
    expect(indexCheck).toEqual({
      ok: true,
      divergent: [],
      message: null,
    });

    const indexContent = fs.readFileSync(
      path.resolve(".gwrk/decisions/index.md"),
      "utf-8",
    );
    expect(indexContent).toMatch(/^\|\s*ADR-014\s*\|[^|]+\|\s*Proposed\s*\|/m);
  });
});
