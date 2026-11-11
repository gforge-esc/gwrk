/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { architectureViolations } from "../../tests/helpers/architecture-boundary.js";

interface ProjectSlackBindingFixture {
  workspaceId: string;
  channelId: string;
  channelName?: string;
  opsChannelId?: string;
  sharedChannel: boolean;
}

interface EnrolledProjectFixture {
  projectId: string;
  slug: string;
  name: string;
  repoSlug: string | null;
  trunkBranch: string;
  localRoot: string | null;
  mirrorPath: string | null;
  runnerPolicy: {
    allowedKinds: Array<"local" | "hosted">;
    runnerIds?: string[];
  };
  slack: ProjectSlackBindingFixture | null;
  legacyProjectIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface ProjectRoleBindingFixture {
  projectId: string;
  principalType: "slack_user" | "cli_token" | "google_sub";
  principalId: string;
  role: "viewer" | "operator" | "maintainer";
}

interface SlackFeatureThreadFixture {
  projectId: string;
  featureId: string;
  workspaceId: string;
  channelId: string;
  rootTs: string;
  updatedAt: string;
}

interface SlackActionReceiptFixture {
  receiptKey: string;
  projectId: string;
  actionId: string;
  featureId: string;
  phaseId: string | null;
  messageTs: string;
  actorUserId: string;
  outcome: "claimed" | "executed" | "failed" | "uncertain";
  recordedAt: string;
}

interface RouteSuccess {
  ok: true;
  project: EnrolledProjectFixture;
  role: "viewer" | "operator" | "maintainer";
  recipient: {
    projectId: string;
    surface: "slack" | "local_cli" | "http";
    workspaceId?: string;
    channelId?: string;
    threadTs?: string;
    actorUserId?: string;
    opsOnly?: boolean;
  };
}

interface RouteFailure {
  ok: false;
  code: string;
  message: string;
  candidateSlugs?: string[];
}

type RouteDecisionResult = RouteSuccess | RouteFailure;

interface SlackRoutingModule {
  parseProjectSelector: (rawText: string) => {
    requestedProject?: string;
    cleanedText: string;
  };
  requiredAccessForSlackCommand: (
    subcommand: string,
    subarg?: string,
  ) => "read" | "operate" | "maintain";
  requiredAccessForSlackAction: (
    actionId: string,
  ) => "read" | "operate" | "maintain";
  evaluateSlackRoute: (
    projects: readonly EnrolledProjectFixture[],
    roles: readonly ProjectRoleBindingFixture[],
    envelope: {
      workspaceId: string;
      channelId: string;
      isDirectMessage: boolean;
      actorUserId: string;
      threadTs?: string;
      messageTs?: string;
      requestedProject?: string;
      requiredAccess: "read" | "operate" | "maintain";
    },
  ) => RouteDecisionResult;
  evaluateSlackAction: (
    projects: readonly EnrolledProjectFixture[],
    roles: readonly ProjectRoleBindingFixture[],
    input: {
      workspaceId: string;
      channelId: string;
      isDirectMessage: boolean;
      actorUserId: string;
      threadTs?: string;
      messageTs?: string;
      requestedProject?: string;
      requiredAccess: "read" | "operate" | "maintain";
      actionId: string;
      payloadProjectId?: string;
      featureId: string;
      phaseId?: string;
      payloadRootTs?: string;
      storedThread?: SlackFeatureThreadFixture | null;
      priorReceipt?: SlackActionReceiptFixture | null;
    },
  ) => RouteDecisionResult;
  evaluateHttpProjectAccess: (input: {
    projects: readonly EnrolledProjectFixture[];
    roles: readonly ProjectRoleBindingFixture[];
    requestedProject?: string;
    localDefaultProjectId?: string;
    transport: "trusted_local" | "hosted";
    principal?: {
      principalType: "cli_token" | "google_sub";
      principalId: string;
    };
    requiredAccess: "read" | "operate" | "maintain";
  }) => RouteDecisionResult;
}

const loadSlackRouting = (): Promise<SlackRoutingModule> => {
  const specifier = "./slack-routing.js";
  return import(specifier) as Promise<SlackRoutingModule>;
};

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

const NOW = "2026-11-11T10:00:00.000Z";

const PROJECT_ALPHA: EnrolledProjectFixture = {
  projectId: "proj-alpha",
  slug: "alpha",
  name: "Alpha Service",
  repoSlug: "github.com/acme/alpha",
  trunkBranch: "develop",
  localRoot: "/srv/repos/alpha",
  mirrorPath: "/srv/mirrors/alpha",
  runnerPolicy: { allowedKinds: ["local", "hosted"] },
  slack: {
    workspaceId: "T_ACME",
    channelId: "C_ALPHA",
    channelName: "alpha-builds",
    opsChannelId: "C_ALPHA_OPS",
    sharedChannel: false,
  },
  legacyProjectIds: ["legacy-alpha-path"],
  createdAt: NOW,
  updatedAt: NOW,
};

const PROJECT_BETA: EnrolledProjectFixture = {
  projectId: "proj-beta",
  slug: "beta",
  name: "Beta Console",
  repoSlug: "github.com/acme/beta",
  trunkBranch: "main",
  localRoot: "/srv/repos/beta",
  mirrorPath: "/srv/mirrors/beta",
  runnerPolicy: { allowedKinds: ["local", "hosted"] },
  slack: {
    workspaceId: "T_ACME",
    channelId: "C_SHARED",
    channelName: "eng-builds",
    opsChannelId: "C_SHARED_OPS",
    sharedChannel: true,
  },
  legacyProjectIds: [],
  createdAt: NOW,
  updatedAt: NOW,
};

const PROJECT_LOCAL_ONLY: EnrolledProjectFixture = {
  projectId: "proj-local",
  slug: "local-tool",
  name: "Local Tool",
  repoSlug: "github.com/acme/local-tool",
  trunkBranch: "main",
  localRoot: "/Users/dev/local-tool",
  mirrorPath: null,
  runnerPolicy: { allowedKinds: ["local"] },
  slack: {
    workspaceId: "T_ACME",
    channelId: "C_SHARED",
    channelName: "eng-builds",
    sharedChannel: true,
  },
  legacyProjectIds: [],
  createdAt: NOW,
  updatedAt: NOW,
};

const PROJECTS: readonly EnrolledProjectFixture[] = [
  PROJECT_ALPHA,
  PROJECT_BETA,
  PROJECT_LOCAL_ONLY,
];

const ROLES: readonly ProjectRoleBindingFixture[] = [
  {
    projectId: "proj-alpha",
    principalType: "slack_user",
    principalId: "T_ACME:U_VIEWER",
    role: "viewer",
  },
  {
    projectId: "proj-alpha",
    principalType: "slack_user",
    principalId: "T_ACME:U_OPERATOR",
    role: "operator",
  },
  {
    projectId: "proj-alpha",
    principalType: "slack_user",
    principalId: "T_ACME:U_MAINTAINER",
    role: "maintainer",
  },
  {
    projectId: "proj-beta",
    principalType: "slack_user",
    principalId: "T_ACME:U_BETA_ONLY",
    role: "maintainer",
  },
  {
    projectId: "proj-beta",
    principalType: "slack_user",
    principalId: "T_ACME:U_OPERATOR",
    role: "operator",
  },
  {
    projectId: "proj-alpha",
    principalType: "google_sub",
    principalId: "https://accounts.google.com:sub-maintainer",
    role: "maintainer",
  },
  {
    projectId: "proj-alpha",
    principalType: "google_sub",
    principalId: "https://accounts.google.com:sub-viewer",
    role: "viewer",
  },
  {
    projectId: "proj-local",
    principalType: "google_sub",
    principalId: "https://accounts.google.com:sub-maintainer",
    role: "maintainer",
  },
];

describe("FR-002 / TR-002: Pure Slack command routing and role authorization", () => {
  it("FR-002: parses --project selectors from slash command and mention text", async () => {
    const { parseProjectSelector } = await loadSlackRouting();

    expect(
      parseProjectSelector("--project alpha ship 048-project-identity-slack 1"),
    ).toEqual({
      requestedProject: "alpha",
      cleanedText: "ship 048-project-identity-slack 1",
    });

    expect(
      parseProjectSelector("status 048-project-identity-slack --project=beta"),
    ).toEqual({
      requestedProject: "beta",
      cleanedText: "status 048-project-identity-slack",
    });

    const unscoped = parseProjectSelector("status 048-project-identity-slack");
    expect(unscoped.requestedProject).toBeUndefined();
    expect(unscoped.cleanedText).toBe("status 048-project-identity-slack");

    expect(parseProjectSelector("status --project alpha feature")).toEqual({
      requestedProject: "alpha",
      cleanedText: "status feature",
    });
    expect(
      parseProjectSelector("status --project alpha --project=beta"),
    ).toEqual({ requestedProject: "", cleanedText: "status" });
  });

  it("FR-002: maps Slack commands and interactive actions to required access levels", async () => {
    const { requiredAccessForSlackCommand, requiredAccessForSlackAction } =
      await loadSlackRouting();

    expect(requiredAccessForSlackCommand("status")).toBe("read");
    expect(requiredAccessForSlackCommand("logs")).toBe("read");
    expect(requiredAccessForSlackCommand("effort")).toBe("read");
    expect(requiredAccessForSlackCommand("pulse")).toBe("read");
    expect(requiredAccessForSlackCommand("adr", "list")).toBe("read");
    expect(requiredAccessForSlackCommand("adr", "check")).toBe("read");

    expect(requiredAccessForSlackCommand("dispatch")).toBe("operate");
    expect(requiredAccessForSlackCommand("ship")).toBe("operate");
    expect(requiredAccessForSlackCommand("pause")).toBe("operate");
    expect(requiredAccessForSlackCommand("define")).toBe("operate");
    expect(requiredAccessForSlackCommand("research")).toBe("operate");
    expect(requiredAccessForSlackCommand("adr", "record")).toBe("operate");

    expect(requiredAccessForSlackCommand("approve")).toBe("maintain");
    expect(requiredAccessForSlackCommand("reject")).toBe("maintain");
    expect(requiredAccessForSlackCommand("adr", "decide")).toBe("maintain");

    expect(requiredAccessForSlackAction("view_review")).toBe("read");
    expect(requiredAccessForSlackAction("retry_phase")).toBe("operate");
    expect(requiredAccessForSlackAction("request_changes")).toBe("operate");
    expect(requiredAccessForSlackAction("revise_spec")).toBe("operate");
    expect(requiredAccessForSlackAction("revise_plan")).toBe("operate");
    expect(requiredAccessForSlackAction("merge_pr")).toBe("maintain");
    expect(requiredAccessForSlackAction("approve_spec")).toBe("maintain");
    expect(requiredAccessForSlackAction("approve_plan")).toBe("maintain");
  });

  it("TR-002: denies unbound workspaces and unbound channels", async () => {
    const { evaluateSlackRoute } = await loadSlackRouting();

    const wrongWorkspace = evaluateSlackRoute(PROJECTS, ROLES, {
      workspaceId: "T_FOREIGN",
      channelId: "C_ALPHA",
      isDirectMessage: false,
      actorUserId: "U_MAINTAINER",
      requiredAccess: "read",
    });
    expect(wrongWorkspace).toMatchObject({
      ok: false,
      code: "UNBOUND_WORKSPACE",
    });

    const wrongChannel = evaluateSlackRoute(PROJECTS, ROLES, {
      workspaceId: "T_ACME",
      channelId: "C_UNREGISTERED",
      isDirectMessage: false,
      actorUserId: "U_MAINTAINER",
      requiredAccess: "read",
    });
    expect(wrongChannel).toMatchObject({
      ok: false,
      code: "UNBOUND_CHANNEL",
    });
  });

  it("TR-002: denies ambiguous direct messages and shared channels until caller selects a project", async () => {
    const { evaluateSlackRoute } = await loadSlackRouting();

    const unscopedDm = evaluateSlackRoute(PROJECTS, ROLES, {
      workspaceId: "T_ACME",
      channelId: "D_DM01",
      isDirectMessage: true,
      actorUserId: "U_MAINTAINER",
      requiredAccess: "read",
    });
    expect(unscopedDm.ok).toBe(false);
    if (!unscopedDm.ok) {
      expect(unscopedDm.code).toBe("AMBIGUOUS_PROJECT_SELECTION");
      expect(unscopedDm.candidateSlugs).toEqual(
        expect.arrayContaining(["alpha", "beta"]),
      );
    }

    const unscopedSharedChannel = evaluateSlackRoute(PROJECTS, ROLES, {
      workspaceId: "T_ACME",
      channelId: "C_SHARED",
      isDirectMessage: false,
      actorUserId: "U_OPERATOR",
      requiredAccess: "operate",
    });
    expect(unscopedSharedChannel.ok).toBe(false);
    if (!unscopedSharedChannel.ok) {
      expect(unscopedSharedChannel.code).toBe("AMBIGUOUS_PROJECT_SELECTION");
      expect(unscopedSharedChannel.candidateSlugs).toEqual(
        expect.arrayContaining(["beta", "local-tool"]),
      );
    }

    const singleSharedChannelProject: EnrolledProjectFixture = {
      ...PROJECT_BETA,
      slack: {
        workspaceId: "T_ACME",
        channelId: "C_SINGLE_SHARED",
        sharedChannel: true,
      },
    };
    const singleSharedDecision = evaluateSlackRoute(
      [singleSharedChannelProject],
      ROLES,
      {
        workspaceId: "T_ACME",
        channelId: "C_SINGLE_SHARED",
        isDirectMessage: false,
        actorUserId: "U_OPERATOR",
        requiredAccess: "read",
      },
    );
    expect(singleSharedDecision).toMatchObject({
      ok: false,
      code: "AMBIGUOUS_PROJECT_SELECTION",
    });
  });

  it("TR-002: denies unknown project selectors and channel-project mismatches", async () => {
    const { evaluateSlackRoute } = await loadSlackRouting();

    const unknownProject = evaluateSlackRoute(PROJECTS, ROLES, {
      workspaceId: "T_ACME",
      channelId: "D_DM01",
      isDirectMessage: true,
      actorUserId: "U_MAINTAINER",
      requestedProject: "does-not-exist",
      requiredAccess: "read",
    });
    expect(unknownProject).toMatchObject({
      ok: false,
      code: "UNKNOWN_PROJECT",
    });

    const channelMismatch = evaluateSlackRoute(PROJECTS, ROLES, {
      workspaceId: "T_ACME",
      channelId: "C_ALPHA",
      isDirectMessage: false,
      actorUserId: "U_OPERATOR",
      requestedProject: "beta",
      requiredAccess: "read",
    });
    expect(channelMismatch).toMatchObject({
      ok: false,
      code: "CHANNEL_PROJECT_MISMATCH",
    });
  });

  it("TR-002: denies unauthorized users and insufficient roles per project", async () => {
    const { evaluateSlackRoute } = await loadSlackRouting();

    const stranger = evaluateSlackRoute(PROJECTS, ROLES, {
      workspaceId: "T_ACME",
      channelId: "C_ALPHA",
      isDirectMessage: false,
      actorUserId: "U_STRANGER",
      requiredAccess: "read",
    });
    expect(stranger).toMatchObject({
      ok: false,
      code: "UNAUTHORIZED_USER",
    });

    const crossProjectUser = evaluateSlackRoute(PROJECTS, ROLES, {
      workspaceId: "T_ACME",
      channelId: "C_ALPHA",
      isDirectMessage: false,
      actorUserId: "U_BETA_ONLY",
      requiredAccess: "read",
    });
    expect(crossProjectUser).toMatchObject({
      ok: false,
      code: "UNAUTHORIZED_USER",
    });

    const viewerOperating = evaluateSlackRoute(PROJECTS, ROLES, {
      workspaceId: "T_ACME",
      channelId: "C_ALPHA",
      isDirectMessage: false,
      actorUserId: "U_VIEWER",
      requiredAccess: "operate",
    });
    expect(viewerOperating).toMatchObject({
      ok: false,
      code: "INSUFFICIENT_ROLE",
    });

    const operatorMaintaining = evaluateSlackRoute(PROJECTS, ROLES, {
      workspaceId: "T_ACME",
      channelId: "C_ALPHA",
      isDirectMessage: false,
      actorUserId: "U_OPERATOR",
      requiredAccess: "maintain",
    });
    expect(operatorMaintaining).toMatchObject({
      ok: false,
      code: "INSUFFICIENT_ROLE",
    });
  });

  it("FR-002 / FR-003: authorizes dedicated channels, selected shared channels and DMs with recipient context", async () => {
    const { evaluateSlackRoute } = await loadSlackRouting();

    const dedicated = evaluateSlackRoute(PROJECTS, ROLES, {
      workspaceId: "T_ACME",
      channelId: "C_ALPHA",
      isDirectMessage: false,
      actorUserId: "U_VIEWER",
      threadTs: "1731320100.000010",
      requiredAccess: "read",
    });
    expect(dedicated).toEqual({
      ok: true,
      project: PROJECT_ALPHA,
      role: "viewer",
      recipient: expect.objectContaining({
        projectId: "proj-alpha",
        surface: "slack",
        workspaceId: "T_ACME",
        channelId: "C_ALPHA",
        threadTs: "1731320100.000010",
        actorUserId: "U_VIEWER",
      }),
    });

    const sharedSelected = evaluateSlackRoute(PROJECTS, ROLES, {
      workspaceId: "T_ACME",
      channelId: "C_SHARED",
      isDirectMessage: false,
      actorUserId: "U_OPERATOR",
      requestedProject: "beta",
      requiredAccess: "operate",
    });
    expect(sharedSelected.ok).toBe(true);
    if (sharedSelected.ok) {
      expect(sharedSelected.project.projectId).toBe("proj-beta");
      expect(sharedSelected.role).toBe("operator");
      expect(sharedSelected.recipient.projectId).toBe("proj-beta");
      expect(sharedSelected.recipient.channelId).toBe("C_SHARED");
    }

    const dmSelected = evaluateSlackRoute(PROJECTS, ROLES, {
      workspaceId: "T_ACME",
      channelId: "D_DM01",
      isDirectMessage: true,
      actorUserId: "U_MAINTAINER",
      requestedProject: "alpha",
      requiredAccess: "maintain",
    });
    expect(dmSelected.ok).toBe(true);
    if (dmSelected.ok) {
      expect(dmSelected.project.projectId).toBe("proj-alpha");
      expect(dmSelected.role).toBe("maintainer");
      expect(dmSelected.recipient.surface).toBe("slack");
      expect(dmSelected.recipient.channelId).toBe("D_DM01");
    }
  });
});

describe("FR-003 / TR-003: Click-time Slack action verification, thread binding and replay guard", () => {
  const STORED_THREAD: SlackFeatureThreadFixture = {
    projectId: "proj-alpha",
    featureId: "048-project-identity-slack",
    workspaceId: "T_ACME",
    channelId: "C_ALPHA",
    rootTs: "1731320500.000100",
    updatedAt: NOW,
  };

  it("TR-003: denies clicks from unbound workspaces or for unknown payload projects", async () => {
    const { evaluateSlackAction } = await loadSlackRouting();

    const wrongWorkspace = evaluateSlackAction(PROJECTS, ROLES, {
      workspaceId: "T_FOREIGN",
      channelId: "C_ALPHA",
      isDirectMessage: false,
      actorUserId: "U_MAINTAINER",
      messageTs: "1731320500.000100",
      requiredAccess: "maintain",
      actionId: "merge_pr",
      payloadProjectId: "proj-alpha",
      featureId: "048-project-identity-slack",
      phaseId: "phase-01",
      payloadRootTs: STORED_THREAD.rootTs,
      storedThread: STORED_THREAD,
      priorReceipt: null,
    });
    expect(wrongWorkspace).toMatchObject({
      ok: false,
      code: "UNBOUND_WORKSPACE",
    });

    const unknownProject = evaluateSlackAction(PROJECTS, ROLES, {
      workspaceId: "T_ACME",
      channelId: "C_SHARED",
      isDirectMessage: false,
      actorUserId: "U_MAINTAINER",
      messageTs: "1731320500.000100",
      requiredAccess: "maintain",
      actionId: "merge_pr",
      payloadProjectId: "proj-missing",
      featureId: "048-project-identity-slack",
      phaseId: "phase-01",
    });
    expect(unknownProject).toMatchObject({
      ok: false,
      code: "UNKNOWN_PROJECT",
    });
  });

  it("TR-003: denies mismatched payloadProjectId or stored feature thread with THREAD_PROJECT_MISMATCH", async () => {
    const { evaluateSlackAction } = await loadSlackRouting();

    const mismatchedProject = evaluateSlackAction(PROJECTS, ROLES, {
      workspaceId: "T_ACME",
      channelId: "C_ALPHA",
      isDirectMessage: false,
      actorUserId: "U_MAINTAINER",
      threadTs: STORED_THREAD.rootTs,
      messageTs: "1731320500.000200",
      requiredAccess: "maintain",
      actionId: "merge_pr",
      payloadProjectId: "proj-beta",
      featureId: "048-project-identity-slack",
      phaseId: "phase-01",
      payloadRootTs: STORED_THREAD.rootTs,
      storedThread: STORED_THREAD,
      priorReceipt: null,
    });
    expect(mismatchedProject).toMatchObject({
      ok: false,
      code: "THREAD_PROJECT_MISMATCH",
    });

    const mismatchedRootTs = evaluateSlackAction(PROJECTS, ROLES, {
      workspaceId: "T_ACME",
      channelId: "C_ALPHA",
      isDirectMessage: false,
      actorUserId: "U_MAINTAINER",
      threadTs: "1731329999.999999",
      messageTs: "1731320500.000200",
      requiredAccess: "maintain",
      actionId: "merge_pr",
      payloadProjectId: "proj-alpha",
      featureId: "048-project-identity-slack",
      phaseId: "phase-01",
      payloadRootTs: "1731329999.999999",
      storedThread: STORED_THREAD,
      priorReceipt: null,
    });
    expect(mismatchedRootTs).toMatchObject({
      ok: false,
      code: "THREAD_PROJECT_MISMATCH",
    });

    const mismatchedStoredThreadProject = evaluateSlackAction(PROJECTS, ROLES, {
      workspaceId: "T_ACME",
      channelId: "C_ALPHA",
      isDirectMessage: false,
      actorUserId: "U_MAINTAINER",
      threadTs: STORED_THREAD.rootTs,
      messageTs: "1731320500.000200",
      requiredAccess: "maintain",
      actionId: "merge_pr",
      payloadProjectId: "proj-alpha",
      featureId: "048-project-identity-slack",
      phaseId: "phase-01",
      payloadRootTs: STORED_THREAD.rootTs,
      storedThread: {
        ...STORED_THREAD,
        projectId: "proj-beta",
        channelId: "C_SHARED",
      },
      priorReceipt: null,
    });
    expect(mismatchedStoredThreadProject).toMatchObject({
      ok: false,
      code: "THREAD_PROJECT_MISMATCH",
    });
  });

  it("TR-003: re-authorizes the clicking actor at click time and rejects replays", async () => {
    const { evaluateSlackAction } = await loadSlackRouting();

    const unauthorizedClicker = evaluateSlackAction(PROJECTS, ROLES, {
      workspaceId: "T_ACME",
      channelId: "C_ALPHA",
      isDirectMessage: false,
      actorUserId: "U_STRANGER",
      threadTs: STORED_THREAD.rootTs,
      messageTs: "1731320500.000200",
      requiredAccess: "maintain",
      actionId: "merge_pr",
      payloadProjectId: "proj-alpha",
      featureId: "048-project-identity-slack",
      phaseId: "phase-01",
      payloadRootTs: STORED_THREAD.rootTs,
      storedThread: STORED_THREAD,
      priorReceipt: null,
    });
    expect(unauthorizedClicker).toMatchObject({
      ok: false,
      code: "UNAUTHORIZED_USER",
    });

    const operatorClickingMerge = evaluateSlackAction(PROJECTS, ROLES, {
      workspaceId: "T_ACME",
      channelId: "C_ALPHA",
      isDirectMessage: false,
      actorUserId: "U_OPERATOR",
      threadTs: STORED_THREAD.rootTs,
      messageTs: "1731320500.000200",
      requiredAccess: "maintain",
      actionId: "merge_pr",
      payloadProjectId: "proj-alpha",
      featureId: "048-project-identity-slack",
      phaseId: "phase-01",
      payloadRootTs: STORED_THREAD.rootTs,
      storedThread: STORED_THREAD,
      priorReceipt: null,
    });
    expect(operatorClickingMerge).toMatchObject({
      ok: false,
      code: "INSUFFICIENT_ROLE",
    });

    const replayedClick = evaluateSlackAction(PROJECTS, ROLES, {
      workspaceId: "T_ACME",
      channelId: "C_ALPHA",
      isDirectMessage: false,
      actorUserId: "U_MAINTAINER",
      threadTs: STORED_THREAD.rootTs,
      messageTs: "1731320500.000200",
      requiredAccess: "maintain",
      actionId: "merge_pr",
      payloadProjectId: "proj-alpha",
      featureId: "048-project-identity-slack",
      phaseId: "phase-01",
      payloadRootTs: STORED_THREAD.rootTs,
      storedThread: STORED_THREAD,
      priorReceipt: {
        receiptKey: "proj-alpha:T_ACME:C_ALPHA:1731320500.000200:merge_pr",
        projectId: "proj-alpha",
        actionId: "merge_pr",
        featureId: "048-project-identity-slack",
        phaseId: "phase-01",
        messageTs: "1731320500.000200",
        actorUserId: "U_MAINTAINER",
        outcome: "executed",
        recordedAt: NOW,
      },
    });
    expect(replayedClick).toMatchObject({
      ok: false,
      code: "ACTION_REPLAYED",
    });
  });

  it("FR-003: authorizes first-time valid clicks and binds threadTs on DeliveryRecipient", async () => {
    const { evaluateSlackAction } = await loadSlackRouting();

    const approved = evaluateSlackAction(PROJECTS, ROLES, {
      workspaceId: "T_ACME",
      channelId: "C_ALPHA",
      isDirectMessage: false,
      actorUserId: "U_MAINTAINER",
      threadTs: STORED_THREAD.rootTs,
      messageTs: "1731320500.000200",
      requiredAccess: "maintain",
      actionId: "merge_pr",
      payloadProjectId: "proj-alpha",
      featureId: "048-project-identity-slack",
      phaseId: "phase-01",
      payloadRootTs: STORED_THREAD.rootTs,
      storedThread: STORED_THREAD,
      priorReceipt: null,
    });

    expect(approved).toEqual({
      ok: true,
      project: PROJECT_ALPHA,
      role: "maintainer",
      recipient: expect.objectContaining({
        projectId: "proj-alpha",
        surface: "slack",
        workspaceId: "T_ACME",
        channelId: "C_ALPHA",
        threadTs: STORED_THREAD.rootTs,
        actorUserId: "U_MAINTAINER",
      }),
    });
  });

  it("uses the action's minimum role even when the caller requests read access", async () => {
    const { evaluateSlackAction } = await loadSlackRouting();
    expect(
      evaluateSlackAction(PROJECTS, ROLES, {
        workspaceId: STORED_THREAD.workspaceId,
        channelId: STORED_THREAD.channelId,
        isDirectMessage: false,
        actorUserId: "U_OPERATOR",
        messageTs: STORED_THREAD.rootTs,
        requiredAccess: "read",
        actionId: "merge_pr",
        featureId: STORED_THREAD.featureId,
        storedThread: STORED_THREAD,
      }),
    ).toMatchObject({ ok: false, code: "INSUFFICIENT_ROLE" });
  });

  it("uses the actual Slack message as the root for a top-level click", async () => {
    const { evaluateSlackAction } = await loadSlackRouting();
    expect(
      evaluateSlackAction(PROJECTS, ROLES, {
        workspaceId: STORED_THREAD.workspaceId,
        channelId: STORED_THREAD.channelId,
        isDirectMessage: false,
        actorUserId: "U_MAINTAINER",
        messageTs: "1731320500.000200",
        payloadRootTs: STORED_THREAD.rootTs,
        requiredAccess: "maintain",
        actionId: "merge_pr",
        featureId: STORED_THREAD.featureId,
        storedThread: STORED_THREAD,
      }),
    ).toMatchObject({ ok: false, code: "THREAD_PROJECT_MISMATCH" });
  });
});

describe("FR-002 / FR-003: Pure HTTP and local CLI project access policy", () => {
  it("FR-002: denies unauthenticated hosted HTTP calls even when localDefaultProjectId is present", async () => {
    const { evaluateHttpProjectAccess } = await loadSlackRouting();

    const unauthenticatedHosted = evaluateHttpProjectAccess({
      projects: PROJECTS,
      roles: ROLES,
      requestedProject: "alpha",
      localDefaultProjectId: "proj-alpha",
      transport: "hosted",
      requiredAccess: "read",
    });

    expect(unauthenticatedHosted).toMatchObject({
      ok: false,
      code: "REMOTE_AUTH_REQUIRED",
    });
  });

  it("FR-002: enforces project selection, role bindings and runner policy on hosted HTTP calls", async () => {
    const { evaluateHttpProjectAccess } = await loadSlackRouting();

    const ambiguousHosted = evaluateHttpProjectAccess({
      projects: PROJECTS,
      roles: ROLES,
      transport: "hosted",
      principal: {
        principalType: "google_sub",
        principalId: "https://accounts.google.com:sub-maintainer",
      },
      requiredAccess: "read",
    });
    expect(ambiguousHosted).toMatchObject({
      ok: false,
      code: "AMBIGUOUS_PROJECT_SELECTION",
    });

    const viewerDispatching = evaluateHttpProjectAccess({
      projects: PROJECTS,
      roles: ROLES,
      requestedProject: "alpha",
      transport: "hosted",
      principal: {
        principalType: "google_sub",
        principalId: "https://accounts.google.com:sub-viewer",
      },
      requiredAccess: "operate",
    });
    expect(viewerDispatching).toMatchObject({
      ok: false,
      code: "INSUFFICIENT_ROLE",
    });

    const localOnlyOnHosted = evaluateHttpProjectAccess({
      projects: PROJECTS,
      roles: ROLES,
      requestedProject: "local-tool",
      transport: "hosted",
      principal: {
        principalType: "google_sub",
        principalId: "https://accounts.google.com:sub-maintainer",
      },
      requiredAccess: "operate",
    });
    expect(localOnlyOnHosted).toMatchObject({
      ok: false,
      code: "RUNNER_NOT_ALLOWED",
    });

    const authorizedHosted = evaluateHttpProjectAccess({
      projects: PROJECTS,
      roles: ROLES,
      requestedProject: "alpha",
      transport: "hosted",
      principal: {
        principalType: "google_sub",
        principalId: "https://accounts.google.com:sub-maintainer",
      },
      requiredAccess: "operate",
    });
    expect(authorizedHosted.ok).toBe(true);
    if (authorizedHosted.ok) {
      expect(authorizedHosted.project.projectId).toBe("proj-alpha");
      expect(authorizedHosted.role).toBe("maintainer");
      expect(["http", "local_cli"]).toContain(
        authorizedHosted.recipient.surface,
      );
      expect(authorizedHosted.recipient.projectId).toBe("proj-alpha");
    }
  });

  it("FR-003: preserves trusted local single-project and default-root resolution", async () => {
    const { evaluateHttpProjectAccess } = await loadSlackRouting();

    const localByDefaultRoot = evaluateHttpProjectAccess({
      projects: PROJECTS,
      roles: ROLES,
      localDefaultProjectId: "proj-local",
      transport: "trusted_local",
      requiredAccess: "operate",
    });
    expect(localByDefaultRoot.ok).toBe(true);
    if (localByDefaultRoot.ok) {
      expect(localByDefaultRoot.project.projectId).toBe("proj-local");
      expect(["local_cli", "http"]).toContain(
        localByDefaultRoot.recipient.surface,
      );
    }

    const singleLocalEnrollment = evaluateHttpProjectAccess({
      projects: [PROJECT_LOCAL_ONLY],
      roles: [],
      transport: "trusted_local",
      requiredAccess: "operate",
    });
    expect(singleLocalEnrollment.ok).toBe(true);
    if (singleLocalEnrollment.ok) {
      expect(singleLocalEnrollment.project.projectId).toBe("proj-local");
    }
  });
});

describe("FR-003 / TR-004: Phase 1 domain purity and NotificationPort contract", () => {
  it("TR-004: enforces AST purity on new domain modules and NotificationPort extensions", () => {
    const registryPath = path.resolve("src/domain/project-registry.ts");
    const routingPath = path.resolve("src/domain/slack-routing.ts");
    const notificationPortPath = path.resolve("src/ports/notification-port.ts");

    expect(fs.existsSync(registryPath)).toBe(true);
    expect(fs.existsSync(routingPath)).toBe(true);

    const registrySource = fs.readFileSync(registryPath, "utf-8");
    const routingSource = fs.readFileSync(routingPath, "utf-8");
    const notificationPortSource = fs.readFileSync(
      notificationPortPath,
      "utf-8",
    );

    expect(
      architectureViolations("domain/project-registry.ts", registrySource),
    ).toEqual([]);
    expect(
      architectureViolations("domain/slack-routing.ts", routingSource),
    ).toEqual([]);
    expect(
      architectureViolations(
        "ports/notification-port.ts",
        notificationPortSource,
      ),
    ).toEqual([]);

    const payloadMembers = getExportedTypeMembers(
      notificationPortSource,
      "NotificationPayload",
    );
    expect(payloadMembers).toEqual(
      expect.arrayContaining([
        "projectId",
        "featureId",
        "phaseId",
        "recipient",
        "text",
        "channel",
        "threadTs",
        "blocks",
        "opsOnly",
        "ephemeralUserId",
      ]),
    );

    const receiptMembers = getExportedTypeMembers(
      notificationPortSource,
      "NotificationReceipt",
    );
    expect(receiptMembers).toEqual(
      expect.arrayContaining([
        "delivered",
        "channelId",
        "messageTs",
        "threadTs",
        "queuedForPresence",
      ]),
    );

    const deliveryStatusMembers = getExportedTypeMembers(
      notificationPortSource,
      "SlackDeliveryStatus",
    );
    expect(deliveryStatusMembers).toEqual(
      expect.arrayContaining(["mode", "workspaceId", "connected", "lastError"]),
    );

    const portMembers = getExportedTypeMembers(
      notificationPortSource,
      "NotificationPort",
    );
    expect(portMembers).toEqual(
      expect.arrayContaining([
        "notify",
        "getUserPresence",
        "getDeliveryStatus",
      ]),
    );
  });
});
