-- Sender onboarding: requests get a short reference (SR-1001), a sample message, and are linked
-- to the sender created from them. Senders carry the Truecaller tier and daily promotional limit.
CREATE SEQUENCE IF NOT EXISTS sender_request_ref START 1001;
ALTER TABLE sender_requests ADD COLUMN IF NOT EXISTS ref int NOT NULL DEFAULT nextval('sender_request_ref');
ALTER TABLE sender_requests ADD COLUMN IF NOT EXISTS sample_message text NOT NULL DEFAULT '';
ALTER TABLE sender_requests ADD COLUMN IF NOT EXISTS contact_email text NOT NULL DEFAULT '';
ALTER TABLE sender_requests ADD COLUMN IF NOT EXISTS sender_id uuid REFERENCES senders(id) ON DELETE SET NULL;

ALTER TABLE senders ADD COLUMN IF NOT EXISTS tier int NOT NULL DEFAULT 1;
ALTER TABLE senders ADD COLUMN IF NOT EXISTS daily_limit int; -- promotional messages per day; NULL uses the platform default
ALTER TABLE senders ADD COLUMN IF NOT EXISTS request_id uuid REFERENCES sender_requests(id) ON DELETE SET NULL;
