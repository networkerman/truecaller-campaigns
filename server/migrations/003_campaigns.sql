CREATE TABLE IF NOT EXISTS contact_lists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  columns     text[] NOT NULL DEFAULT '{}',  -- non-phone CSV columns, usable as template variables
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id     uuid NOT NULL REFERENCES contact_lists(id) ON DELETE CASCADE,
  phone       text NOT NULL,                 -- E.164
  attrs       jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (list_id, phone)
);

CREATE TABLE IF NOT EXISTS campaigns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  template_id   uuid NOT NULL REFERENCES templates(id),
  list_id       uuid NOT NULL REFERENCES contact_lists(id),
  sender_id     text NOT NULL,
  status        text NOT NULL DEFAULT 'draft', -- draft | scheduled | running | paused | completed | cancelled
  scheduled_at  timestamptz,
  started_at    timestamptz,
  completed_at  timestamptz,
  total         integer NOT NULL DEFAULT 0,    -- recipients when the campaign started
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaigns_due_idx ON campaigns (status, scheduled_at);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES campaigns(id);
CREATE INDEX IF NOT EXISTS messages_campaign_idx ON messages (campaign_id, status);

CREATE TABLE IF NOT EXISTS api_keys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  prefix        text NOT NULL,                 -- first characters, shown so keys can be told apart
  key_hash      text NOT NULL UNIQUE,          -- sha256 of the full key; the key itself is never stored
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
