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
| POST | `/webhooks/truecaller` | Delivery callbacks from Truecaller |
| GET | `/health` | Health check |

Statuses move forward only: `queued → sent → delivered → read`, or end in `failed` / `blocked`.

## Providers

`TC_PROVIDER=mock` simulates the channel (delivered, then read; numbers ending in `0000` fail).
`TC_PROVIDER=truecaller` uses the real API in `server/src/providers/truecaller.ts`.
