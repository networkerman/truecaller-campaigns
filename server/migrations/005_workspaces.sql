-- Workspaces and roles, modelled on Tarang. Every campaign, list, template, message, opt-out
-- and API key belongs to one workspace. People join by invitation only.
CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- owner: everything, including granting owner. admin: members and settings.
-- developer: templates, lists, campaigns, API keys. analyst: read only.
CREATE TABLE memberships (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'developer', 'analyst')),
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

-- Invited people get a temporary password and must choose their own at first sign-in.
ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN temp_password_expires_at timestamptz;

-- The workspace a dashboard session is working in.
ALTER TABLE sessions ADD COLUMN workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL;

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_workspace_idx ON audit_log (workspace_id, created_at DESC);

-- Everything made before workspaces goes into one "OneXtel" workspace, owned by the people who had accounts.
DO $$
DECLARE w uuid;
BEGIN
  INSERT INTO workspaces (name) VALUES ('OneXtel') RETURNING id INTO w;
  INSERT INTO memberships (workspace_id, user_id, role) SELECT w, id, 'owner' FROM users WHERE verified_at IS NOT NULL;

  ALTER TABLE templates ADD COLUMN workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
  ALTER TABLE contact_lists ADD COLUMN workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
  ALTER TABLE campaigns ADD COLUMN workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
  ALTER TABLE messages ADD COLUMN workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
  ALTER TABLE api_keys ADD COLUMN workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
  ALTER TABLE opt_outs ADD COLUMN workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
  UPDATE templates SET workspace_id = w;
  UPDATE contact_lists SET workspace_id = w;
  UPDATE campaigns SET workspace_id = w;
  UPDATE messages SET workspace_id = w;
  UPDATE api_keys SET workspace_id = w;
  UPDATE opt_outs SET workspace_id = w;
END $$;

ALTER TABLE templates ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE contact_lists ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE campaigns ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE messages ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE api_keys ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE opt_outs ALTER COLUMN workspace_id SET NOT NULL;

-- Names are unique within a workspace, not across all of them. Opt-outs are per workspace.
ALTER TABLE templates DROP CONSTRAINT templates_name_key;
ALTER TABLE templates ADD CONSTRAINT templates_workspace_name_key UNIQUE (workspace_id, name);
ALTER TABLE contact_lists DROP CONSTRAINT contact_lists_name_key;
ALTER TABLE contact_lists ADD CONSTRAINT contact_lists_workspace_name_key UNIQUE (workspace_id, name);
ALTER TABLE opt_outs DROP CONSTRAINT opt_outs_pkey;
ALTER TABLE opt_outs ADD PRIMARY KEY (workspace_id, phone);

CREATE INDEX templates_workspace_idx ON templates (workspace_id);
CREATE INDEX campaigns_workspace_idx ON campaigns (workspace_id, created_at DESC);
CREATE INDEX messages_workspace_idx ON messages (workspace_id, created_at);
CREATE INDEX api_keys_workspace_idx ON api_keys (workspace_id);
