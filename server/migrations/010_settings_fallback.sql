-- Workspace settings: send window, frequency cap, message defaults and fallback channels.
-- One JSON document per workspace; the OnexAura API key inside it is never sent back to the browser.
CREATE TABLE IF NOT EXISTS workspace_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  settings     jsonb NOT NULL DEFAULT '{}',
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- SMS fallback templates. OnexAura has no SMS template fetch, so customers add their DLT templates here.
CREATE TABLE IF NOT EXISTS sms_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name            text NOT NULL,
  dlt_template_id text NOT NULL,
  body            text NOT NULL,           -- DLT-approved text with {{variable}} placeholders
  variables       text[] NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);

-- Campaign fallback chain: [{ channel: rcs | whatsapp | sms, template, language?, params: { key: column or "=static" } }].
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS fallback jsonb NOT NULL DEFAULT '[]';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS ttl_seconds int;

-- When a sent message counts as expired if Truecaller has not reported it delivered.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS expires_at timestamptz;
CREATE INDEX IF NOT EXISTS messages_expiry_idx ON messages (expires_at) WHERE status = 'sent';

-- One row per fallback try. Step 0 is the first fallback channel; a failed step queues the next one.
CREATE TABLE IF NOT EXISTS fallback_attempts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id          uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  campaign_id         uuid REFERENCES campaigns(id) ON DELETE CASCADE,
  step                int NOT NULL,
  channel             text NOT NULL,       -- rcs | whatsapp | sms
  status              text NOT NULL DEFAULT 'queued', -- queued | submitted | delivered | read | failed
  provider_message_id text,
  error               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, step)
);
CREATE INDEX IF NOT EXISTS fallback_queue_idx ON fallback_attempts (created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS fallback_provider_idx ON fallback_attempts (provider_message_id);
CREATE INDEX IF NOT EXISTS fallback_campaign_idx ON fallback_attempts (campaign_id);

-- Replies from Truecaller users, including quick-reply taps.
CREATE TABLE IF NOT EXISTS incoming_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  message_id       uuid REFERENCES messages(id) ON DELETE SET NULL, -- the message it replies to, if known
  campaign_id      uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  provider_id      text,                   -- Truecaller's id for the inbound message
  from_number      text NOT NULL,
  text             text,
  action_tag       text,
  media            jsonb,
  received_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id)
);
CREATE INDEX IF NOT EXISTS incoming_campaign_idx ON incoming_messages (campaign_id, received_at DESC);

-- Customer webhooks now subscribe to three event types instead of individual statuses.
UPDATE webhook_endpoints SET events = (
  SELECT coalesce(array_agg(DISTINCT e), '{delivery}') FROM (
    SELECT CASE WHEN x LIKE 'message.%' THEN 'delivery' ELSE NULL END AS e FROM unnest(events) AS x
  ) m WHERE e IS NOT NULL
);

-- Truecaller tiers are 0 to 4 (India: 10k, 500k, 2.5M, 10M per day, unlimited).
UPDATE senders SET tier = LEAST(GREATEST(tier, 0), 4);
UPDATE senders SET tier = 4 WHERE category <> 'promotional' AND daily_limit IS NULL;
