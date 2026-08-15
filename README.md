# Cargo Manager

Cargo Manager is an evolving, email-first ticketing system for cargo operations. It turns customer emails into trackable tickets, keeps the full conversation and audit history, and will send agent replies back through the original email thread.

## Current foundation

- Next.js + TypeScript app deployable to Vercel.
- PostgreSQL schema for contacts, tickets, messages, inbound events, and audit events.
- Validated inbound email webhook at `POST /api/inbound/email`.
- First ticket creation transaction with deduplication key storage and ticket numbering.
- Responsive ticket-list UI direction for the operations desk.
- Local PostgreSQL Docker setup and Supabase-compatible migration.

## Run locally

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:migrate
pnpm dev
```

Send a test email payload:

```bash
curl -X POST http://localhost:3000/api/inbound/email \
  -H 'Authorization: Bearer change-me' -H 'Content-Type: application/json' \
  -d '{"messageId":"demo-1","from":"ops@example.com","to":"support@example.com","subject":"Container delay","text":"Please help with our delayed container."}'
```

## Product and engineering record

Read [docs/architecture.md](docs/architecture.md) for boundaries, flows, security, and a staged roadmap. Every material decision belongs in [docs/decisions](docs/decisions), and shipped changes should be recorded in [CHANGELOG.md](CHANGELOG.md).

## Deployment

1. Create a Supabase project and copy its pooled PostgreSQL connection string to `DATABASE_URL`.
2. Run `pnpm db:migrate` against that database from a trusted environment.
3. Import this repository into Vercel and configure `DATABASE_URL`, `APP_URL`, `INBOUND_WEBHOOK_SECRET`, `EMAIL_PROVIDER`, and `EMAIL_FROM`.
4. Configure the inbound email provider to POST its normalized payload to `/api/inbound/email`.

Production email sending is deliberately an adapter boundary; select and configure a provider (for example Postmark, Resend, SES, or SendGrid) before enabling outbound replies.
