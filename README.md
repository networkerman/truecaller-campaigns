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

## Dashboard

Sign in with an API key: the setup key in Secrets Manager (`API_KEYS` in the app secret) or one made on the API keys page.
The key stays in that browser; the dashboard build contains no key.

- **Templates**: write, preview and submit messages for approval.
- **Contact lists**: upload a CSV with a `phone` (or `mobile`, `number`, `msisdn`) column. Other columns become template variables, so a `First Name` column fills `{{first_name}}`. Re-uploading a number updates its columns.
- **Campaigns**: send an approved template to a list now or at a set time; pause, resume or cancel while it runs.
- **Reports**: sent, delivered, read and failed for each campaign.
- **API keys**: create and revoke keys. Keys are shown once and stored only as a hash.

## API

All `/v1` calls need an `x-api-key` header.

| Method | Path | What it does |
| --- | --- | --- |
| POST | `/v1/messages` | Send one message. Body: `to` plus either `body` or an approved `template_id` with `variables`; optional `sender_id`, `category` (`promotional`, `transactional`, `service`) |
| GET | `/v1/messages/:id` | Message status with its event history |
| GET / POST | `/v1/templates` | List or create templates (`name`, `category`, `body` with `{{variables}}`) |
| GET / PUT / DELETE | `/v1/templates/:id` | Read, edit (moves it back to draft) or delete (blocked once used) |
| POST | `/v1/templates/:id/submit` | Submit for approval (auto-approved in mock mode) |
| POST | `/v1/templates/:id/preview` | Render with `{ "values": {...} }` |
| GET / POST | `/v1/lists` | List or create contact lists (`name`) |
| GET / DELETE | `/v1/lists/:id` | Read or delete a list (blocked once a campaign uses it) |
| POST | `/v1/lists/:id/import` | Import a CSV, sent as the raw body with `content-type: text/csv` |
| GET | `/v1/lists/:id/contacts` | Contacts, with `limit` and `offset` |
| GET / POST | `/v1/campaigns` | List (with delivery counts) or create a draft (`name`, `template_id`, `list_id`, optional `sender_id`) |
| GET / PUT / DELETE | `/v1/campaigns/:id` | Read, or edit or delete a draft |
| POST | `/v1/campaigns/:id/launch` | Start now, or pass `scheduled_at` (ISO date-time) to schedule |
| POST | `/v1/campaigns/:id/pause`, `/resume`, `/unschedule`, `/cancel` | Control a scheduled or running campaign. Cancel drops messages not yet sent |
| GET / POST | `/v1/api-keys` | List keys or create one (`name`); the key is in the response only once |
| DELETE | `/v1/api-keys/:id` | Revoke a key |
| POST | `/webhooks/truecaller` | Delivery callbacks from Truecaller |
| GET | `/health` | Health check |

Statuses move forward only: `queued → sending → sent → delivered → read`, or end in `failed` / `blocked`.

Campaign messages are sent by a background worker in the API, `SEND_RATE_PER_SECOND` at a time (default 20). A contact with an empty value for a template variable is recorded as failed rather than sent half-filled.

## Providers

`TC_PROVIDER=mock` simulates the channel (delivered, then read; numbers ending in `0000` fail).
`TC_PROVIDER=truecaller` uses the real API in `server/src/providers/truecaller.ts`.

## Deploy

AWS setup (App Runner + RDS + CloudFront) lives in [`infra/`](infra/README.md).
