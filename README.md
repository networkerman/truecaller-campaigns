# Truecaller Campaigns

Standalone platform for running Truecaller Business Messaging campaigns: list upload, campaign runs, delivery tracking and customer-facing APIs.

## Run locally

```bash
cd server
cp .env.example .env      # TC_PROVIDER=mock works without Truecaller credentials
npm install
npm run migrate
npm run dev
```

Dashboard (separate terminal):

```bash
cd web
npm install
npm run dev               # http://localhost:5173, proxies /v1 to the server
```

## Workspaces, roles and sign-in

Everything (campaigns, contact lists, templates, messages, opt-outs, API keys) belongs to a
**workspace**. There is no public signup: people join by invitation.

- **Super admins** are the emails in `SUPER_ADMIN_EMAILS` (OneXtel). They create customer
  workspaces, see all of them under *All workspaces*, and can open any workspace for support.
  Opening a workspace you're not a member of is recorded in its audit log. At startup each super
  admin without an account gets one, as Owner of the first workspace, with an invitation emailed.
- **New workspace**: a super admin enters a workspace name and the customer's name and email.
  That person becomes the workspace's **Owner** and can invite their own team.
- **Invite into a workspace**: Owners and Admins invite people with a role from the Team page.

| Role | Can |
| --- | --- |
| Owner | Everything, including making or changing Owners. A workspace always keeps one. |
| Admin | Everything except managing Owners. |
| Developer | Templates, contact lists, campaigns, sends and API keys. |
| Analyst | Read only: campaigns, templates, lists and reports. |

Invitations email a temporary password that works for 7 days. The first sign-in asks for a new
password before anything else; *Resend* on the Team page issues a fresh one. Someone who already
has an account is just added to the workspace. Sessions are an httpOnly cookie that lasts 14 days.

API keys belong to the workspace they were made in and can use templates, lists, campaigns and
sends there, but not the team or other keys. Setup keys in `API_KEYS` act in the first workspace.

Invitation emails go through Tarang's `invite` template when `TARANG_API_KEY` is set, else
through `SMTP_URL`, from `MAIL_FROM`. With neither, the invitation (temporary password included)
is written to the API log: `docker compose logs api | grep invitation`.

## API (so far)

All `/v1` calls need an `x-api-key` header (the dashboard uses its sign-in cookie instead).

| Method | Path | What it does |
| --- | --- | --- |
| POST | `/v1/messages` | Send one message. Body: `to` plus either `body` or an approved `template_id` with `variables`; optional `sender_id`, `category` (`promotional`, `transactional`, `service`) |
| GET | `/v1/messages/:id` | Message status with its event history |
| GET / POST | `/v1/templates` | List or create templates (`name`, `category`, `body` with `{{variables}}`) |
| GET / PUT / DELETE | `/v1/templates/:id` | Read, edit (moves it back to draft) or delete (blocked once used) |
| POST | `/v1/templates/:id/submit` | Submit for approval (auto-approved in mock mode) |
| POST | `/v1/templates/:id/preview` | Render with `{ "values": {...} }` |
| GET / POST | `/v1/lists` | List or create contact lists |
| GET / DELETE | `/v1/lists/:id` | List details with a contact sample, or delete it (blocked once a campaign uses it) |
| POST | `/v1/lists/:id/contacts` | Upload contacts: raw CSV body with `Content-Type: text/csv`. Needs a phone column; other columns become `{{variables}}` |
| POST / DELETE | `/v1/opt-outs`, `/v1/opt-outs/:phone` | The workspace's opt-out list; opted-out numbers never get its campaign messages |
| GET / POST | `/v1/campaigns` | List or create campaigns (`name`, `template_id`, `list_id`, optional `sender_id`, `launch`, `scheduled_at`) |
| GET / DELETE | `/v1/campaigns/:id` | Campaign with live counts, or delete a draft |
| POST | `/v1/campaigns/:id/launch`, `/v1/campaigns/:id/cancel` | Send now (or at `scheduled_at`), or stop |
| GET | `/v1/campaigns/:id/report`, `/v1/campaigns/:id/messages.csv` | Funnel, rates and failure reasons; per-message export |
| GET / POST | `/v1/api-keys`, `/v1/api-keys/:id/revoke` | Customer API keys (full key shown once on create) |
| POST | `/v1/auth/login`, `/v1/auth/logout`, `/v1/auth/password` | Dashboard sign-in and password change |
| GET / POST | `/v1/auth/me`, `/v1/auth/workspace` | Who is signed in, their workspaces and permissions; switch workspace |
| GET / POST | `/v1/team`, `/v1/team/invitations` | Workspace members; invite someone with a role (dashboard only) |
| PATCH / DELETE | `/v1/team/members/:userId` | Change a role or remove someone; `POST …/resend` for a new temporary password |
| GET | `/v1/audit` | The workspace's audit log |
| GET / POST | `/v1/admin/workspaces` | Super admins: all workspaces; create one with its Owner |
| POST | `/webhooks/truecaller` | Delivery callbacks from Truecaller |
| GET | `/health` | Health check |

Statuses move forward only: `queued → sent → delivered → read`, or end in `failed` / `blocked`.

## Campaign guardrails

Applied per contact when a campaign sends, based on Truecaller's promo sender rules:

- Opted-out numbers are always skipped.
- Promotional templates only: max 4 messages per sender to the same number in 28 days, max 3 promo messages per number per day (IST), and a daily cap per sender (`PROMO_DAILY_SENDER_LIMIT`, default 500,000 for Tier 1). When the daily cap is hit the campaign waits and resumes the next day.

Skipped and failed contacts show up in the campaign report with the reason.

## Providers

`TC_PROVIDER=mock` simulates the channel (delivered, then read; numbers ending in `0000` fail).
`TC_PROVIDER=truecaller` sends through Truecaller's Business Chat API v2 (gRPC service
`truecaller.messenger.business.v2.BusinessApi`, method `BusinessSendMessage`) in
`server/src/providers/truecaller.ts`. Each send uses our message id as `deduplication_id`, so a
retry is never delivered twice. Delivery and read updates arrive on `POST /webhooks/truecaller`
(v2 has no streaming subscription).

The v2 `.proto` files come from Truecaller's partner portal and are not in this repo. Locally put
them in `server/proto/`; on the box copy them to `/opt/truecaller-proto/`, which is mounted into
the containers. Set `TC_API_BASE_URL` (gRPC host:port) and `TC_API_KEY`, then `TC_PROVIDER=truecaller`.

## Deploy

Runs on one EC2 box (t3.small, ap-south-1) with Docker Compose: Postgres, the API, the
always-on campaign worker, and Caddy serving the dashboard with automatic HTTPS. See [`deploy/`](deploy/).

```bash
SSH_KEY=~/.ssh/truecaller-campaigns.pem ./deploy/push.sh ubuntu@13.232.158.14
```

`push.sh` rsyncs the checkout and runs `docker compose up -d --build`. Secrets live on the box in
`/etc/truecaller-campaigns.env` (root, 0600), created once by `deploy/setup-env.sh`, outside the
rsync target. The database is the `pgdata` Docker volume.
