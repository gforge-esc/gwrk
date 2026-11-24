/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { randomBytes } from "node:crypto";
import {
  type ApiCredentialMetadata,
  type HostedSecurityPolicy,
  redactAuthText,
  validateApiCredentialExpiry,
} from "../../domain/auth-policy.js";
import {
  type ProjectRole,
  type ProjectRoleBinding,
  ProjectRoleSchema,
} from "../../domain/project-registry.js";
import type {
  AuthStorePort,
  CredentialCryptoPort,
  CredentialGrantAdminPort,
} from "../../ports/auth-port.js";
import type { ClockPort } from "../../ports/operations-port.js";
import type { ProjectRegistryPort } from "../../ports/store-port.js";

const PUBLIC_CREDENTIAL_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export class CredentialPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialPolicyError";
  }
}

export class CredentialNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialNotFoundError";
  }
}

export class CredentialDeliveryError extends Error {
  constructor(
    message: string,
    public readonly credentialId: string,
    public readonly orphanRevoked: boolean,
  ) {
    super(message);
    this.name = "CredentialDeliveryError";
  }
}

function defaultCredentialId(): string {
  return `cred_${randomBytes(12).toString("hex")}`;
}

function assertValidAudienceOrigin(audienceOrigin: string): string {
  const trimmed = audienceOrigin.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new CredentialPolicyError(
      "Audience origin must be a valid HTTPS origin (for example https://gwrk.gforge.ai)",
    );
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.origin !== trimmed
  ) {
    throw new CredentialPolicyError(
      "Audience origin must be a canonical HTTPS origin without path or userinfo",
    );
  }
  return parsed.origin;
}

function assertPublicCredentialId(
  credentialId: string,
  fieldLabel: string,
): string {
  if (
    typeof credentialId !== "string" ||
    !PUBLIC_CREDENTIAL_ID_PATTERN.test(credentialId)
  ) {
    throw new CredentialPolicyError(
      `Invalid ${fieldLabel}. Supply a public credential ID matching /^[A-Za-z0-9_-]{1,64}$/, never a raw credential. Run 'gwrk auth key list' to inspect credential IDs.`,
    );
  }
  return credentialId;
}

export interface CreateApiCredentialDeps {
  readonly authStore: AuthStorePort;
  readonly grantAdmin: CredentialGrantAdminPort;
  readonly crypto: CredentialCryptoPort;
  readonly clock: ClockPort;
  readonly projectRegistry: ProjectRegistryPort;
  readonly deliverSecret: (
    rawCredential: string,
    credentialId: string,
  ) => Promise<void>;
  readonly generateCredentialId?: () => string;
  readonly policy?: HostedSecurityPolicy;
}

export interface CreateApiCredentialInput {
  readonly credentialId?: string;
  readonly label: string;
  readonly issuer: string;
  readonly audienceOrigin: string;
  readonly expiresAt: string;
  readonly grants: readonly {
    readonly projectId: string;
    readonly role: ProjectRole;
  }[];
}

export interface CreateApiCredentialResult {
  readonly credential: ApiCredentialMetadata;
  readonly grants: readonly ProjectRoleBinding[];
}

export async function createApiCredential(
  deps: CreateApiCredentialDeps,
  input: CreateApiCredentialInput,
): Promise<CreateApiCredentialResult> {
  const label = input.label.trim();
  if (label.length === 0) {
    throw new CredentialPolicyError("API credential label must be non-empty");
  }
  const issuer = input.issuer.trim();
  if (issuer.length === 0) {
    throw new CredentialPolicyError("API credential issuer must be non-empty");
  }
  const audienceOrigin = assertValidAudienceOrigin(input.audienceOrigin);

  const nowMs = deps.clock.nowMs();
  const expiryResult = validateApiCredentialExpiry({
    nowMs,
    expiresAt: input.expiresAt,
    policy: deps.policy,
  });
  if (!expiryResult.ok) {
    throw new CredentialPolicyError(expiryResult.message);
  }

  if (!Array.isArray(input.grants) || input.grants.length === 0) {
    throw new CredentialPolicyError(
      "At least one explicit enrolled-project grant (--grant <project>=<role>) is required",
    );
  }

  const resolvedByProject = new Map<string, ProjectRole>();
  for (const grant of input.grants) {
    const rawProject = grant.projectId.trim();
    if (rawProject.length === 0 || rawProject === "*") {
      throw new CredentialPolicyError(
        "Wildcard or blank project grants are forbidden. Pass an explicit enrolled project. Run 'gwrk project list' to see enrolled projects.",
      );
    }
    const parsedRole = ProjectRoleSchema.safeParse(grant.role);
    if (!parsedRole.success) {
      throw new CredentialPolicyError(
        `Invalid role '${String(grant.role)}'. Expected viewer, operator, or maintainer.`,
      );
    }
    const project = deps.projectRegistry.getProject(rawProject);
    if (!project) {
      throw new CredentialNotFoundError(
        `Project '${rawProject}' is not enrolled. Run 'gwrk project list' to see enrolled projects.`,
      );
    }
    const existingRole = resolvedByProject.get(project.projectId);
    if (existingRole && existingRole !== parsedRole.data) {
      throw new CredentialPolicyError(
        `Conflicting roles specified for project '${project.slug}'`,
      );
    }
    resolvedByProject.set(project.projectId, parsedRole.data);
  }

  const credentialId =
    input.credentialId !== undefined
      ? assertPublicCredentialId(input.credentialId, "credential ID")
      : (deps.generateCredentialId ?? defaultCredentialId)();

  const { rawCredential, verifierSha256 } =
    deps.crypto.generateApiCredential(credentialId);

  const created = deps.grantAdmin.createCredentialWithGrants({
    credentialId,
    verifierSha256,
    label,
    issuer,
    audienceOrigin,
    createdAt: deps.clock.nowIso(),
    expiresAt: expiryResult.expiresAt,
    grants: Array.from(resolvedByProject.entries()).map(
      ([projectId, role]) => ({
        projectId,
        role,
      }),
    ),
  });

  try {
    await deps.deliverSecret(rawCredential, credentialId);
  } catch (err: unknown) {
    const orphanRevoked = deps.authStore.revokeApiCredential({
      credentialId,
      revokedAt: deps.clock.nowIso(),
      reason: "secret_delivery_failed",
    });
    const detail = redactAuthText(
      err instanceof Error ? err.message : String(err),
    );
    throw new CredentialDeliveryError(
      `Secret delivery failed (${detail}); revoked orphan credential '${credentialId}'.`,
      credentialId,
      orphanRevoked,
    );
  }

  return created;
}

export interface ListApiCredentialsDeps {
  readonly authStore: AuthStorePort;
}

export function listApiCredentials(
  deps: ListApiCredentialsDeps,
): readonly ApiCredentialMetadata[] {
  return deps.authStore.listApiCredentials();
}

export interface RevokeApiCredentialDeps {
  readonly authStore: AuthStorePort;
  readonly clock: ClockPort;
}

export interface RevokeApiCredentialInput {
  readonly credentialId: string;
  readonly reason: string;
}

export interface RevokeApiCredentialResult {
  readonly credentialId: string;
  readonly revoked: boolean;
  readonly alreadyRevoked: boolean;
}

export function revokeApiCredential(
  deps: RevokeApiCredentialDeps,
  input: RevokeApiCredentialInput,
): RevokeApiCredentialResult {
  const credentialId = assertPublicCredentialId(
    input.credentialId,
    "credential ID",
  );
  const existing = deps.authStore.findApiCredentialById(credentialId);
  if (!existing) {
    throw new CredentialNotFoundError(
      `API credential '${credentialId}' not found. Run 'gwrk auth key list' to inspect credentials.`,
    );
  }

  const reason = input.reason.trim() || "manual_revoke";
  const revoked = deps.authStore.revokeApiCredential({
    credentialId,
    revokedAt: deps.clock.nowIso(),
    reason,
  });

  return {
    credentialId,
    revoked,
    alreadyRevoked: !revoked,
  };
}

export interface RotateApiCredentialDeps {
  readonly authStore: AuthStorePort;
  readonly grantAdmin: CredentialGrantAdminPort;
  readonly crypto: CredentialCryptoPort;
  readonly clock: ClockPort;
  readonly deliverSecret: (
    rawCredential: string,
    credentialId: string,
  ) => Promise<void>;
  readonly generateCredentialId?: () => string;
  readonly policy?: HostedSecurityPolicy;
}

export interface RotateApiCredentialInput {
  readonly targetCredentialId: string;
  readonly newCredentialId?: string;
  readonly issuer: string;
  readonly audienceOrigin: string;
  readonly expiresAt: string;
  readonly overlapUntil?: string;
  readonly reason: string;
}

export interface RotateApiCredentialResult {
  readonly created: ApiCredentialMetadata;
  readonly revokedCredentialId: string | null;
  readonly overlapUntil: string | null;
  readonly copiedGrants: readonly ProjectRoleBinding[];
}

export async function rotateApiCredential(
  deps: RotateApiCredentialDeps,
  input: RotateApiCredentialInput,
): Promise<RotateApiCredentialResult> {
  const targetCredentialId = assertPublicCredentialId(
    input.targetCredentialId,
    "target credential ID",
  );
  const issuer = input.issuer.trim();
  if (issuer.length === 0) {
    throw new CredentialPolicyError("API credential issuer must be non-empty");
  }
  const audienceOrigin = assertValidAudienceOrigin(input.audienceOrigin);
  const reason = input.reason.trim() || "manual_rotation";

  const nowMs = deps.clock.nowMs();
  const expiryResult = validateApiCredentialExpiry({
    nowMs,
    expiresAt: input.expiresAt,
    policy: deps.policy,
  });
  if (!expiryResult.ok) {
    throw new CredentialPolicyError(expiryResult.message);
  }

  let validatedOverlapUntil: string | undefined;
  if (input.overlapUntil !== undefined) {
    const overlapResult = validateApiCredentialExpiry({
      nowMs,
      expiresAt: input.overlapUntil,
      policy: deps.policy,
    });
    if (!overlapResult.ok) {
      throw new CredentialPolicyError(
        `Invalid overlap expiry: ${overlapResult.message}`,
      );
    }
    if (overlapResult.expiresAtMs > expiryResult.expiresAtMs) {
      throw new CredentialPolicyError(
        "Overlap expiry must not exceed the rotated credential expiry",
      );
    }
    validatedOverlapUntil = overlapResult.expiresAt;
  }

  const target = deps.authStore.findApiCredentialById(targetCredentialId);
  if (!target) {
    throw new CredentialNotFoundError(
      `API credential '${targetCredentialId}' not found. Run 'gwrk auth key list' to inspect credentials.`,
    );
  }
  if (target.revokedAt !== null) {
    throw new CredentialNotFoundError(
      `API credential '${targetCredentialId}' is already revoked. Run 'gwrk auth key list' to inspect active credentials.`,
    );
  }

  const newCredentialId =
    input.newCredentialId !== undefined
      ? assertPublicCredentialId(input.newCredentialId, "new credential ID")
      : (deps.generateCredentialId ?? defaultCredentialId)();

  const { rawCredential, verifierSha256 } =
    deps.crypto.generateApiCredential(newCredentialId);

  const rotated = deps.grantAdmin.rotateCredential({
    targetCredentialId,
    newCredentialId,
    newVerifierSha256: verifierSha256,
    issuer,
    audienceOrigin,
    createdAt: deps.clock.nowIso(),
    expiresAt: expiryResult.expiresAt,
    ...(validatedOverlapUntil ? { overlapUntil: validatedOverlapUntil } : {}),
    reason,
  });

  try {
    await deps.deliverSecret(rawCredential, newCredentialId);
  } catch (err: unknown) {
    const orphanRevoked = deps.authStore.revokeApiCredential({
      credentialId: newCredentialId,
      revokedAt: deps.clock.nowIso(),
      reason: "secret_delivery_failed",
    });
    const detail = redactAuthText(
      err instanceof Error ? err.message : String(err),
    );
    throw new CredentialDeliveryError(
      `Secret delivery failed (${detail}); revoked orphan rotated credential '${newCredentialId}'.`,
      newCredentialId,
      orphanRevoked,
    );
  }

  return rotated;
}
