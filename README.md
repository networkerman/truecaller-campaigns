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

## API (so far)

All `/v1` calls need an `x-api-key` header.

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
| POST / DELETE | `/v1/opt-outs`, `/v1/opt-outs/:phone` | Global opt-out list; opted-out numbers never get campaign messages |
| GET / POST | `/v1/campaigns` | List or create campaigns (`name`, `template_id`, `list_id`, optional `sender_id`, `launch`, `scheduled_at`) |
| GET / DELETE | `/v1/campaigns/:id` | Campaign with live counts, or delete a draft |
| POST | `/v1/campaigns/:id/launch`, `/v1/campaigns/:id/cancel` | Send now (or at `scheduled_at`), or stop |
| GET | `/v1/campaigns/:id/report`, `/v1/campaigns/:id/messages.csv` | Funnel, rates and failure reasons; per-message export |
| GET / POST | `/v1/api-keys`, `/v1/api-keys/:id/revoke` | Customer API keys (full key shown once on create) |
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
`TC_PROVIDER=truecaller` uses the real API in `server/src/providers/truecaller.ts`.

## Deploy

AWS setup (App Runner + RDS + CloudFront) lives in [`infra/`](infra/README.md).
