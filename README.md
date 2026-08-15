# Cargo Manager

Cargo Manager is Skyvalence’s email-native cargo operations desk. It ingests customer email, extracts operational facts with hosted open-weight AI, creates accountable tickets and sends threaded replies from those tickets.

The current implementation uses Next.js, hosted Supabase PostgreSQL/Auth/Storage, a durable TypeScript worker, local Mailpit and Google-hosted open-weight Gemma 4.

## Start locally

Prerequisites: Node 20+, pnpm 11 and Mailpit.

1. Copy `.env.example` to ignored `.env.local` and fill the required values.
2. Start Mailpit: `brew services start mailpit`.
3. Install dependencies: `pnpm install`.
4. Apply hosted migrations: `pnpm db:push:dry-run`, then `pnpm db:push`.
5. Start the web app: `pnpm dev:web`.
6. Start the worker in another terminal: `pnpm dev:worker`.

Open `http://localhost:3000`. Mailpit is available at `http://localhost:8025`.

## Verification commands

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm mail:smoke
pnpm ai:smoke
pnpm e2e:smoke
pnpm --filter @cargo/db verify:cloud
pnpm worker:once
```

`mail:smoke` tests real local SMTP, raw MIME parsing and reply threading without touching customer mail. `ai:smoke` sends a synthetic cargo email directly to hosted Gemma and validates its function-call output. `e2e:smoke` creates an isolated temporary user/workspace, tests the whole email-to-ticket-to-reply path and removes its cloud test data. `worker:once` requires the Supabase secret/service-role key and Google AI key.

See [the architecture and delivery plan](docs/architecture-plan.md) and [the local demo runbook](docs/local-demo-runbook.md).
