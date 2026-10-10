CREATE TABLE IF NOT EXISTS templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  category    text NOT NULL,                 -- promotional | transactional | service
  body        text NOT NULL,
  variables   text[] NOT NULL DEFAULT '{}',  -- derived from {{placeholders}} in body
  status      text NOT NULL DEFAULT 'draft', -- draft | submitted | approved | rejected
  reject_reason text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES templates(id);
