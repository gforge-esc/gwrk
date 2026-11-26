/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type Database from "better-sqlite3";
import { openDatabase } from "../../db/index.js";
import { canonicalProjectId } from "../../db/project-registry.js";
import type {
  ApiCredentialMetadata,
  AuthAuditEvent,
  StoredApiCredential,
  StoredGoogleSession,
} from "../../domain/auth-policy.js";
import {
  type ProjectRoleBinding,
  ProjectRoleSchema,
} from "../../domain/project-registry.js";
import type {
  AuthStorePort,
  CredentialGrantAdminPort,
} from "../../ports/auth-port.js";
import type { SqliteStoreOptions } from "./index.js";

const CREDENTIAL_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const SHA256_LOWER_HEX_PATTERN = /^[0-9a-f]{64}$/;

export interface SqliteAuthStoreOptions extends SqliteStoreOptions {
  close?: () => void;
}

export type SqliteAuthStoreAdapter = AuthStorePort & CredentialGrantAdminPort;

interface ApiCredentialMetadataRow {
  credential_id: string;
  label: string;
  issuer: string;
  audience_origin: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
  rotated_from_id: string | null;
  overlap_until: string | null;
}

interface StoredApiCredentialRow extends ApiCredentialMetadataRow {
  verifier_sha256: string;
}

interface GoogleSessionRow {
  token_digest_sha256: string;
  principal_id: string;
  issued_at: string;
  expires_at: string;
  session_cap_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
}

function toApiCredentialMetadata(
  row: ApiCredentialMetadataRow,
): ApiCredentialMetadata {
  return {
    credentialId: row.credential_id,
    label: row.label,
    issuer: row.issuer,
    audienceOrigin: row.audience_origin,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
    rotatedFromId: row.rotated_from_id,
    overlapUntil: row.overlap_until,
  };
}

function toStoredApiCredential(
  row: StoredApiCredentialRow,
): StoredApiCredential {
  return {
    ...toApiCredentialMetadata(row),
    verifierSha256: row.verifier_sha256,
  };
}

function toStoredGoogleSession(row: GoogleSessionRow): StoredGoogleSession {
  return {
    tokenDigestSha256: row.token_digest_sha256,
    principalId: row.principal_id,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    sessionCapAt: row.session_cap_at,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
  };
}

function assertValidCredentialId(credentialId: string): void {
  if (
    typeof credentialId !== "string" ||
    !CREDENTIAL_ID_PATTERN.test(credentialId)
  ) {
    throw new Error("Invalid API credential identifier");
  }
}

function assertValidSha256(value: string, label: string): void {
  if (typeof value !== "string" || !SHA256_LOWER_HEX_PATTERN.test(value)) {
    throw new Error(
      `Invalid ${label}: expected 64-character lowercase SHA-256 hex`,
    );
  }
}

function assertNonBlank(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be non-empty`);
  }
}

export function createSqliteAuthStoreAdapter(
  options: SqliteAuthStoreOptions = {},
): SqliteAuthStoreAdapter {
  const { db, close: onClose, ...databaseOptions } = options;
  const connection: Database.Database = db ?? openDatabase(databaseOptions);

  const findCredentialStmt = connection.prepare<
    [string],
    StoredApiCredentialRow
  >(`
    SELECT credential_id, verifier_sha256, label, issuer, audience_origin,
           created_at, expires_at, revoked_at, revoked_reason,
           rotated_from_id, overlap_until
    FROM api_credentials
    WHERE credential_id = ?
  `);

  const listCredentialsStmt = connection.prepare<[], ApiCredentialMetadataRow>(
    `
    SELECT credential_id, label, issuer, audience_origin,
           created_at, expires_at, revoked_at, revoked_reason,
           rotated_from_id, overlap_until
    FROM api_credentials
    ORDER BY created_at DESC, credential_id ASC
  `,
  );

  const revokeCredentialStmt = connection.prepare<{
    credentialId: string;
    revokedAt: string;
    reason: string;
  }>(`
    UPDATE api_credentials
    SET revoked_at = @revokedAt, revoked_reason = @reason
    WHERE credential_id = @credentialId AND revoked_at IS NULL
  `);

  const setOverlapUntilStmt = connection.prepare<{
    credentialId: string;
    overlapUntil: string;
  }>(`
    UPDATE api_credentials
    SET overlap_until = @overlapUntil
    WHERE credential_id = @credentialId AND revoked_at IS NULL
  `);

  const insertCredentialStmt = connection.prepare<
    {
      credentialId: string;
      verifierSha256: string;
      label: string;
      issuer: string;
      audienceOrigin: string;
      createdAt: string;
      expiresAt: string;
      rotatedFromId: string | null;
    },
    ApiCredentialMetadataRow
  >(`
    INSERT INTO api_credentials (
      credential_id, verifier_sha256, label, issuer, audience_origin,
      created_at, expires_at, revoked_at, revoked_reason,
      rotated_from_id, overlap_until
    ) VALUES (
      @credentialId, @verifierSha256, @label, @issuer, @audienceOrigin,
      @createdAt, @expiresAt, NULL, NULL,
      @rotatedFromId, NULL
    )
    RETURNING credential_id, label, issuer, audience_origin,
              created_at, expires_at, revoked_at, revoked_reason,
              rotated_from_id, overlap_until
  `);

  const insertRoleBindingStmt = connection.prepare<{
    projectId: string;
    principalId: string;
    role: string;
    createdAt: string;
  }>(`
    INSERT INTO project_role_bindings (
      project_id, principal_type, principal_id, role, created_at
    ) VALUES (
      @projectId, 'cli_token', @principalId, @role, @createdAt
    )
  `);

  const listEnrolledCredentialBindingsStmt = connection.prepare<
    [string],
    ProjectRoleBinding
  >(`
    SELECT b.project_id AS projectId,
           b.principal_type AS principalType,
           b.principal_id AS principalId,
           b.role AS role
    FROM project_role_bindings b
    JOIN projects p ON p.id = b.project_id
    WHERE b.principal_type = 'cli_token'
      AND b.principal_id = ?
      AND p.updated_at IS NOT NULL
    ORDER BY b.project_id ASC
  `);

  const checkEnrolledProjectStmt = connection.prepare<[string], { id: string }>(
    `
    SELECT id FROM projects WHERE id = ? AND updated_at IS NOT NULL
  `,
  );

  const insertSessionIfAbsentStmt = connection.prepare<{
    tokenDigestSha256: string;
    principalId: string;
    issuedAt: string;
    expiresAt: string;
    sessionCapAt: string;
  }>(`
    INSERT INTO google_sessions (
      token_digest_sha256, principal_id, issued_at, expires_at, session_cap_at
    ) VALUES (
      @tokenDigestSha256, @principalId, @issuedAt, @expiresAt, @sessionCapAt
    )
    ON CONFLICT(token_digest_sha256) DO NOTHING
  `);

  const selectSessionStmt = connection.prepare<[string], GoogleSessionRow>(`
    SELECT token_digest_sha256, principal_id, issued_at, expires_at,
           session_cap_at, revoked_at, revoked_reason
    FROM google_sessions
    WHERE token_digest_sha256 = ?
  `);

  const revokeSessionStmt = connection.prepare<{
    tokenDigestSha256: string;
    revokedAt: string;
    reason: string;
  }>(`
    UPDATE google_sessions
    SET revoked_at = @revokedAt, revoked_reason = @reason
    WHERE token_digest_sha256 = @tokenDigestSha256 AND revoked_at IS NULL
  `);

  const insertAuditEventStmt = connection.prepare<{
    occurredAt: string;
    eventType: string;
    outcome: string;
    principalType: string | null;
    principalId: string | null;
    credentialId: string | null;
    requestId: string | null;
    detailCode: string | null;
    metadataJson: string | null;
  }>(`
    INSERT INTO auth_audit_events (
      occurred_at, event_type, outcome, principal_type, principal_id,
      credential_id, request_id, detail_code, metadata_json
    ) VALUES (
      @occurredAt, @eventType, @outcome, @principalType, @principalId,
      @credentialId, @requestId, @detailCode, @metadataJson
    )
  `);

  function writeAuditEvent(event: AuthAuditEvent): void {
    insertAuditEventStmt.run({
      occurredAt: event.occurredAt,
      eventType: event.eventType,
      outcome: event.outcome,
      principalType: event.principalType,
      principalId: event.principalId,
      credentialId: event.credentialId,
      requestId: event.requestId,
      detailCode: event.detailCode,
      metadataJson: event.metadata ? JSON.stringify(event.metadata) : null,
    });
  }

  function requireEnrolledProjectId(projectId: string): string {
    if (
      typeof projectId !== "string" ||
      projectId.trim().length === 0 ||
      projectId.trim() === "*"
    ) {
      throw new Error(
        `Invalid project grant target: '${projectId}'. Explicit enrolled projects only.`,
      );
    }
    const canonical = canonicalProjectId(connection, projectId);
    const enrolled = checkEnrolledProjectStmt.get(canonical);
    if (!enrolled) {
      throw new Error(
        `Project is not enrolled: ${projectId}. Run 'gwrk project list' to see enrolled projects.`,
      );
    }
    return enrolled.id;
  }

  const revokeApiCredentialTx = connection.transaction(
    (input: Parameters<AuthStorePort["revokeApiCredential"]>[0]): boolean => {
      assertValidCredentialId(input.credentialId);
      assertNonBlank(input.revokedAt, "revokedAt");
      assertNonBlank(input.reason, "reason");
      const result = revokeCredentialStmt.run(input);
      if (result.changes === 1) {
        writeAuditEvent({
          occurredAt: input.revokedAt,
          eventType: "api_credential.revoked",
          outcome: "allowed",
          principalType: "cli_token",
          principalId: input.credentialId,
          credentialId: input.credentialId,
          requestId: null,
          detailCode: "CREDENTIAL_REVOKED",
          metadata: { reason: input.reason },
        });
        return true;
      }
      return false;
    },
  );

  const observeGoogleSessionTx = connection.transaction(
    (input: Parameters<AuthStorePort["observeGoogleSession"]>[0]) => {
      assertValidSha256(input.tokenDigestSha256, "tokenDigestSha256");
      assertNonBlank(input.principalId, "principalId");
      assertNonBlank(input.issuedAt, "issuedAt");
      assertNonBlank(input.expiresAt, "expiresAt");
      assertNonBlank(input.sessionCapAt, "sessionCapAt");

      const inserted = insertSessionIfAbsentStmt.run(input);
      const row = selectSessionStmt.get(input.tokenDigestSha256);
      if (!row) {
        throw new Error("Observed Google session missing after insert");
      }

      if (inserted.changes === 1) {
        return {
          ok: true as const,
          session: toStoredGoogleSession(row),
          created: true,
        };
      }

      if (row.revoked_at !== null) {
        return { ok: false as const, code: "SESSION_REVOKED" as const };
      }

      if (
        row.principal_id !== input.principalId ||
        row.issued_at !== input.issuedAt ||
        row.expires_at !== input.expiresAt
      ) {
        return {
          ok: false as const,
          code: "SESSION_METADATA_CONFLICT" as const,
        };
      }

      return {
        ok: true as const,
        session: toStoredGoogleSession(row),
        created: false,
      };
    },
  );

  const revokeGoogleSessionTx = connection.transaction(
    (input: Parameters<AuthStorePort["revokeGoogleSession"]>[0]): boolean => {
      assertValidSha256(input.tokenDigestSha256, "tokenDigestSha256");
      assertNonBlank(input.revokedAt, "revokedAt");
      assertNonBlank(input.reason, "reason");
      const result = revokeSessionStmt.run(input);
      if (result.changes === 1) {
        const row = selectSessionStmt.get(input.tokenDigestSha256);
        writeAuditEvent({
          occurredAt: input.revokedAt,
          eventType: "google_session.revoked",
          outcome: "allowed",
          principalType: "google_sub",
          principalId: row?.principal_id ?? null,
          credentialId: null,
          requestId: null,
          detailCode: "SESSION_REVOKED",
          metadata: { reason: input.reason },
        });
        return true;
      }
      return false;
    },
  );

  const createCredentialWithGrantsTx = connection.transaction(
    (
      input: Parameters<
        CredentialGrantAdminPort["createCredentialWithGrants"]
      >[0],
    ) => {
      assertValidCredentialId(input.credentialId);
      assertValidSha256(input.verifierSha256, "verifierSha256");
      assertNonBlank(input.label, "label");
      assertNonBlank(input.issuer, "issuer");
      assertNonBlank(input.audienceOrigin, "audienceOrigin");
      assertNonBlank(input.createdAt, "createdAt");
      assertNonBlank(input.expiresAt, "expiresAt");

      if (!Array.isArray(input.grants) || input.grants.length === 0) {
        throw new Error(
          "At least one explicit enrolled-project grant is required",
        );
      }

      const resolvedByProject = new Map<string, ProjectRoleBinding>();
      for (const grant of input.grants) {
        const parsedRole = ProjectRoleSchema.safeParse(grant.role);
        if (!parsedRole.success) {
          throw new Error(
            `Invalid project role '${String(grant.role)}'. Expected viewer, operator, or maintainer.`,
          );
        }
        const canonicalProject = requireEnrolledProjectId(grant.projectId);
        const existing = resolvedByProject.get(canonicalProject);
        if (existing && existing.role !== parsedRole.data) {
          throw new Error(
            `Conflicting roles for project '${canonicalProject}' in credential grants`,
          );
        }
        resolvedByProject.set(canonicalProject, {
          projectId: canonicalProject,
          principalType: "cli_token",
          principalId: input.credentialId,
          role: parsedRole.data,
        });
      }

      const createdRow = insertCredentialStmt.get({
        credentialId: input.credentialId,
        verifierSha256: input.verifierSha256,
        label: input.label,
        issuer: input.issuer,
        audienceOrigin: input.audienceOrigin,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
        rotatedFromId: null,
      });
      if (!createdRow) {
        throw new Error(
          `Failed to persist API credential: ${input.credentialId}`,
        );
      }

      const grants = Array.from(resolvedByProject.values());
      for (const binding of grants) {
        insertRoleBindingStmt.run({
          projectId: binding.projectId,
          principalId: binding.principalId,
          role: binding.role,
          createdAt: input.createdAt,
        });
      }

      writeAuditEvent({
        occurredAt: input.createdAt,
        eventType: "api_credential.created",
        outcome: "allowed",
        principalType: "cli_token",
        principalId: input.credentialId,
        credentialId: input.credentialId,
        requestId: null,
        detailCode: "CREDENTIAL_CREATED",
        metadata: {
          issuer: input.issuer,
          grantCount: grants.length,
        },
      });

      return {
        credential: toApiCredentialMetadata(createdRow),
        grants,
      };
    },
  );

  const rotateCredentialTx = connection.transaction(
    (input: Parameters<CredentialGrantAdminPort["rotateCredential"]>[0]) => {
      assertValidCredentialId(input.targetCredentialId);
      assertValidCredentialId(input.newCredentialId);
      if (input.targetCredentialId === input.newCredentialId) {
        throw new Error(
          "Rotated credential identifier must differ from target credential identifier",
        );
      }
      assertValidSha256(input.newVerifierSha256, "newVerifierSha256");
      assertNonBlank(input.issuer, "issuer");
      assertNonBlank(input.audienceOrigin, "audienceOrigin");
      assertNonBlank(input.createdAt, "createdAt");
      assertNonBlank(input.expiresAt, "expiresAt");
      assertNonBlank(input.reason, "reason");

      const target = findCredentialStmt.get(input.targetCredentialId);
      if (!target) {
        throw new Error(
          `Target API credential not found: ${input.targetCredentialId}`,
        );
      }
      if (target.revoked_at !== null) {
        throw new Error(
          `Target API credential is already revoked: ${input.targetCredentialId}`,
        );
      }

      const createdMs = Date.parse(input.createdAt);
      const targetExpiresMs = Date.parse(target.expires_at);
      if (
        !Number.isFinite(createdMs) ||
        !Number.isFinite(targetExpiresMs) ||
        createdMs >= targetExpiresMs
      ) {
        throw new Error(
          `Target API credential has expired: ${input.targetCredentialId}`,
        );
      }
      if (target.overlap_until !== null) {
        const targetOverlapMs = Date.parse(target.overlap_until);
        if (!Number.isFinite(targetOverlapMs) || createdMs >= targetOverlapMs) {
          throw new Error(
            `Target API credential overlap window has expired: ${input.targetCredentialId}`,
          );
        }
      }

      if (input.overlapUntil !== undefined) {
        const overlapMs = Date.parse(input.overlapUntil);
        if (!Number.isFinite(overlapMs) || overlapMs <= createdMs) {
          throw new Error("Overlap expiry must be a finite future timestamp");
        }
      }

      const existingBindings = listEnrolledCredentialBindingsStmt.all(
        input.targetCredentialId,
      );
      if (existingBindings.length === 0) {
        throw new Error(
          `Target API credential has no enrolled project grants to copy: ${input.targetCredentialId}`,
        );
      }

      const newRow = insertCredentialStmt.get({
        credentialId: input.newCredentialId,
        verifierSha256: input.newVerifierSha256,
        label: target.label,
        issuer: input.issuer,
        audienceOrigin: input.audienceOrigin,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
        rotatedFromId: input.targetCredentialId,
      });
      if (!newRow) {
        throw new Error(
          `Failed to persist rotated API credential: ${input.newCredentialId}`,
        );
      }

      const copiedGrants: ProjectRoleBinding[] = existingBindings.map(
        (binding) => ({
          projectId: binding.projectId,
          principalType: "cli_token",
          principalId: input.newCredentialId,
          role: binding.role,
        }),
      );

      for (const binding of copiedGrants) {
        insertRoleBindingStmt.run({
          projectId: binding.projectId,
          principalId: binding.principalId,
          role: binding.role,
          createdAt: input.createdAt,
        });
      }

      let revokedCredentialId: string | null = null;
      let overlapUntil: string | null = null;

      if (input.overlapUntil !== undefined) {
        const updated = setOverlapUntilStmt.run({
          credentialId: input.targetCredentialId,
          overlapUntil: input.overlapUntil,
        });
        if (updated.changes !== 1) {
          throw new Error(
            `Failed to set rotation overlap on credential: ${input.targetCredentialId}`,
          );
        }
        overlapUntil = input.overlapUntil;
      } else {
        const revoked = revokeCredentialStmt.run({
          credentialId: input.targetCredentialId,
          revokedAt: input.createdAt,
          reason: input.reason,
        });
        if (revoked.changes !== 1) {
          throw new Error(
            `Failed to revoke rotated credential: ${input.targetCredentialId}`,
          );
        }
        revokedCredentialId = input.targetCredentialId;
      }

      writeAuditEvent({
        occurredAt: input.createdAt,
        eventType: "api_credential.rotated",
        outcome: "allowed",
        principalType: "cli_token",
        principalId: input.newCredentialId,
        credentialId: input.newCredentialId,
        requestId: null,
        detailCode: overlapUntil
          ? "CREDENTIAL_ROTATED_WITH_OVERLAP"
          : "CREDENTIAL_ROTATED",
        metadata: {
          rotatedFromId: input.targetCredentialId,
          revokedCredentialId,
          overlapUntil,
          reason: input.reason,
          copiedGrantCount: copiedGrants.length,
        },
      });

      return {
        created: toApiCredentialMetadata(newRow),
        revokedCredentialId,
        overlapUntil,
        copiedGrants,
      };
    },
  );

  return {
    findApiCredentialById(credentialId) {
      const row = findCredentialStmt.get(credentialId);
      return row ? toStoredApiCredential(row) : null;
    },
    listApiCredentials() {
      return listCredentialsStmt.all().map(toApiCredentialMetadata);
    },
    revokeApiCredential(input) {
      return revokeApiCredentialTx.immediate(input);
    },
    observeGoogleSession(input) {
      return observeGoogleSessionTx.immediate(input);
    },
    getGoogleSession(tokenDigestSha256) {
      const row = selectSessionStmt.get(tokenDigestSha256);
      return row ? toStoredGoogleSession(row) : null;
    },
    revokeGoogleSession(input) {
      return revokeGoogleSessionTx.immediate(input);
    },
    appendAuditEvent(event) {
      writeAuditEvent(event);
    },
    createCredentialWithGrants(input) {
      return createCredentialWithGrantsTx.immediate(input);
    },
    rotateCredential(input) {
      return rotateCredentialTx.immediate(input);
    },
    close() {
      if (!db && connection.open) connection.close();
      onClose?.();
    },
  };
}

export function createSqliteCredentialGrantAdminAdapter(
  options: SqliteAuthStoreOptions = {},
): CredentialGrantAdminPort & { close(): void } {
  return createSqliteAuthStoreAdapter(options);
}
