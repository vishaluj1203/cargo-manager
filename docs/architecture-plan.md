# Cargo Manager architecture and delivery plan

Status: active source of truth

Last updated: 2026-08-20

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
| Web product        | Next.js App Router on GCP Cloud Run                              | One commercial-safe, scale-to-zero deployment account for the startup            |
| Authentication     | Hosted Supabase Auth                                             | Account lifecycle and secure SSR sessions without operating an identity platform |
| Transactional data | Hosted Supabase PostgreSQL                                       | Managed Postgres, row-level security and a usable free startup tier              |
| Raw email storage  | Private Supabase Storage bucket                                  | Keeps original MIME available for audit and reprocessing                         |
| Background work    | Local worker for acceptance; GCP Cloud Run worker for production | Email and AI work must not run inside short-lived web requests                   |
| Local email        | Mailpit                                                          | Real SMTP/MIME/thread testing without sending external mail                      |
| Production inbox   | Google Workspace Gmail API                                       | Per-user OAuth, scheduled polling, raw MIME ingestion and threaded mailbox reply |
| AI extraction      | Groq-hosted `openai/gpt-oss-20b` for local acceptance            | Compact open-weight MoE, strict JSON Schema output and no local model runtime    |
| Observability      | Structured GCP logs first; Sentry and PostHog next               | Useful deployment logs now, richer error and product analytics after the demo    |

Do not split frontend and backend into separate repositories now. Shared contracts, migrations and one atomic history are more valuable at this stage. The deployment boundary already exists at `apps/web` and `services/worker`.

## 3. Repository boundaries

```text
apps/web               Next.js authentication, onboarding and ticket UI
services/worker        Inbox discovery, event processing and reply delivery
packages/contracts     Shared Zod request, email and AI schemas
packages/db            Drizzle schema and PostgreSQL connection
packages/email         Mailpit provider, MIME parser and SMTP reply adapter
packages/ai            Provider-neutral cargo extractor with Groq and Google adapters
packages/security      AES-256-GCM server-side credential encryption
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
  ├────► Hosted open-weight AI with schema-constrained extraction
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

Two Cloud Run services provide the deployment boundary: a public, scale-to-zero Next.js service and a private, single-concurrency worker invoked by Cloud Scheduler. Supabase remains the shared data plane in local and hosted environments.

Production application compute is deployed in GCP London (`europe-west2`). The existing Supabase pooler resolves to AWS Ireland (`eu-west-1`), so it is EU-side but not UK-resident. That is acceptable for synthetic demo data; strict UK residency requires a new Supabase project in London (`eu-west-2`) and a controlled migration before onboarding customer data.

## 5. Tenant and security model

Every business row belongs to an `organization_id`. Membership is stored in `organization_members`.

- Supabase JWT claims establish user identity.
- PostgreSQL RLS checks organization membership.
- `create_workspace`, `change_ticket_status` and `queue_ticket_reply` are narrow database commands that recheck identity and membership.
- Raw MIME is private and stored below `<organization-id>/<provider>/<message>.eml`.
- Worker credentials are server-only.
- Gmail refresh tokens are encrypted with AES-256-GCM before storage; authenticated browser clients have no grants or RLS policies on `inbox_credentials`.
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
8. AI receives the latest message, bounded prior summary and bounded text attachments. During the company-inbox demo, Gmail discovery is additionally restricted to recent subjects containing `[Cargo Demo]`.
9. The provider is forced into schema-constrained output; Cargo Manager validates the result with Zod and retries one malformed model response.
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
- output: 2,000 tokens

Long conversations must be summarized incrementally; never resend an unlimited mailbox history. Local acceptance uses Groq-hosted GPT-OSS 20B with strict JSON Schema output; the Google Gemma forced-function adapter remains available. The fake extractor is test-only and returns declared fixtures; production environment selection rejects it. Free service tiers are restricted to synthetic demos; production requires an approved no-training service tier.

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
- Inbox: `inbox_connections`, `inbox_credentials`, `mailbox_cursors`
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

Exit evidence: 16 application tables, RLS on all 16, 20 policies, private raw bucket and migrations 0000–0005.

### Wave 1 — local product acceptance

Status: complete. The strengthened local acceptance gate passed on 2026-08-20 with real Groq inference, local Mailpit and isolated temporary records in hosted Supabase.

- Signup/sign-in and SSR session refresh
- Company onboarding and local inbox creation
- Cargo ticket queue and detail view
- MIME ingestion and raw storage
- Hosted open-weight structured extraction with Zod validation
- Ticket creation and customer-reply workflow
- Durable inbound and outbound retry queues
- Real Mailpit SMTP/API round trip
- One complete hosted-DB sample-email acceptance run

Acceptance evidence from `pnpm acceptance:local` on 2026-08-20:

- formatting, type-check, unit tests, lint and production build passed
- Mailpit SMTP, raw MIME parsing and RFC reply threading passed
- live `groq` / `openai/gpt-oss-20b` extraction returned nonzero token usage and schema-valid cargo facts
- two fresh authenticated users created separate workspaces; cross-tenant ticket reads, status mutation and raw-MIME download were denied
- exactly one inbound message created one ticket; rediscovery created no duplicate event or ticket
- final harness rerun ticket `CAR-000004` recorded container `TCLU1234567`, Singapore → Rotterdam, priority, action, deadline and confidence
- workflow history recorded `new` → `in_progress` → `waiting_on_customer`
- the reply was delivered to Mailpit with the original `Message-ID` in `In-Reply-To` and `References`
- audit events included `workspace.created`, `email.ingested`, `ticket.status_changed`, `ticket.reply_queued` and `email.sent`
- synthetic AI failure retried five times and reached `dead_letter`; synthetic SMTP failure became terminal after five attempts
- cleanup verification found zero temporary organizations, inbound events or raw objects for the acceptance marker

Exit criterion: a new user onboards, a sample email becomes a correctly parsed ticket, an operator replies, and Mailpit shows a correctly threaded customer reply.

### Wave 2 — CEO/client demo hardening

Status: ready to begin after the product owner accepts the local demo walkthrough.

- Friendly loading, error and empty states
- Demo seed/reset command scoped to the demo organization
- Sentry web and worker error reporting
- PostHog onboarding and ticket-funnel events
- Invitation flow for a second operator
- Manual AI correction capture
- Accessibility and responsive browser pass

Exit criterion: a repeatable 10-minute demo with no terminal intervention after startup.

### Wave 3 — first real inbox

Status: implementation complete for the polling demo; live OAuth acceptance is blocked on owner configuration.

- Per-user Google OAuth with offline access and CSRF-bound callback state
- Gmail readonly/send scopes and Workspace test-user strategy
- Scheduled recent-INBOX reconciliation with provider-message idempotency
- Raw Gmail MIME adapter
- Gmail send with provider thread ID plus RFC headers
- AES-256-GCM token encryption and disconnect/reconnect UX
- Future after demo: Gmail watch/Pub/Sub, history cursors and catch-up reconciliation

Exit criterion: a Skyvalence Workspace test inbox runs for 72 hours without duplicate or lost messages.

### Wave 4 — production deployment

Status: deployed to GCP London and connected to the Workspace Gmail inbox on 2026-08-16; end-to-end mailbox acceptance is waiting for a working hosted-AI credential.

- Cloud Run web container built from `apps/web`
- Private Cloud Run worker built from `services/worker`
- Cloud Scheduler or Pub/Sub wake-up path
- GCP Secret Manager server-only secrets
- `app.skyvalence.com` DNS and TLS
- Supabase production redirect URLs
- Health checks, alarms, backups and rollback runbook

Deployment evidence: the web and worker images built in Cloud Build, the web service returned a live login page, anonymous worker access returned 403, and the OIDC Cloud Scheduler invocation completed with zero processing failures. Current web URL: `https://cargo-manager-web-cjbvmtbt4a-nw.a.run.app`.

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

- Cloud Run request-based services with zero minimum instances: web UI and scheduled worker.
- Supabase free tier: Auth, PostgreSQL and small raw-email storage.
- Gemini API free tier with hosted Gemma for synthetic demos only; move to an approved paid/no-training tier before customer data.
- Cloud Run free allowance: worker only after local acceptance; scale to zero.
- Mailpit: local and CI integration testing only.

Vercel Hobby is not the production target because its current terms restrict Hobby to personal, non-commercial use. Vercel Pro remains a later option, but GCP Cloud Run is the lower-cost commercial-safe choice for this startup demo. Supabase avoids operating PostgreSQL/Auth ourselves.

Cost controls:

- bounded AI context and output
- no model call for duplicate provider events
- deterministic raw storage keys
- worker batch limits
- database indexes on queue and tenant filters
- service quotas and billing alerts before production

## 12. Current gate and required owner inputs

The automated local acceptance gate is complete. Supabase remains cloud-hosted by explicit owner decision; the web app, worker and Mailpit run locally for acceptance. No new cloud deployment was performed as part of this gate.

Before resuming hosted Gmail processing or changing the deployed services:

1. Complete the product-owner browser walkthrough using synthetic data.
2. Keep `GROQ_API_KEY` only in ignored local configuration and an approved secret store; never commit or paste it into chat.
3. Review and explicitly authorize the separate deployment plan; the local gate passing does not itself authorize cloud changes.

The previously shared Gemini API key must be rotated before customer or production use because it appeared in chat history.

## 13. Definition of done for the first demo

- A fresh account can create a cargo workspace.
- Tenant isolation is verified with a second account or automated RLS test.
- A realistic MIME email is stored privately.
- A real hosted open-weight model produces schema-valid cargo extraction through constrained structured output; no business-field regex parser is used.
- One ticket is created with references, route, priority, action, deadline and confidence.
- Reprocessing the same message creates no duplicate ticket or email.
- Operator workflow changes create history and audit records.
- Ticket reply is queued, sent and threaded to the original email.
- Failed AI, database and SMTP operations visibly retry or dead-letter.
- Build, type-check, lint, unit tests and full acceptance script pass.
- Architecture and runbook match the actual implementation.

Automated evidence for these items is recorded in Wave 1 above. The remaining product-owner browser walkthrough is a demo/usability approval, not a missing backend acceptance capability.

## 14. Evolution discipline

Every meaningful architecture change must update this document in the same pull request. Database changes require a new migration. Provider behavior requires contract tests. Significant decisions should record the date, decision, alternatives and reversal trigger below.

Decision log:

- 2026-08-16: one monorepo with separate web/worker deployment boundaries.
- 2026-08-16: hosted Supabase only; no local PostgreSQL runtime.
- 2026-08-16: local Mailpit acceptance before Gmail integration.
- 2026-08-16: hosted open-weight Gemma 4 through the Gemini API; forced function output, local Zod validation and no local model runtime. This supersedes the initial Together/Qwen choice.
- 2026-08-16: cargo location codes require structured route roles and deterministic reference validation; the current flat origin/destination contract is retained only until the proposed migration is implemented. Research and live-model evidence are recorded in [cargo email location-code research](research/cargo-email-location-codes.md).
- 2026-08-16: no cloud application deployment before the local end-to-end gate passes.
- 2026-08-16: local end-to-end acceptance passed again after the Gmail migration with a real hosted Gemma response and no fallback parser.
- 2026-08-16: deploy both Next.js and the private worker to GCP Cloud Run; do not use Vercel Hobby for this commercial client demo.
- 2026-08-16: deploy production compute in GCP London (`europe-west2`) for the initial UK-side rollout.
- 2026-08-16: use per-user Gmail OAuth with encrypted refresh tokens and scheduled polling for the demo; add push/history synchronization after the first live-inbox acceptance period.
- 2026-08-16: deployed the public web service and private scheduled worker to GCP London; hosted service, IAM and scheduler smoke checks passed.
- 2026-08-16: connected `info@skyvalence.com`, quarantined 18 historical messages after the AI provider rejected them for exhausted credits, paused polling, and restricted demo discovery to `[Cargo Demo]` subjects.
- 2026-08-20: select Groq-hosted `openai/gpt-oss-20b` with strict JSON Schema output for renewed local acceptance; retain Google Gemma as an optional fail-closed adapter. Local acceptance now requires a two-tenant end-to-end harness and explicit retry-terminal evidence.
- 2026-08-20: `pnpm acceptance:local` passed the complete two-tenant email-to-ticket-to-threaded-reply flow with real GPT-OSS 20B inference; cleanup left no temporary Supabase records or raw objects. Cloud deployment remains a separate, explicitly authorized phase.
