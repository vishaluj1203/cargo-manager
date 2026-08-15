# Cargo Manager architecture and delivery plan

Status: active source of truth

Last updated: 2026-08-16

Product owner: Skyvalence

Repository: `vishaluj1203/cargo-manager`

## 1. Product outcome

Cargo Manager turns operational cargo email into trackable work for freight forwarders, brokers and operators.

The minimum credible workflow is:

1. A company user creates an account and cargo workspace.
2. The company connects or forwards an operations inbox.
3. An inbound MIME email is stored and normalized.
4. An open-weight hosted model extracts cargo facts into a strict schema.
5. Cargo Manager creates or updates one threaded ticket.
6. An operator reviews the AI result, changes workflow status and replies from the ticket.
7. A durable outbox sends the email with RFC thread headers and records the outcome.
8. Every automated and human action is available in an audit trail.

This is an email-native operational system. It is not a replacement transport-management system in the first release.

## 2. Architecture decision

Use one TypeScript monorepo with independently deployable web and worker processes.

| Concern            | Choice                                                           | Why                                                                              |
| ------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Web product        | Next.js App Router on Vercel                                     | Fast UI iteration, server rendering and low-cost startup deployment              |
| Authentication     | Hosted Supabase Auth                                             | Account lifecycle and secure SSR sessions without operating an identity platform |
| Transactional data | Hosted Supabase PostgreSQL                                       | Managed Postgres, row-level security and a usable free startup tier              |
| Raw email storage  | Private Supabase Storage bucket                                  | Keeps original MIME available for audit and reprocessing                         |
| Background work    | Local worker for acceptance; GCP Cloud Run worker for production | Email and AI work must not run inside short-lived web requests                   |
| Local email        | Mailpit                                                          | Real SMTP/MIME/thread testing without sending external mail                      |
| Production inbox   | Google Workspace Gmail API                                       | OAuth, push notifications/history sync and replies from the connected mailbox    |
| AI extraction      | Together AI serverless, `Qwen/Qwen3.5-9B`                        | Lightweight open-weight model with hosted inference and structured JSON output   |
| Observability      | Sentry and PostHog in deployment wave                            | Errors, worker failures and product feedback without blocking the demo           |

Do not split frontend and backend into separate repositories now. Shared contracts, migrations and one atomic history are more valuable at this stage. The deployment boundary already exists at `apps/web` and `services/worker`.

## 3. Repository boundaries

```text
apps/web               Next.js authentication, onboarding and ticket UI
services/worker        Inbox discovery, event processing and reply delivery
packages/contracts     Shared Zod request, email and AI schemas
packages/db            Drizzle schema and PostgreSQL connection
packages/email         Mailpit provider, MIME parser and SMTP reply adapter
packages/ai            Provider-neutral cargo extractor and Together adapter
supabase/migrations    Immutable hosted database evolution
docs                   Architecture and operator runbooks
```

Rules:

- UI code never receives the database password, service-role key or AI key.
- Browser and web server data access uses the authenticated Supabase client and RLS.
- Worker access uses PostgreSQL and the Supabase secret/service-role key.
- Provider-specific Gmail and Mailpit behavior remains behind the same email interface.
- AI output is untrusted until it passes the shared Zod schema.

## 4. Runtime topology

```text
Customer mailbox
      │
      ▼
Gmail API / local Mailpit
      │ discover + fetch raw MIME
      ▼
Worker ─────► private raw-email bucket
  │
  ├────► Together AI / Qwen structured extraction
  │
  └────► Supabase PostgreSQL
             │
             ▼
       Next.js ticket UI
             │ queue reply transaction
             ▼
          outbox_jobs
             │ worker lease + retry
             ▼
       Gmail API / local SMTP
```

Vercel serves only the interactive web product. The worker is a long-running or scheduled process and will move to Cloud Run after local acceptance. Supabase remains the shared data plane in both environments.

## 5. Tenant and security model

Every business row belongs to an `organization_id`. Membership is stored in `organization_members`.

- Supabase JWT claims establish user identity.
- PostgreSQL RLS checks organization membership.
- `create_workspace`, `change_ticket_status` and `queue_ticket_reply` are narrow database commands that recheck identity and membership.
- Raw MIME is private and stored below `<organization-id>/<provider>/<message>.eml`.
- Worker credentials are server-only.
- Customer email and attachments are delimited as untrusted AI input; instructions inside them are never system instructions.
- Audit and AI-run records cannot be updated or deleted by ordinary authenticated users.

Before onboarding real client data, add retention controls, account deletion/export, a privacy policy, subprocessor disclosure and a data-processing agreement review.

## 6. Durable inbound flow

1. Worker lists connected inboxes.
2. Provider lists recent messages.
3. Recipient matching selects messages for that inbox.
4. `(organization, inbox, provider event ID)` uniqueness creates an idempotent `inbound_event`.
5. A worker atomically claims one event with a lease and `FOR UPDATE SKIP LOCKED`.
6. Provider returns raw MIME; `mailparser` normalizes headers, addresses, text, HTML and attachments.
7. Raw MIME is uploaded to the private bucket using a deterministic path.
8. AI receives the latest message, bounded prior summary and bounded text attachments.
9. Together enforces the cargo JSON Schema; Cargo Manager validates it again with Zod.
10. One database transaction creates the email, contact, AI run, thread, ticket link, status history and audit event.
11. Low-confidence extraction creates a `needs_verification` ticket. Otherwise the ticket starts as `new`.
12. Duplicate events return the existing ticket and make no duplicate records.

Failures retry with exponential delay. Leases older than ten minutes can be reclaimed. Inbound events stop after five attempts in `dead_letter`.

## 7. AI contract and context policy

AI extracts meaning; application regexes do not extract cargo fields.

Current output:

- category and priority
- concise summary
- customer and company
- AWB, bill of lading, booking, container and other references with evidence
- origin and destination
- requested action and deadline
- missing information
- overall confidence

Context is intentionally bounded:

- latest email: 24,000 characters
- prior thread summary: 4,000 characters
- each text attachment: 12,000 characters
- output: 1,500 tokens

Long conversations must be summarized incrementally; never resend an unlimited mailbox history. The production path always calls hosted Qwen. The fake extractor is test-only and returns declared fixtures; it does not pretend to parse an email.

## 8. Reply and threading flow

1. Operator submits a reply from a ticket.
2. `queue_ticket_reply` validates tenant membership and creates the outbound email, ticket link, outbox job, workflow history and audit event in one transaction.
3. Worker atomically leases one outbox job.
4. Provider sends the queued RFC `Message-ID`, `In-Reply-To` and `References` headers.
5. Success marks both job and email sent and records an audit event.
6. Failure records a safe error and retries with exponential delay, up to five attempts.

The database is the source of truth; sending is never performed directly by a browser or web request.

## 9. Core data model

The current schema includes:

- Identity: `profiles`, `organizations`, `organization_members`
- Inbox: `inbox_connections`, `mailbox_cursors`
- Durable intake: `inbound_events`
- Conversation: `email_threads`, `emails`
- Cargo work: `contacts`, `tickets`, `ticket_emails`, `ticket_status_history`
- Automation: `ai_runs`, `outbox_jobs`
- Accountability: `audit_events`

The schema evolves only through ordered SQL files in `supabase/migrations`. Never edit a migration after it has been applied to a shared environment; add the next numbered migration.

## 10. Delivery waves

### Wave 0 — foundation and data plane

Status: complete.

- Clean pnpm/Turborepo TypeScript monorepo
- Shared contracts and Drizzle schema
- Hosted Supabase connection
- PostgreSQL tables, RLS, policies, private bucket and command functions
- Live schema verification script

Exit evidence: 15 application tables, RLS on all 15, 20 policies, private raw bucket and migrations 0000–0004.

### Wave 1 — local product acceptance

Status: implementation substantially complete; real AI/storage secrets still required.

- Signup/sign-in and SSR session refresh
- Company onboarding and local inbox creation
- Cargo ticket queue and detail view
- MIME ingestion and raw storage
- Qwen structured extraction
- Ticket creation and customer-reply workflow
- Durable inbound and outbound retry queues
- Real Mailpit SMTP/API round trip
- One complete hosted-DB sample-email acceptance run

Exit criterion: a new user onboards, a sample email becomes a correctly parsed ticket, an operator replies, and Mailpit shows a correctly threaded customer reply.

### Wave 2 — CEO/client demo hardening

Status: pending Wave 1 acceptance.

- Friendly loading, error and empty states
- Demo seed/reset command scoped to the demo organization
- Sentry web and worker error reporting
- PostHog onboarding and ticket-funnel events
- Invitation flow for a second operator
- Manual AI correction capture
- Accessibility and responsive browser pass

Exit criterion: a repeatable 10-minute demo with no terminal intervention after startup.

### Wave 3 — first real inbox

Status: pending customer consent and Google Cloud configuration.

- Google OAuth verification strategy
- Domain-wide or per-user Gmail authorization decision
- Gmail watch/Pub/Sub endpoint
- Gmail history cursor and catch-up reconciliation
- Raw Gmail MIME adapter
- Gmail send with thread ID plus RFC headers
- Token encryption and disconnect/reconnect UX

Exit criterion: a Skyvalence Workspace test inbox runs for 72 hours without duplicate or lost messages.

### Wave 4 — production deployment

Status: no deployment before local acceptance.

- Vercel project for `apps/web`
- Cloud Run worker built from `services/worker`
- Cloud Scheduler or Pub/Sub wake-up path
- Vercel and GCP server-only secrets
- `app.skyvalence.com` DNS and TLS
- Supabase production redirect URLs
- Health checks, alarms, backups and rollback runbook

Exit criterion: production smoke test, monitored queues and documented rollback.

### Wave 5 — operational product depth

Status: future discovery.

- SLA timers and escalation rules
- Assignments, teams, mentions and internal notes
- Saved views, labels and custom workflows
- Shipment entity linking across multiple conversations
- Document OCR/vision extraction
- Customer portal and analytics
- Microsoft 365 inbox provider
- Usage billing and plan limits

## 11. Low-cost deployment plan

For the startup phase:

- Vercel free tier: web UI and server actions.
- Supabase free tier: Auth, PostgreSQL and small raw-email storage.
- Together pay-as-used serverless inference: no idle GPU cost.
- Cloud Run free allowance: worker only after local acceptance; scale to zero.
- Mailpit: local and CI integration testing only.

GCP is not the best place for everything at this stage. It is the right home for the background worker and Gmail Pub/Sub integration. Vercel remains the fastest web host, and Supabase avoids operating PostgreSQL/Auth ourselves.

Cost controls:

- bounded AI context and output
- no model call for duplicate provider events
- deterministic raw storage keys
- worker batch limits
- database indexes on queue and tenant filters
- service quotas and billing alerts before production

## 12. Current blockers and required owner inputs

The repository can compile and mocked flows can pass without secrets. A real acceptance run additionally requires:

1. `SUPABASE_SERVICE_ROLE_KEY`: Supabase secret/service-role key for private raw MIME upload.
2. `AI_API_KEY`: Together AI API key for the hosted Qwen call.

Keep both only in `.env.local` and later in the deployment secret stores. Never paste them into tickets, source files, screenshots or Git history.

Gmail integration will later require Google OAuth consent configuration and a selected Workspace test mailbox. It is intentionally not required for the local Mailpit acceptance gate.

## 13. Definition of done for the first demo

- A fresh account can create a cargo workspace.
- Tenant isolation is verified with a second account or automated RLS test.
- A realistic MIME email is stored privately.
- Qwen produces schema-valid cargo extraction; no business-field regex parser is used.
- One ticket is created with references, route, priority, action, deadline and confidence.
- Reprocessing the same message creates no duplicate ticket or email.
- Operator workflow changes create history and audit records.
- Ticket reply is queued, sent and threaded to the original email.
- Failed AI, database and SMTP operations visibly retry or dead-letter.
- Build, type-check, lint, unit tests and full acceptance script pass.
- Architecture and runbook match the actual implementation.

## 14. Evolution discipline

Every meaningful architecture change must update this document in the same pull request. Database changes require a new migration. Provider behavior requires contract tests. Significant decisions should record the date, decision, alternatives and reversal trigger below.

Decision log:

- 2026-08-16: one monorepo with separate web/worker deployment boundaries.
- 2026-08-16: hosted Supabase only; no local PostgreSQL runtime.
- 2026-08-16: local Mailpit acceptance before Gmail integration.
- 2026-08-16: hosted open-weight Qwen through a provider-neutral adapter; no local model runtime.
- 2026-08-16: no cloud application deployment before the local end-to-end gate passes.
