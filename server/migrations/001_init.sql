CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_number           text NOT NULL,          -- E.164
  sender_id           text NOT NULL,
  category            text NOT NULL DEFAULT 'transactional', -- promotional | transactional | service
  body                text NOT NULL,
  status              text NOT NULL DEFAULT 'queued', -- queued | sent | delivered | read | failed | blocked
  provider            text NOT NULL,
  provider_message_id text,
  error               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_provider_id_idx ON messages (provider_message_id);
CREATE INDEX IF NOT EXISTS messages_to_sender_idx ON messages (to_number, sender_id, created_at);

CREATE TABLE IF NOT EXISTS message_events (
  id          bigserial PRIMARY KEY,
  message_id  uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  status      text NOT NULL,
  payload     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS message_events_msg_idx ON message_events (message_id);
