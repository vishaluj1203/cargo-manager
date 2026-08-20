# Cargo Manager

Cargo Manager is Skyvalence’s email-native cargo operations desk. It ingests customer email, extracts operational facts with hosted open-weight AI, creates accountable tickets and sends threaded replies from those tickets.

The current implementation uses Next.js, hosted Supabase PostgreSQL/Auth/Storage, a durable local TypeScript worker, local Mailpit, Google Workspace Gmail OAuth, and provider adapters for Groq-hosted GPT-OSS 20B and Google-hosted Gemma.

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
pnpm acceptance:local
pnpm --filter @cargo/db verify:cloud
pnpm worker:once
```

`mail:smoke` tests real local SMTP, raw MIME parsing and reply threading without touching customer mail. `ai:smoke` sends a synthetic cargo email to the configured hosted open-weight model and validates strict structured output. `e2e:smoke` creates two temporary users/workspaces, proves tenant isolation, tests email-to-ticket-to-threaded-reply, idempotency, audit records, AI provenance and terminal retries, then removes its hosted test data and raw objects. `acceptance:local` runs every static, unit, build and end-to-end gate in order. `worker:once` requires the hosted Supabase server credentials and the configured AI-provider key.

The full local acceptance command last passed on 2026-08-20 with real Groq-hosted GPT-OSS 20B inference and local Mailpit. Supabase remains the owner-approved hosted data plane; passing this gate does not automatically authorize a cloud deployment.

See [the architecture and delivery plan](docs/architecture-plan.md), [the local demo runbook](docs/local-demo-runbook.md), [the GCP deployment runbook](docs/deployment-runbook.md) and [the cargo email location-code research](docs/research/cargo-email-location-codes.md).
