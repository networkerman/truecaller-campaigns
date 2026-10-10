CREATE TABLE IF NOT EXISTS contact_lists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  columns     text[] NOT NULL DEFAULT '{}', -- attribute columns seen in uploads, usable as template variables
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id     uuid NOT NULL REFERENCES contact_lists(id) ON DELETE CASCADE,
  phone       text NOT NULL, -- E.164
  attributes  jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (list_id, phone)
);

-- Global suppression list: nobody here gets campaign messages.
CREATE TABLE IF NOT EXISTS opt_outs (
  phone       text PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  template_id   uuid NOT NULL REFERENCES templates(id),
  list_id       uuid NOT NULL REFERENCES contact_lists(id),
  sender_id     text NOT NULL,
  status        text NOT NULL DEFAULT 'draft', -- draft | scheduled | running | completed | cancelled
  scheduled_at  timestamptz,
  started_at    timestamptz,
  completed_at  timestamptz,
  note          text, -- why a running campaign is waiting, e.g. daily sender limit
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaigns_status_idx ON campaigns (status, scheduled_at);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES campaigns(id);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL;
-- One message per contact per campaign, even if two workers race.
CREATE UNIQUE INDEX IF NOT EXISTS messages_campaign_contact_idx ON messages (campaign_id, contact_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_to_created_idx ON messages (to_number, created_at);

CREATE TABLE IF NOT EXISTS api_keys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  prefix        text NOT NULL,       -- first characters, shown in the dashboard
  key_hash      text NOT NULL UNIQUE, -- sha256 of the full key; the key itself is never stored
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
