# Local demo runbook

This runbook proves the complete demo against hosted Supabase while all application processes and email remain local.

## Required configuration

Put values in ignored `.env.local`:

- Supabase URL and publishable key
- Supabase PostgreSQL transaction and direct URLs
- Supabase secret/service-role key
- Together AI API key
- local application and Mailpit defaults from `.env.example`

Never commit `.env.local`.

## Preflight

```bash
brew services start mailpit
pnpm install
pnpm db:push:dry-run
pnpm --filter @cargo/db verify:cloud
pnpm typecheck
pnpm test
pnpm build
```

## Start the product

Terminal one:

```bash
pnpm dev:web
```

Terminal two:

```bash
pnpm dev:worker
```

Open `http://localhost:3000`, create an account and complete workspace onboarding.

## Send a realistic customer email

Use any SMTP client configured for `127.0.0.1:1025`, with:

- From: a customer address
- To: `cargo@skyvalence.local`
- Subject: a realistic booking, status, documentation, delay or customs request
- Body: include a shipment reference, route, requested action and any deadline in natural language

Do not encode expected cargo fields in the worker. The email body must be interpreted by Qwen.

The worker should discover and process the message within a few seconds. Verify:

1. A ticket appears in `/tickets`.
2. AI fields reflect only evidence from the email.
3. Raw MIME exists in the private `cargo-email-raw` bucket.
4. `ai_runs`, `ticket_status_history` and `audit_events` contain records.
5. Running `pnpm worker:once` again creates no duplicate.

## Reply from the ticket

Open the ticket, enter a response and choose **Queue reply**. The worker should send it through Mailpit.

Open `http://localhost:8025` and verify the outbound message:

- recipient is the original customer
- subject is `Re: <original subject>`
- `In-Reply-To` is the customer message ID
- `References` includes the customer message ID
- ticket UI changes delivery from queued to sent
- an `email.sent` audit event exists

## Independent email adapter smoke test

```bash
pnpm mail:smoke
```

This creates a uniquely addressed sample email and verifies MIME parsing plus a real threaded SMTP reply. It does not create a Cargo Manager ticket.

## Common failures

- `service-role key required`: fill `SUPABASE_SERVICE_ROLE_KEY` with the Supabase server secret key.
- `AI_API_KEY is required`: create a Together API key and fill `AI_API_KEY`.
- Mailpit connection refused: run `brew services info mailpit`, then restart the service.
- Database connection error: copy both URLs from Supabase **Connect**, keeping the password URL-encoded.
- Ticket not visible: verify onboarding succeeded and RLS membership exists.
- Worker retries: inspect `inbound_events.last_error` or `outbox_jobs.last_error`; do not manually change status before understanding the cause.
