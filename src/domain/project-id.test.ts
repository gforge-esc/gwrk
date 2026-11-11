/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { architectureViolations } from "../../tests/helpers/architecture-boundary.js";
import { computeProjectId, computeProjectKey } from "./project-id.js";

const loadProjectIdModule = () =>
  import("./project-id.js") as Promise<Record<string, unknown>>;
const loadProjectRegistryModule = () => {
  const specifier = "./project-registry.js";
  return import(specifier) as Promise<Record<string, unknown>>;
};
const loadDomainBarrel = () =>
  import("./index.js") as Promise<Record<string, unknown>>;

function md5(value: string): string {
  return crypto.createHash("md5").update(value).digest("hex");
}

function getExportedTypeMembers(
  source: string,
  typeName: string,
): string[] | null {
  const ast = ts.createSourceFile(
    "port.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  for (const stmt of ast.statements) {
    const isExported = Boolean(
      ts.canHaveModifiers(stmt) &&
        ts
          .getModifiers(stmt)
          ?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword),
    );
    if (!isExported) continue;

    if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === typeName) {
      return stmt.members
        .map((member) =>
          member.name && ts.isIdentifier(member.name) ? member.name.text : "",
        )
        .filter(Boolean);
    }

    if (
      ts.isTypeAliasDeclaration(stmt) &&
      stmt.name.text === typeName &&
      ts.isTypeLiteralNode(stmt.type)
    ) {
      return stmt.type.members
        .map((member) =>
          member.name && ts.isIdentifier(member.name) ? member.name.text : "",
        )
        .filter(Boolean);
    }
  }
  return null;
}

describe("Project identity from supplied facts", () => {
  it("normalizes remotes without keeping user information", () => {
    for (const remoteOriginUrl of [
      "git@GitHub.com:Acme/Widget.git",
      "  https://ci@GitHub.com/Acme/Widget.git  ",
    ]) {
      expect(computeProjectKey({ projectRoot: "/repo", remoteOriginUrl })).toBe(
        "remote:github.com/acme/widget",
      );
    }
  });

  it("uses the main worktree and then the supplied project path", () => {
    expect(
      computeProjectKey({
        projectRoot: "/linked",
        remoteOriginUrl: "",
        gitCommonDir: "/main/.git",
      }),
    ).toBe("local:/main");
    expect(computeProjectKey({ projectRoot: "/linked" })).toBe("path:/linked");
  });

  it("preserves the existing digest regardless of the process directory", () => {
    const cwd = process.cwd();
    const facts = {
      projectRoot: "/repo",
      remoteOriginUrl: "git@github.com:acme/widget.git",
    };
    const id = computeProjectId(facts);
    expect(id).toBe("d3ff282248a70b8d0b7e4789e0ee5a48");
    try {
      process.chdir(os.tmpdir());
      expect(computeProjectId(facts)).toBe(id);
    } finally {
      process.chdir(cwd);
    }
  });
});

describe("FR-001 / TR-001: Canonical remote IDs and legacy path alias hashes", () => {
  it("returns both historical hashes for a project identified only by its path", async () => {
    const { computeLegacyProjectIds } = await import("./project-id.js");
    const facts = { projectRoot: "/repos/local-only" };

    expect(computeLegacyProjectIds(facts)).toEqual([
      computeProjectId(facts),
      md5(facts.projectRoot),
    ]);
  });

  it("TR-001: keeps canonical remote MD5 and emits prefixed and bare legacy path hashes", async () => {
    const mod = await loadProjectIdModule();
    expect(typeof mod.computeLegacyProjectIds).toBe("function");
    const computeLegacyProjectIds = mod.computeLegacyProjectIds as (facts: {
      projectRoot: string;
      remoteOriginUrl?: string | null;
      gitCommonDir?: string | null;
    }) => string[];

    const facts = {
      projectRoot: "/Users/dev/acme-widget",
      remoteOriginUrl: "git@github.com:Acme/Widget.git",
    };
    const canonicalId = computeProjectId(facts);
    const legacyIds = computeLegacyProjectIds(facts);

    expect(canonicalId).toBe(md5("remote:github.com/acme/widget"));
    expect(legacyIds).toContain(md5("path:/Users/dev/acme-widget"));
    expect(legacyIds).toContain(md5("/Users/dev/acme-widget"));
    expect(legacyIds).not.toContain(canonicalId);
    expect(new Set(legacyIds).size).toBe(legacyIds.length);
  });

  it("TR-001: retains shared common-dir identity across linked worktrees without a remote", async () => {
    const mod = await loadProjectIdModule();
    expect(typeof mod.computeLegacyProjectIds).toBe("function");
    const computeLegacyProjectIds = mod.computeLegacyProjectIds as (facts: {
      projectRoot: string;
      remoteOriginUrl?: string | null;
      gitCommonDir?: string | null;
    }) => string[];

    const mainWorktree = {
      projectRoot: "/repos/local-only",
      remoteOriginUrl: null,
      gitCommonDir: "/repos/local-only/.git",
    };
    const linkedWorktree = {
      projectRoot: "/repos/local-only-wt/feat-048",
      remoteOriginUrl: null,
      gitCommonDir: "/repos/local-only/.git",
    };

    expect(computeProjectId(mainWorktree)).toBe(md5("local:/repos/local-only"));
    expect(computeProjectId(linkedWorktree)).toBe(
      computeProjectId(mainWorktree),
    );

    const worktreeLegacy = computeLegacyProjectIds(linkedWorktree);
    expect(worktreeLegacy).toContain(md5("path:/repos/local-only-wt/feat-048"));
    expect(worktreeLegacy).toContain(md5("/repos/local-only-wt/feat-048"));
  });

  it("FR-001: validates Slack-bound and local-only project enrollments with caller timestamps", async () => {
    const registry = await loadProjectRegistryModule();
    expect(typeof registry.validateProjectEnrollment).toBe("function");
    const validateProjectEnrollment = registry.validateProjectEnrollment as (
      input: unknown,
    ) =>
      | { ok: true; value: Record<string, unknown> }
      | { ok: false; error: string };

    const slackBoundInput = {
      projectId: md5("remote:github.com/acme/widget"),
      slug: "acme-widget",
      name: "Acme Widget",
      repoSlug: "github.com/acme/widget",
      trunkBranch: "develop",
      localRoot: "/Users/dev/acme-widget",
      mirrorPath: "/var/lib/gwrk/mirrors/acme-widget",
      runnerPolicy: {
        allowedKinds: ["local", "hosted"],
        runnerIds: ["runner-west-1"],
      },
      slack: {
        workspaceId: "T01ACME",
        channelId: "C01WIDGET",
        channelName: "acme-widget",
        opsChannelId: "C01OPS",
        sharedChannel: false,
      },
      legacyProjectIds: [
        md5("path:/Users/dev/acme-widget"),
        md5("/Users/dev/acme-widget"),
      ],
      createdAt: "2026-11-11T10:00:00.000Z",
      updatedAt: "2026-11-11T10:05:00.000Z",
    };

    const slackResult = validateProjectEnrollment(slackBoundInput);
    expect(slackResult).toEqual({
      ok: true,
      value: slackBoundInput,
    });

    const localOnlyInput = {
      projectId: md5("path:/Users/dev/solo"),
      slug: "solo",
      name: "Solo Repo",
      repoSlug: null,
      trunkBranch: "main",
      localRoot: "/Users/dev/solo",
      mirrorPath: null,
      runnerPolicy: {
        allowedKinds: ["local"],
      },
      slack: null,
      legacyProjectIds: [],
      createdAt: "2026-11-11T10:00:00.000Z",
      updatedAt: "2026-11-11T10:00:00.000Z",
    };

    const localResult = validateProjectEnrollment(localOnlyInput);
    expect(localResult.ok).toBe(true);
    if (localResult.ok) {
      expect(localResult.value.slug).toBe("solo");
      expect(localResult.value.slack).toBeNull();
      expect(localResult.value.trunkBranch).toBe("main");
    }
  });

  it("FR-001: rejects malformed project enrollments with explicit errors", async () => {
    const registry = await loadProjectRegistryModule();
    expect(typeof registry.validateProjectEnrollment).toBe("function");
    const validateProjectEnrollment = registry.validateProjectEnrollment as (
      input: unknown,
    ) => { ok: true; value: unknown } | { ok: false; error: string };

    const validBase = {
      projectId: "proj-1",
      slug: "widget",
      name: "Widget",
      repoSlug: "github.com/acme/widget",
      trunkBranch: "develop",
      localRoot: "/Users/dev/widget",
      mirrorPath: null,
      runnerPolicy: { allowedKinds: ["local"] },
      slack: null,
      legacyProjectIds: [],
      createdAt: "2026-11-11T10:00:00.000Z",
      updatedAt: "2026-11-11T10:00:00.000Z",
    };

    const invalidCases: unknown[] = [
      null,
      "not-an-object",
      { ...validBase, projectId: "" },
      { ...validBase, slug: "   " },
      { ...validBase, name: "" },
      { ...validBase, trunkBranch: "" },
      { ...validBase, runnerPolicy: { allowedKinds: ["unsupported_runner"] } },
      {
        ...validBase,
        slack: { workspaceId: "", channelId: "C01", sharedChannel: false },
      },
      {
        ...validBase,
        slack: { workspaceId: "T01", channelId: "", sharedChannel: false },
      },
      { ...validBase, createdAt: "" },
      { ...validBase, updatedAt: "" },
    ];

    for (const invalid of invalidCases) {
      const result = validateProjectEnrollment(invalid);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("FR-003: scopes buildActionReceiptKey across project, workspace, channel, message and action", async () => {
    const registry = await loadProjectRegistryModule();
    expect(typeof registry.buildActionReceiptKey).toBe("function");
    const buildActionReceiptKey = registry.buildActionReceiptKey as (input: {
      projectId: string;
      actionId: string;
      featureId: string;
      phaseId?: string | null;
      workspaceId: string;
      channelId: string;
      messageTs: string;
    }) => string;

    const base = {
      projectId: "proj-alpha",
      actionId: "merge_pr",
      featureId: "048-project-identity-slack",
      phaseId: "phase-01",
      workspaceId: "T01ACME",
      channelId: "C01ALPHA",
      messageTs: "1731320000.000100",
    };

    const baselineKey = buildActionReceiptKey(base);
    expect(baselineKey.length).toBeGreaterThan(0);
    expect(buildActionReceiptKey({ ...base })).toBe(baselineKey);

    const withoutPhase = buildActionReceiptKey({
      ...base,
      actionId: "approve_plan",
      phaseId: undefined,
    });
    const nullPhase = buildActionReceiptKey({
      ...base,
      actionId: "approve_plan",
      phaseId: null,
    });
    expect(withoutPhase).toBe(nullPhase);

    expect(buildActionReceiptKey({ ...base, projectId: "proj-beta" })).not.toBe(
      baselineKey,
    );
    expect(
      buildActionReceiptKey({ ...base, workspaceId: "T02OTHER" }),
    ).not.toBe(baselineKey);
    expect(buildActionReceiptKey({ ...base, channelId: "C02OTHER" })).not.toBe(
      baselineKey,
    );
    expect(
      buildActionReceiptKey({ ...base, messageTs: "1731320000.000200" }),
    ).not.toBe(baselineKey);
    expect(
      buildActionReceiptKey({ ...base, actionId: "retry_phase" }),
    ).not.toBe(baselineKey);
    expect(
      buildActionReceiptKey({ ...base, featureId: "049-collision" }),
    ).not.toBe(baselineKey);
    expect(buildActionReceiptKey({ ...base, phaseId: "phase-02" })).not.toBe(
      baselineKey,
    );
  });

  it("FR-001: exports project registry and Slack routing contracts from the domain barrel", async () => {
    const barrel = await loadDomainBarrel();

    expect(typeof barrel.computeProjectId).toBe("function");
    expect(typeof barrel.computeLegacyProjectIds).toBe("function");
    expect(typeof barrel.validateProjectEnrollment).toBe("function");
    expect(typeof barrel.buildActionReceiptKey).toBe("function");
    expect(typeof barrel.parseProjectSelector).toBe("function");
    expect(typeof barrel.requiredAccessForSlackCommand).toBe("function");
    expect(typeof barrel.requiredAccessForSlackAction).toBe("function");
    expect(typeof barrel.evaluateSlackRoute).toBe("function");
    expect(typeof barrel.evaluateSlackAction).toBe("function");
    expect(typeof barrel.evaluateHttpProjectAccess).toBe("function");
  });

  it("FR-001 / TR-004: declares ProjectRegistryPort and VcsPort extensions without boundary violations", () => {
    const storePortPath = path.resolve("src/ports/store-port.ts");
    const vcsPortPath = path.resolve("src/ports/vcs-port.ts");
    const storePortSource = fs.readFileSync(storePortPath, "utf-8");
    const vcsPortSource = fs.readFileSync(vcsPortPath, "utf-8");

    expect(
      architectureViolations("ports/store-port.ts", storePortSource),
    ).toEqual([]);
    expect(architectureViolations("ports/vcs-port.ts", vcsPortSource)).toEqual(
      [],
    );

    const registryMembers = getExportedTypeMembers(
      storePortSource,
      "ProjectRegistryPort",
    );
    expect(registryMembers).not.toBeNull();
    expect(registryMembers).toEqual(
      expect.arrayContaining([
        "enrollProject",
        "getProject",
        "findByRepoSlug",
        "findByLocalRoot",
        "listBySlackChannel",
        "listProjects",
        "setRoleBinding",
        "listRoleBindings",
        "getFeatureThread",
        "bindFeatureThread",
        "getActionReceipt",
        "claimActionReceipt",
        "completeActionReceipt",
        "close",
      ]),
    );

    const prSummaryMembers = getExportedTypeMembers(
      vcsPortSource,
      "PullRequestSummary",
    );
    expect(prSummaryMembers).toEqual(
      expect.arrayContaining(["prNumber", "prUrl"]),
    );

    const vcsMembers = getExportedTypeMembers(vcsPortSource, "VcsPort");
    expect(vcsMembers).toEqual(
      expect.arrayContaining([
        "getCurrentBranch",
        "isDirty",
        "createBranch",
        "syncBranch",
        "discoverIdentityFacts",
        "resolvePullRequestUrl",
        "mergePullRequest",
      ]),
    );
  });
});
