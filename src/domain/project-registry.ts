/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { z } from "zod";

const nonBlank = z.string().refine((value) => value.trim().length > 0, {
  message: "Expected a non-blank string",
});

export const ProjectRoleSchema = z.enum(["viewer", "operator", "maintainer"]);
export type ProjectRole = z.infer<typeof ProjectRoleSchema>;

const AllowedRunnerKindSchema = z.enum(["local", "hosted"]);
export type AllowedRunnerKind = z.infer<typeof AllowedRunnerKindSchema>;

const ProjectRunnerPolicySchema = z.object({
  allowedKinds: z.array(AllowedRunnerKindSchema).min(1),
  runnerIds: z.array(nonBlank).optional(),
});
export type ProjectRunnerPolicy = z.infer<typeof ProjectRunnerPolicySchema>;

const ProjectSlackBindingSchema = z.object({
  workspaceId: nonBlank,
  channelId: nonBlank,
  channelName: nonBlank.optional(),
  opsChannelId: nonBlank.optional(),
  sharedChannel: z.boolean(),
});
export type ProjectSlackBinding = z.infer<typeof ProjectSlackBindingSchema>;

export const ProjectRoleBindingSchema = z.object({
  projectId: nonBlank,
  principalType: z.enum(["slack_user", "cli_token", "google_sub"]),
  principalId: nonBlank,
  role: ProjectRoleSchema,
});
export type ProjectRoleBinding = z.infer<typeof ProjectRoleBindingSchema>;

export const EnrolledProjectSchema = z.object({
  projectId: nonBlank,
  slug: nonBlank,
  name: nonBlank,
  repoSlug: nonBlank.nullable(),
  trunkBranch: nonBlank,
  localRoot: nonBlank.nullable(),
  mirrorPath: nonBlank.nullable(),
  runnerPolicy: ProjectRunnerPolicySchema,
  slack: ProjectSlackBindingSchema.nullable(),
  legacyProjectIds: z.array(nonBlank),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type EnrolledProject = z.infer<typeof EnrolledProjectSchema>;

export interface DeliveryRecipient {
  projectId: string;
  surface: "slack" | "local_cli" | "http";
  workspaceId?: string;
  channelId?: string;
  threadTs?: string;
  actorUserId?: string;
  opsOnly?: boolean;
}

export interface SlackFeatureThread {
  projectId: string;
  featureId: string;
  workspaceId: string;
  channelId: string;
  rootTs: string;
  updatedAt: string;
}

export interface SlackActionReceipt {
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

export function buildActionReceiptKey(input: {
  projectId: string;
  actionId: string;
  featureId: string;
  phaseId?: string | null;
  workspaceId: string;
  channelId: string;
  messageTs: string;
}): string {
  return JSON.stringify([
    input.projectId,
    input.workspaceId,
    input.channelId,
    input.messageTs,
    input.actionId,
    input.featureId,
    input.phaseId ?? null,
  ]);
}

export function validateProjectEnrollment(
  input: unknown,
): { ok: true; value: EnrolledProject } | { ok: false; error: string } {
  const result = EnrolledProjectSchema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };

  const issue = result.error.issues[0];
  const field = issue.path.join(".") || "Enrollment";
  return { ok: false, error: `${field}: ${issue.message}` };
}
