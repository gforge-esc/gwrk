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
