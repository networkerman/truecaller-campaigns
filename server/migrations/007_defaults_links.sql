-- Fallback values for template variables, used when a contact's column is empty.
-- Campaign defaults override the template's for that campaign only.
ALTER TABLE templates ADD COLUMN IF NOT EXISTS variable_defaults jsonb NOT NULL DEFAULT '{}';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS variable_defaults jsonb NOT NULL DEFAULT '{}';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS track_links boolean NOT NULL DEFAULT true;

-- Campaign links are rewritten to /r/<code> so clicks can be counted per message.
CREATE TABLE IF NOT EXISTS links (
  code             text PRIMARY KEY,
  message_id       uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  campaign_id      uuid REFERENCES campaigns(id) ON DELETE CASCADE,
  url              text NOT NULL,
  clicks           int NOT NULL DEFAULT 0,
  first_clicked_at timestamptz,
  last_clicked_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS links_message_idx ON links (message_id);
CREATE INDEX IF NOT EXISTS links_campaign_idx ON links (campaign_id);
