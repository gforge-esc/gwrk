/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { DeliveryRecipient } from "../../domain/project-registry.js";
import { resolveProjectSlackRecipient } from "../../domain/slack-delivery.js";
import {
  type CommandAccessLevel,
  type RouteDenialCode,
  evaluateHttpProjectAccess,
} from "../../domain/slack-routing.js";
import type { ProjectRegistryPort } from "../../ports/store-port.js";
import type { DispatchQueue, DispatchRequest } from "../dispatch.js";

export interface DispatchRoutesOptions {
  registry?: ProjectRegistryPort;
  transport?: "trusted_local" | "hosted";
  localDefaultProjectId?: string;
  resolvePrincipal?: (request: FastifyRequest) =>
    | {
        principalType: "cli_token" | "google_sub";
        principalId: string;
      }
    | undefined;
}

type RawDispatchBody = Omit<DispatchRequest, "recipient"> & {
  recipient?: DeliveryRecipient | null;
};

function httpStatusForDenial(code: RouteDenialCode): number {
  switch (code) {
    case "REMOTE_AUTH_REQUIRED":
      return 401;
    case "UNAUTHORIZED_USER":
    case "INSUFFICIENT_ROLE":
    case "RUNNER_NOT_ALLOWED":
      return 403;
    case "UNKNOWN_PROJECT":
      return 404;
    default:
      return 400;
  }
}

function authorizeRequest(
  request: FastifyRequest,
  requestedProject: string | undefined,
  requiredAccess: CommandAccessLevel,
  options: DispatchRoutesOptions,
) {
  const projects = options.registry?.listProjects() ?? [];
  const roles = projects.flatMap(
    (project) => options.registry?.listRoleBindings(project.projectId) ?? [],
  );
  const decision = evaluateHttpProjectAccess({
    projects,
    roles,
    requestedProject,
    localDefaultProjectId: options.localDefaultProjectId,
    transport: options.transport ?? "trusted_local",
    principal: options.resolvePrincipal?.(request),
    requiredAccess,
  });

  if (!decision.ok) {
    return {
      ok: false as const,
      status: httpStatusForDenial(decision.code),
      body: {
        ok: false,
        code: decision.code,
        error: decision.message,
        ...(decision.candidateSlugs
          ? { candidateSlugs: decision.candidateSlugs }
          : {}),
      },
    };
  }

  return { ok: true as const, decision };
}

export async function dispatchRoutes(
  fastify: FastifyInstance,
  queue: DispatchQueue,
  options?: DispatchRoutesOptions,
) {
  const enforceAccess = Boolean(
    options?.registry || options?.transport === "hosted",
  );

  fastify.post("/api/dispatch", async (request, reply) => {
    const body = (request.body ?? {}) as RawDispatchBody;
    if (!body.featureId || !body.phaseId) {
      return reply.status(400).send({ error: "Missing featureId or phaseId" });
    }

    const hasExplicitNullRecipient =
      Object.prototype.hasOwnProperty.call(body, "recipient") &&
      body.recipient === null;
    const rawRecipient =
      body.recipient && typeof body.recipient === "object"
        ? body.recipient
        : undefined;

    if (enforceAccess && options) {
      const auth = authorizeRequest(
        request,
        body.projectId ?? rawRecipient?.projectId,
        "operate",
        options,
      );
      if (!auth.ok) {
        return reply.status(auth.status).send(auth.body);
      }

      const project = auth.decision.project;
      if (rawRecipient?.projectId) {
        const resolvedRecipientProject =
          options.registry?.getProject(rawRecipient.projectId)?.projectId ??
          rawRecipient.projectId;
        if (resolvedRecipientProject !== project.projectId) {
          return reply.status(403).send({
            ok: false,
            code: "THREAD_PROJECT_MISMATCH",
            error: "Recipient project does not match authorized project.",
          });
        }
      }

      let resolvedRecipient: DeliveryRecipient | undefined;
      if (rawRecipient) {
        if (
          rawRecipient.surface === "slack" ||
          rawRecipient.workspaceId !== undefined ||
          rawRecipient.channelId !== undefined ||
          rawRecipient.threadTs !== undefined
        ) {
          const storedThread = !rawRecipient.opsOnly
            ? (options.registry?.getFeatureThread(
                project.projectId,
                body.featureId,
              ) ?? null)
            : null;
          const check = resolveProjectSlackRecipient({
            project,
            enrolledProjects: options.registry?.listProjects(),
            storedThread,
            recipient: rawRecipient,
            opsOnly: Boolean(rawRecipient.opsOnly),
          });
          if (!check.ok) {
            return reply.status(403).send({
              ok: false,
              code: "THREAD_PROJECT_MISMATCH",
              error: check.message,
            });
          }
          resolvedRecipient =
            rawRecipient.surface === "slack"
              ? check.recipient
              : { ...rawRecipient, projectId: project.projectId };
        } else {
          resolvedRecipient = {
            ...rawRecipient,
            projectId: project.projectId,
          };
        }
      } else if (!hasExplicitNullRecipient) {
        resolvedRecipient = auth.decision.recipient;
      }

      const { recipient: _rawRecipient, ...rest } = body;
      const record = queue.enqueue({
        ...rest,
        projectId: project.projectId,
        recipient: resolvedRecipient,
      });
      return reply.status(201).send(record);
    }

    const { recipient: _rawRecipient, ...rest } = body;
    const record = queue.enqueue({
      ...rest,
      ...(rawRecipient ? { recipient: rawRecipient } : {}),
    });
    return reply.status(201).send(record);
  });

  fastify.get<{ Querystring: { projectId?: string; project?: string } }>(
    "/api/dispatch/queue",
    async (request, reply) => {
      const requestedProject =
        request.query?.projectId ?? request.query?.project;
      if (enforceAccess && options) {
        const auth = authorizeRequest(
          request,
          requestedProject,
          "read",
          options,
        );
        if (!auth.ok) {
          return reply.status(auth.status).send(auth.body);
        }
        return queue.getQueue(auth.decision.project.projectId);
      }
      return queue.getQueue(requestedProject);
    },
  );

  fastify.get<{
    Params: { feature: string; phase: string };
    Querystring: { projectId?: string; project?: string };
  }>("/api/dispatch/:feature/:phase", async (request, reply) => {
    const { feature, phase } = request.params;
    const requestedProject = request.query?.projectId ?? request.query?.project;
    let projectId = requestedProject;
    if (enforceAccess && options) {
      const auth = authorizeRequest(request, requestedProject, "read", options);
      if (!auth.ok) {
        return reply.status(auth.status).send(auth.body);
      }
      projectId = auth.decision.project.projectId;
    }
    const record = queue.getDispatch(feature, phase, undefined, projectId);
    if (!record) {
      return reply.status(404).send({ error: "Not found" });
    }
    return record;
  });
}
