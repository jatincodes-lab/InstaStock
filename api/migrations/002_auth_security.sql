SET LOCAL search_path TO stockroom, public;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM users GROUP BY lower(btrim(email)) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot normalize duplicate user email addresses';
  END IF;
  IF EXISTS (
    SELECT 1 FROM invitations
    WHERE accepted_at IS NULL AND revoked_at IS NULL
    GROUP BY tenant_id, lower(btrim(email)) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Resolve duplicate pending invitations before migration';
  END IF;
END $$;

ALTER TABLE users ADD COLUMN email_normalized text;
UPDATE users SET email_normalized = lower(btrim(email));
ALTER TABLE users ALTER COLUMN email_normalized SET NOT NULL;
DROP INDEX users_email_normalized_uq;
CREATE UNIQUE INDEX users_email_normalized_uq ON users(email_normalized);

DELETE FROM role_permissions
 WHERE role_id = (SELECT id FROM roles WHERE key='administrator')
   AND permission_id = (SELECT id FROM permissions WHERE key='ownership.transfer');

ALTER TABLE sessions ADD COLUMN csrf_token_hash text;
ALTER TABLE sessions ADD COLUMN idle_expires_at timestamptz;
UPDATE sessions SET idle_expires_at = expires_at, revoked_at = coalesce(revoked_at, now());
ALTER TABLE sessions ALTER COLUMN idle_expires_at SET NOT NULL;

ALTER TABLE invitations ADD COLUMN email_normalized text;
UPDATE invitations SET email_normalized = lower(btrim(email));
ALTER TABLE invitations ALTER COLUMN email_normalized SET NOT NULL;
CREATE UNIQUE INDEX invitations_pending_email_uq
  ON invitations(tenant_id, email_normalized)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX invitations_tenant_created_idx ON invitations(tenant_id, created_at DESC);

CREATE TABLE invitation_branch_scopes (
  tenant_id uuid NOT NULL,
  invitation_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, invitation_id, branch_id),
  FOREIGN KEY (tenant_id, invitation_id) REFERENCES invitations(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);
CREATE TABLE invitation_warehouse_scopes (
  tenant_id uuid NOT NULL,
  invitation_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, invitation_id, warehouse_id),
  FOREIGN KEY (tenant_id, invitation_id) REFERENCES invitations(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses(tenant_id, id)
);

CREATE TABLE password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_user_pending_idx ON password_reset_tokens(user_id, expires_at DESC)
  WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE auth_rate_limits (
  bucket_hash text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX auth_rate_limits_expiry_idx ON auth_rate_limits(expires_at);

CREATE TABLE email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encrypted_payload bytea NOT NULL,
  payload_iv bytea NOT NULL,
  payload_tag bytea NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_outbox_ready_idx ON email_outbox(available_at, created_at)
  WHERE delivered_at IS NULL AND failed_at IS NULL;

CREATE TABLE security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  ip_hash text,
  request_id text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_events_user_time_idx ON security_events(user_id, occurred_at DESC);
CREATE INDEX security_events_time_idx ON security_events(occurred_at);
