/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type {
  DeliveryRecipient,
  EnrolledProject,
  ProjectRole,
  ProjectRoleBinding,
  SlackActionReceipt,
  SlackFeatureThread,
} from "./project-registry.js";

export type RouteDenialCode =
  | "UNBOUND_WORKSPACE"
  | "UNBOUND_CHANNEL"
  | "AMBIGUOUS_PROJECT_SELECTION"
  | "UNKNOWN_PROJECT"
  | "CHANNEL_PROJECT_MISMATCH"
  | "UNAUTHORIZED_USER"
  | "INSUFFICIENT_ROLE"
  | "THREAD_PROJECT_MISMATCH"
  | "ACTION_REPLAYED"
  | "RUNNER_NOT_ALLOWED"
  | "REMOTE_AUTH_REQUIRED";

export type CommandAccessLevel = "read" | "operate" | "maintain";

export interface SlackInboundEnvelope {
  workspaceId: string;
  channelId: string;
  isDirectMessage: boolean;
  actorUserId: string;
  threadTs?: string;
  messageTs?: string;
  requestedProject?: string;
  requiredAccess: CommandAccessLevel;
}

export interface SlackActionVerificationInput extends SlackInboundEnvelope {
  actionId: string;
  payloadProjectId?: string;
  featureId: string;
  phaseId?: string;
  payloadRootTs?: string;
  storedThread?: SlackFeatureThread | null;
  priorReceipt?: SlackActionReceipt | null;
}

interface RouteDenial {
  ok: false;
  code: RouteDenialCode;
  message: string;
  candidateSlugs?: string[];
}

export type RouteDecision =
  | {
      ok: true;
      project: EnrolledProject;
      role: ProjectRole;
      recipient: DeliveryRecipient;
    }
  | RouteDenial;

type ProjectSelection = { ok: true; project: EnrolledProject } | RouteDenial;
type Principal = Pick<ProjectRoleBinding, "principalType" | "principalId">;

const minimumRole: Record<CommandAccessLevel, ProjectRole> = {
  read: "viewer",
  operate: "operator",
  maintain: "maintainer",
};
const roleRank: Record<ProjectRole, number> = {
  viewer: 0,
  operator: 1,
  maintainer: 2,
};

export function parseProjectSelector(rawText: string): {
  requestedProject?: string;
  cleanedText: string;
} {
  let requestedProject: string | undefined;
  const cleanedText = rawText
    .replace(
      /(?:^|\s)--project(?:=(\S*)|\s+((?!-)\S+))?(?=\s|$)/g,
      (_, inline?: string, separate?: string) => {
        // An empty selector makes malformed or repeated options fail closed.
        requestedProject =
          requestedProject === undefined ? (inline ?? separate ?? "") : "";
        return "";
      },
    )
    .trim();
  return requestedProject === undefined
    ? { cleanedText }
    : { requestedProject, cleanedText };
}

export function requiredAccessForSlackCommand(
  subcommand: string,
  subarg?: string,
): CommandAccessLevel {
  if (subcommand === "adr") {
    if (subarg === "record") return "operate";
    if (!subarg || ["list", "check", "show"].includes(subarg)) return "read";
    return "maintain";
  }
  if (
    ["status", "logs", "effort", "pulse", "home", "help"].includes(subcommand)
  ) {
    return "read";
  }
  if (
    ["dispatch", "ship", "pause", "define", "research"].includes(subcommand)
  ) {
    return "operate";
  }
  return "maintain";
}

export function requiredAccessForSlackAction(
  actionId: string,
): CommandAccessLevel {
  if (["view_review", "view_logs"].includes(actionId)) return "read";
  if (
    ["retry_phase", "request_changes", "revise_spec", "revise_plan"].includes(
      actionId,
    )
  ) {
    return "operate";
  }
  return "maintain";
}

function ambiguousProject(projects: readonly EnrolledProject[]): RouteDenial {
  return {
    ok: false,
    code: "AMBIGUOUS_PROJECT_SELECTION",
    message: "Select one project explicitly.",
    candidateSlugs: projects.map((project) => project.slug).sort(),
  };
}

function matchesProjectSelector(
  project: EnrolledProject,
  selector: string,
): boolean {
  return (
    project.projectId === selector ||
    project.slug === selector ||
    project.repoSlug === selector ||
    project.legacyProjectIds.includes(selector)
  );
}

function selectProject(
  projects: readonly EnrolledProject[],
  selector: string,
  matches = matchesProjectSelector,
): ProjectSelection {
  const matchingProjects = projects.filter((project) =>
    matches(project, selector),
  );
  if (matchingProjects.length > 1) return ambiguousProject(matchingProjects);
  if (matchingProjects.length === 1)
    return { ok: true, project: matchingProjects[0] };
  return {
    ok: false,
    code: "UNKNOWN_PROJECT",
    message: "Project is not enrolled.",
  };
}

function authorizePrincipal(
  project: EnrolledProject,
  roles: readonly ProjectRoleBinding[],
  principal: Principal,
  access: CommandAccessLevel,
  recipient: DeliveryRecipient,
): RouteDecision {
  const binding = roles.find(
    (role) =>
      role.projectId === project.projectId &&
      role.principalType === principal.principalType &&
      role.principalId === principal.principalId,
  );
  if (!binding) {
    return {
      ok: false,
      code: "UNAUTHORIZED_USER",
      message: "No project role is assigned.",
    };
  }
  if (roleRank[binding.role] < roleRank[minimumRole[access]]) {
    return {
      ok: false,
      code: "INSUFFICIENT_ROLE",
      message: "A higher project role is required.",
    };
  }
  return { ok: true, project, role: binding.role, recipient };
}

function isProjectInSlackConversation(
  project: EnrolledProject,
  { workspaceId, channelId, isDirectMessage }: SlackInboundEnvelope,
): boolean {
  return (
    project.slack?.workspaceId === workspaceId &&
    (isDirectMessage || project.slack.channelId === channelId)
  );
}

export function evaluateSlackRoute(
  projects: readonly EnrolledProject[],
  roles: readonly ProjectRoleBinding[],
  envelope: SlackInboundEnvelope,
): RouteDecision {
  return evaluateSlackConversation(projects, roles, envelope);
}

function threadProjectMismatch(): RouteDenial {
  return {
    ok: false,
    code: "THREAD_PROJECT_MISMATCH",
    message: "The action does not match the project or feature thread.",
  };
}

function evaluateSlackConversation(
  projects: readonly EnrolledProject[],
  roles: readonly ProjectRoleBinding[],
  envelope: SlackInboundEnvelope,
  payloadProjectId?: string,
): RouteDecision {
  const {
    workspaceId,
    channelId,
    isDirectMessage,
    requestedProject,
    actorUserId,
  } = envelope;
  const workspaceProjects = projects.filter(
    (project) => project.slack?.workspaceId === workspaceId,
  );
  if (workspaceProjects.length === 0) {
    return {
      ok: false,
      code: "UNBOUND_WORKSPACE",
      message: "Slack workspace is not enrolled.",
    };
  }
  const candidates = workspaceProjects.filter((project) =>
    isProjectInSlackConversation(project, envelope),
  );
  if (candidates.length === 0) {
    return {
      ok: false,
      code: "UNBOUND_CHANNEL",
      message: "Slack channel is not bound to a project.",
    };
  }

  let project: EnrolledProject;
  const selector = payloadProjectId ?? requestedProject;
  if (selector !== undefined) {
    const matches =
      payloadProjectId === undefined
        ? matchesProjectSelector
        : (entry: EnrolledProject, id: string) => entry.projectId === id;
    const selection = selectProject(candidates, selector, matches);
    if (!selection.ok) {
      if (selection.code !== "UNKNOWN_PROJECT") return selection;
      if (workspaceProjects.some((entry) => matches(entry, selector))) {
        return {
          ok: false,
          code: "CHANNEL_PROJECT_MISMATCH",
          message: "The selected project is outside this Slack conversation.",
        };
      }
      return {
        ...selection,
        message: "Project is not enrolled for this Slack conversation.",
      };
    }
    project = selection.project;
    if (
      payloadProjectId !== undefined &&
      requestedProject !== undefined &&
      !matchesProjectSelector(project, requestedProject)
    ) {
      return threadProjectMismatch();
    }
  } else {
    if (
      isDirectMessage ||
      candidates.length > 1 ||
      candidates[0].slack?.sharedChannel
    ) {
      return ambiguousProject(candidates);
    }
    project = candidates[0];
  }

  return authorizePrincipal(
    project,
    roles,
    {
      principalType: "slack_user",
      principalId: `${workspaceId}:${actorUserId}`,
    },
    envelope.requiredAccess,
    {
      projectId: project.projectId,
      surface: "slack",
      workspaceId,
      channelId,
      threadTs: envelope.threadTs,
      actorUserId,
    },
  );
}

export function evaluateSlackAction(
  projects: readonly EnrolledProject[],
  roles: readonly ProjectRoleBinding[],
  input: SlackActionVerificationInput,
): RouteDecision {
  const { payloadProjectId, payloadRootTs, storedThread, messageTs, threadTs } =
    input;
  const actionAccess = requiredAccessForSlackAction(input.actionId);
  const requiredAccess =
    roleRank[minimumRole[actionAccess]] >
    roleRank[minimumRole[input.requiredAccess]]
      ? actionAccess
      : input.requiredAccess;
  const rootTs = threadTs ?? messageTs;
  const matchesThread =
    Boolean(messageTs) &&
    storedThread &&
    storedThread.featureId === input.featureId &&
    storedThread.workspaceId === input.workspaceId &&
    storedThread.channelId === input.channelId &&
    storedThread.rootTs === rootTs;

  if (
    matchesThread &&
    payloadProjectId !== undefined &&
    payloadProjectId !== storedThread.projectId &&
    projects.some(
      (project) =>
        project.projectId === storedThread.projectId &&
        isProjectInSlackConversation(project, input),
    )
  ) {
    return threadProjectMismatch();
  }

  const route = evaluateSlackConversation(
    projects,
    roles,
    { ...input, requiredAccess },
    payloadProjectId,
  );
  if (!route.ok) {
    if (
      payloadProjectId !== undefined &&
      route.code === "CHANNEL_PROJECT_MISMATCH"
    ) {
      return threadProjectMismatch();
    }
    return route;
  }

  if (
    !matchesThread ||
    storedThread.projectId !== route.project.projectId ||
    (payloadRootTs !== undefined && payloadRootTs !== rootTs)
  ) {
    return threadProjectMismatch();
  }
  if (input.priorReceipt) {
    return {
      ok: false,
      code: "ACTION_REPLAYED",
      message: "This action already has a receipt.",
    };
  }
  return {
    ...route,
    recipient: { ...route.recipient, threadTs: storedThread.rootTs },
  };
}

export function evaluateHttpProjectAccess(input: {
  projects: readonly EnrolledProject[];
  roles: readonly ProjectRoleBinding[];
  requestedProject?: string;
  localDefaultProjectId?: string;
  transport: "trusted_local" | "hosted";
  principal?: {
    principalType: "cli_token" | "google_sub";
    principalId: string;
  };
  requiredAccess: CommandAccessLevel;
}): RouteDecision {
  const { projects, roles, transport, principal, requiredAccess } = input;
  const runnerKind = transport === "hosted" ? "hosted" : "local";
  if (transport === "hosted" && !principal?.principalId) {
    return {
      ok: false,
      code: "REMOTE_AUTH_REQUIRED",
      message: "Hosted access requires a verified principal.",
    };
  }

  const selector =
    input.requestedProject ??
    (transport === "trusted_local" ? input.localDefaultProjectId : undefined);
  let project: EnrolledProject;
  if (selector !== undefined) {
    const selection = selectProject(projects, selector);
    if (!selection.ok) return selection;
    project = selection.project;
  } else {
    const candidates = projects.filter((entry) =>
      entry.runnerPolicy.allowedKinds.includes(runnerKind),
    );
    if (transport === "hosted" || candidates.length !== 1) {
      return ambiguousProject(candidates);
    }
    project = candidates[0];
  }

  const recipient: DeliveryRecipient = {
    projectId: project.projectId,
    surface: transport === "hosted" ? "http" : "local_cli",
  };
  const route = principal
    ? authorizePrincipal(project, roles, principal, requiredAccess, recipient)
    : { ok: true as const, project, role: "maintainer" as const, recipient };
  if (!route.ok) return route;
  if (!project.runnerPolicy.allowedKinds.includes(runnerKind)) {
    return {
      ok: false,
      code: "RUNNER_NOT_ALLOWED",
      message: "The project does not allow this runner kind.",
    };
  }
  return route;
}
