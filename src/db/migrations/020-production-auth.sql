-- This Source Code Form is subject to the terms of the Mozilla Public
-- License, v. 2.0. If a copy of the MPL was not distributed with this
-- file, You can obtain one at https://mozilla.org/MPL/2.0/.

-- Operational production authentication state (ADR-014).
-- Stores SHA-256 verifiers and token digests only; never raw credentials or Google tokens.

CREATE TABLE IF NOT EXISTS api_credentials (
  credential_id    TEXT PRIMARY KEY,
  verifier_sha256  TEXT NOT NULL CHECK (length(verifier_sha256) = 64),
  label            TEXT NOT NULL,
  issuer           TEXT NOT NULL,
  audience_origin  TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  expires_at       TEXT NOT NULL,
  revoked_at       TEXT,
  revoked_reason   TEXT,
  rotated_from_id  TEXT REFERENCES api_credentials(credential_id),
  overlap_until    TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_credentials_expires_at
  ON api_credentials(expires_at);

CREATE INDEX IF NOT EXISTS idx_api_credentials_revoked_at
  ON api_credentials(revoked_at);

CREATE INDEX IF NOT EXISTS idx_api_credentials_rotated_from
  ON api_credentials(rotated_from_id);

CREATE TABLE IF NOT EXISTS google_sessions (
  token_digest_sha256  TEXT PRIMARY KEY CHECK (length(token_digest_sha256) = 64),
  principal_id         TEXT NOT NULL,
  issued_at            TEXT NOT NULL,
  expires_at           TEXT NOT NULL,
  session_cap_at       TEXT NOT NULL,
  revoked_at           TEXT,
  revoked_reason       TEXT
);

CREATE INDEX IF NOT EXISTS idx_google_sessions_principal
  ON google_sessions(principal_id);

CREATE INDEX IF NOT EXISTS idx_google_sessions_expires_at
  ON google_sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_audit_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at     TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  outcome         TEXT NOT NULL CHECK (outcome IN ('allowed', 'denied', 'error')),
  principal_type  TEXT CHECK (principal_type IS NULL OR principal_type IN ('google_sub', 'cli_token')),
  principal_id    TEXT,
  credential_id   TEXT,
  request_id      TEXT,
  detail_code     TEXT,
  metadata_json   TEXT
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_events_occurred_at
  ON auth_audit_events(occurred_at);

CREATE INDEX IF NOT EXISTS idx_auth_audit_events_credential_id
  ON auth_audit_events(credential_id);
