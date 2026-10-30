-- Rich messages: one media attachment and up to 3 buttons (link or quick reply) per template.
ALTER TABLE templates ADD COLUMN IF NOT EXISTS media jsonb;                       -- { url, mime_type, file_name? }
ALTER TABLE templates ADD COLUMN IF NOT EXISTS buttons jsonb NOT NULL DEFAULT '[]'; -- [{ type: link|reply, text, url? }]
-- What was sent with each message besides the text: { media, actions: [{ type, text, url?, tag }] }.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS extras jsonb;

-- Buttons are tracked like links: one row per button per message, found by its action tag.
-- kind: text (link in the message text), button (link button through our redirect),
-- button_direct (link button straight to its URL), reply (quick reply).
ALTER TABLE links ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'text';
ALTER TABLE links ADD COLUMN IF NOT EXISTS label text;

-- Files uploaded in the dashboard, served publicly at /m/<id>/<name> so Truecaller can fetch them.
CREATE TABLE IF NOT EXISTS media_files (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  file_name    text NOT NULL,
  mime_type    text NOT NULL,
  size         int NOT NULL,
  bytes        bytea NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_files_workspace_idx ON media_files (workspace_id, created_at DESC);
