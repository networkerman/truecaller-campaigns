-- Customer webhooks: each workspace can register callback URLs for message and campaign events.
CREATE TABLE webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  url text NOT NULL,
  description text NOT NULL DEFAULT '',
  secret text NOT NULL,
  events text[] NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_endpoints_workspace_idx ON webhook_endpoints (workspace_id);

-- One row per event per endpoint. The worker retries with backoff until it gets a 2xx.
CREATE TABLE webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  response_code int,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX webhook_deliveries_due_idx ON webhook_deliveries (next_attempt_at) WHERE status = 'pending';
CREATE INDEX webhook_deliveries_endpoint_idx ON webhook_deliveries (endpoint_id, created_at DESC);

-- Truecaller sender profiles. Onboarding is manual: OneXtel registers the sender with Truecaller,
-- then a super admin adds it here.
CREATE TABLE senders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sender_id text NOT NULL,
  display_name text NOT NULL,
  category text NOT NULL CHECK (category IN ('promotional', 'transactional', 'service')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, sender_id)
);

CREATE TABLE sender_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  display_name text NOT NULL,
  legal_name text NOT NULL,
  category text NOT NULL CHECK (category IN ('promotional', 'transactional', 'service')),
  website text NOT NULL DEFAULT '',
  use_case text NOT NULL,
  monthly_volume text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'in_review', 'approved', 'rejected')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sender_requests_workspace_idx ON sender_requests (workspace_id, created_at DESC);
