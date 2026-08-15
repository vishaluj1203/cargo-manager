# Cargo Manager — architecture and execution plan

## Document status

This is the sole source of truth for the Cargo Manager product and implementation.

- Company: Skyvalence
- Working product name: Cargo Manager
- Repository: cargo-manager
- Architecture reset date: 2026-08-16
- Current repository state: implementation intentionally deleted; greenfield rebuild
- Immediate deadline: a working CEO demonstration in two days
- First mailbox: info@skyvalence.com
- First application URL: cargo.skyvalence.com

The previous implementation and its assumptions are historical only. Earlier code remains recoverable from Git history but must not be copied into the new implementation without a deliberate review.

## Executive decisions

1. Use one monorepo, not separate frontend and backend repositories.
2. Do not use microfrontends. There is one coherent operator application.
3. Create three independently deployable units in the monorepo:
   - Web application and backend-for-frontend
   - Email and workflow worker
   - Open-source AI inference service
4. Deploy all compute to a dedicated Google Cloud project using Cloud Run.
5. Use Supabase PostgreSQL, Auth, and Storage initially.
6. Integrate the first mailbox directly through Google Workspace and Gmail API.
7. Use Gmail API for outbound replies so messages come from the connected mailbox and remain in the Gmail thread.
8. Use Pub/Sub and a transactional database outbox for asynchronous work.
9. Use Qwen2.5 1.5B Instruct as the first lightweight open-source semantic model.
10. Use PostHog for product analytics and Sentry for errors and traces, with strict PII filtering.
11. Use Jira for execution tracking. Jira is not part of the Cargo Manager runtime.
12. Keep Vercel available as a future frontend option, but do not depend on it for the first deployment.

## Why one repository

Parallel Codex execution does not require separate repositories. Separate repositories would add API versioning, duplicated configuration, cross-repository pull requests, coordinated releases, and contract drift before those costs are justified.

The monorepo gives us:

- One database schema and migration history
- Shared TypeScript contracts
- Atomic changes across UI, worker, and domain logic
- One CI policy and one security baseline
- Independent Cloud Run deployments using path filters
- Parallel work through Git branches or worktrees
- A clear place to record architecture evolution

Split repositories only when at least one of these becomes true:

- Independent teams own and release services separately.
- External consumers require a stable public API lifecycle.
- Security or compliance requires repository separation.
- A service has an independent product lifecycle.
- Monorepo build or access boundaries become materially harmful.

## Product objective

Cargo Manager is an email-first cargo operations workspace for freight forwarders, brokers, and operators. It turns operational email into structured, trackable work while keeping the human operator in control.

The core relationship is:

    Email         communication evidence
    Ticket        work requiring action
    Shipment      durable cargo context
    Task          a specific responsibility
    Milestone     a planned or actual cargo event
    Document      operational or commercial evidence
    Audit event   the record of every system and human action

Cargo Manager is not initially a TMS, customs filing engine, accounting system, warehouse system, or autonomous cargo decision-maker.

## Two-day demonstration contract

The demonstration is complete only when this real external flow succeeds:

    Personal sender
      → sends cargo email to the Skyvalence cargo alias
      → Gmail receives the email
      → Gmail notifies Cargo Manager through Pub/Sub
      → Cargo Manager retrieves and stores the original message
      → Qwen extracts cargo facts and intent
      → a ticket is created
      → the ticket appears in the operations UI
      → the operator opens the conversation
      → the operator sends a reply
      → Gmail sends from the Skyvalence mailbox
      → the personal sender receives the reply
      → the outbound message appears in the ticket timeline

A second customer reply should attach to the same ticket if time permits. It is a required gate before a customer pilot, but not allowed to endanger the primary CEO demonstration.

## Scope for the first demonstration

Included:

- One Skyvalence organization
- One authenticated operator
- One connected Google Workspace mailbox
- One cargo-specific Gmail alias or label
- Plain-text and HTML email ingestion
- AI classification and structured extraction
- Ticket list
- Ticket detail and conversation
- Human-authored outbound reply
- Basic delivery state and audit timeline
- One seeded backup demonstration
- Sentry error reporting
- Essential PostHog funnel events

Excluded from the two-day build:

- Microsoft 365
- Customer self-onboarding
- Public Google OAuth verification
- Multi-customer billing
- Full attachment OCR
- Carrier and TMS integrations
- SLA automation
- Ticket merge and split
- Advanced search
- Autonomous AI replies
- Mobile applications
- Customs automation
- Production compliance certification

## Existing assets

The design assumes access to:

- Google Cloud account associated with the founder
- Google Workspace for skyvalence.com
- Mailbox info@skyvalence.com
- skyvalence.com DNS
- Supabase
- Vercel
- PostHog
- Sentry
- Jira
- GitHub repository
- Codex subscription

No personal passwords, recovery codes, private keys, API keys, or OAuth secrets may be committed to Git or pasted into documentation.

## Environment and account layout

Create a dedicated Google Cloud project for the demo and pilot. Do not deploy into an unrelated existing project.

Suggested names:

    Organization or billing owner     Skyvalence
    GCP project display name          Skyvalence Cargo Demo
    GCP project ID                    skyvalence-cargo-demo plus a unique suffix
    Default region                    choose near the pilot users and Supabase region
    Artifact Registry                 cargo
    Cloud Run web                     cargo-web
    Cloud Run worker                  cargo-worker
    Cloud Run AI                      cargo-ai
    Pub/Sub Gmail topic               gmail-mailbox-events
    Pub/Sub processing topic          cargo-email-processing
    Pub/Sub dead-letter topic         cargo-email-dead-letter
    Scheduler job                     renew-gmail-watch
    Supabase project                  cargo-manager-demo
    Sentry project                    cargo-manager
    PostHog project                   Cargo Manager
    Jira project key                  CARGO

Environment separation:

    local       local application, local PostgreSQL, local Ollama
    demo        GCP demo project and Supabase Free
    pilot       dedicated pilot configuration with production backups
    production  separate GCP and Supabase projects after pilot acceptance

Development and production OAuth clients must be separate.

## Domain plan

Do not change the existing skyvalence.com landing page.

Use:

    Marketing site         skyvalence.com
    Application            cargo.skyvalence.com
    Status page later      status.skyvalence.com
    Privacy policy         skyvalence.com/privacy
    Terms                  skyvalence.com/terms
    Product support        info@skyvalence.com initially

For the demo, create a no-cost Workspace alias such as cargo@skyvalence.com on the existing info@skyvalence.com user. Create a Gmail filter that applies a dedicated CargoManager label to mail sent to the alias. Cargo Manager watches only that label.

This avoids ingesting unrelated messages arriving at info@skyvalence.com.

The alias must also be configured as an allowed Gmail send-as identity if replies should visibly come from cargo@skyvalence.com. If this cannot be completed in time, replies may come from info@skyvalence.com for the CEO demonstration.

## Target architecture

    Browser
      │
      ▼
    cargo-web on Cloud Run
      │
      ├── Supabase Auth session
      ├── ticket queries and mutations
      ├── reply drafts
      └── signed internal commands
              │
              ▼
    Supabase PostgreSQL and Storage
      ▲                 │
      │                 ├── inbound event ledger
      │                 ├── ticket and email records
      │                 ├── transactional outbox
      │                 └── raw MIME and attachments
      │
    cargo-worker on Cloud Run
      ▲           │
      │           ├── Gmail history synchronization
      │           ├── MIME normalization
      │           ├── AI orchestration
      │           ├── ticket creation and threading
      │           ├── outbox delivery through Gmail
      │           └── retries and dead-letter handling
      │
    Cloud Pub/Sub
      ▲
      │
    Gmail API watch
      ▲
      │
    Google Workspace mailbox

    cargo-worker
      │
      ▼
    cargo-ai on Cloud Run
      │
      ▼
    Qwen2.5 1.5B Instruct, quantized

## Repository layout

    apps/
      web/                  Next.js operator UI and backend-for-frontend
      worker/               Gmail sync, AI orchestration, outbox and jobs

    services/
      ai/                   OpenAI-compatible Qwen inference service

    packages/
      contracts/            Zod schemas and shared API contracts
      db/                   Drizzle schema, migrations and repositories
      domain/               cargo, email, ticket and shipment rules
      gmail/                Gmail adapter and MIME handling
      ai/                   prompts, extraction schemas and evaluation
      auth/                 tenant context and authorization
      observability/        structured logging, Sentry and PostHog helpers
      testkit/              factories, fixtures and integration harness

    docs/
      architecture-plan.md  this source of truth
      decisions/            future architecture decision records
      runbooks/             deployment, mailbox, incidents and recovery
      evaluations/          anonymized AI evaluation reports

    infra/
      gcp/                  reproducible GCP configuration
      supabase/             database and storage configuration

    .github/
      workflows/            tests, builds, security and deployments

## Technology choices

- TypeScript for web, worker, contracts, domain and infrastructure scripts
- Next.js for the operations application
- PostgreSQL through Supabase
- Drizzle ORM with SQL migrations
- Supabase Auth with Google sign-in
- Supabase Storage for raw messages and attachments
- Google Gmail API for mailbox read, watch, labels, threads and send
- Google Pub/Sub for Gmail notifications and processing events
- Google Cloud Scheduler to renew Gmail watches and run reconciliation
- Cloud Run for web, worker and AI
- Qwen2.5 1.5B Instruct in a quantized format
- llama.cpp or another small OpenAI-compatible runtime
- Zod for boundary validation
- Vitest for unit and contract tests
- Playwright for the critical browser journey
- OpenTelemetry-compatible structured traces
- Sentry for failures and performance
- PostHog for privacy-safe product analytics

## Gmail integration design

### Demo mailbox setup

1. Create cargo@skyvalence.com as an alias of info@skyvalence.com.
2. Create a Gmail user label named CargoManager.
3. Create a Gmail filter that applies the label to messages addressed to the alias.
4. Configure the alias as a send-as address if desired.
5. Create an OAuth application in the dedicated GCP project.
6. Configure it as Internal when the GCP project belongs to the Skyvalence Workspace organization.
7. Authorize only the required Gmail scopes.
8. Store the encrypted refresh token in Secret Manager or an encrypted integration record.
9. Start a Gmail watch filtered to the CargoManager label.
10. Renew the watch daily; Gmail requires renewal at least every seven days.

### Inbound sequence

1. Gmail publishes a mailbox history notification to Pub/Sub.
2. Pub/Sub sends an authenticated push request to cargo-worker.
3. The worker validates the push identity and stores an immutable inbound event.
4. The worker acknowledges quickly.
5. A processing job calls Gmail history.list from the last committed history ID.
6. For every added message with the CargoManager label, the worker retrieves the full message.
7. MIME libraries decode transport structure, body parts, headers and attachments.
8. The raw message and normalized representation are stored before AI runs.
9. Tenant, mailbox and Gmail message ID form the idempotency boundary.
10. The worker sends normalized content to cargo-ai.
11. Validated AI output creates or updates the ticket and audit timeline.
12. The history cursor advances only after durable processing.

Pub/Sub notifications are signals, not the source of truth. Gmail history and the stored cursor are the recovery mechanism. A periodic reconciliation job handles delayed or dropped notifications.

### Outbound sequence

1. An authenticated operator creates a reply draft.
2. The web application validates tenant, ticket and permission.
3. A database transaction writes the outbound message and outbox record.
4. The worker claims the outbox record using a lease.
5. The worker creates an RFC 5322 message.
6. It preserves subject, recipients, Message-ID, In-Reply-To and References.
7. It sends through Gmail API using the original Gmail thread ID.
8. It stores the exact sent representation and provider identifiers.
9. It marks the outbox item sent or retryable.
10. The ticket timeline and audit event update.
11. A stable idempotency key prevents duplicate sends.

No AI-generated draft may be sent automatically during the demo or pilot.

## AI extraction design

AI performs semantic interpretation. Regex must not determine cargo intent, category, priority, requested action, shipment references, route, parties or document meaning.

Standards-compliant libraries may decode MIME and email headers. Deterministic validators may verify AI-proposed values, but may not silently replace semantic extraction.

Initial model:

    Qwen2.5 1.5B Instruct
    four-bit quantization
    temperature zero
    strict JSON response
    one request at a time per model instance
    Cloud Run minimum instances zero
    Cloud Run maximum instances one

For the live CEO demonstration, temporarily setting one warm AI instance is acceptable if cold-start latency is unsafe. It must be returned to zero after the demonstration.

Initial extraction contract:

- Intent and ticket category
- Priority
- Short summary
- Customer name and company
- AWB, bill of lading, booking or container references
- Origin and destination
- Requested action
- Operational deadline when explicit
- Missing information
- Confidence
- Evidence snippets linked to source content
- Model, prompt and schema versions

Confidence policy:

    high       create normally and show AI badge
    medium     create with Needs verification
    low        create in Unclassified review queue
    sensitive  always require human review

If AI is unavailable, preserve the email and show Processing failed. Never lose an email and never fabricate extracted fields.

## Minimal domain model

All business tables include organization_id and timestamps.

Identity and tenancy:

- organizations
- users
- organization_members
- roles
- audit_events

Mailbox:

- inbox_connections
- mailbox_labels
- mailbox_cursors
- inbound_events
- processing_attempts
- dead_letter_events

Communication:

- email_threads
- emails
- email_recipients
- email_attachments
- outbound_messages
- outbox_jobs

Ticketing:

- tickets
- ticket_status_history
- ticket_assignments
- ticket_comments
- ticket_links

AI:

- ai_runs
- ai_extractions
- ai_field_evidence
- ai_corrections
- prompt_versions

Shipment records are introduced after the email-to-ticket demonstration unless the first sample emails require a minimal shipment reference table.

## Ticket workflow

Initial statuses:

    New
      → Needs verification
      → Open
      → In progress
      → Waiting on customer
      → Resolved
      → Closed

A new customer reply reopens a resolved ticket according to workspace policy.

Initial categories:

- Booking
- Documentation
- Shipment status
- Delay or exception
- Customs or hold
- Pickup or delivery
- Billing
- Damage or claim
- Other

The system may classify customs, damage and claims emails, but it may not autonomously make regulated, financial, release, liability or dangerous-goods decisions.

## User experience for the demonstration

### Sign in

- Google sign-in
- Access restricted to the Skyvalence operator
- Clear workspace identity

### Operations inbox

- Real database-backed tickets
- Status, priority, customer, category and age
- AI confidence indicator
- Processing and failure states
- Search by subject or reference if time permits

### Ticket detail

- Subject and ticket number
- Customer and participants
- Original email
- AI summary and extracted cargo fields
- Evidence and confidence
- Conversation timeline
- Status and assignment
- Reply composer
- Sending and failure feedback
- Audit timeline

### Demo safety

- A seeded backup ticket matching the live sample
- A visible health screen for Gmail, database and AI
- A manual replay control restricted to the founder
- No destructive admin operations
- No automatic outbound AI reply

## Authentication, tenancy and security

Tenant isolation is not postponed even though the demo has one organization.

Requirements:

- Supabase Auth session verified server-side
- Organization membership checked on every business action
- Row-level security on tenant data where Supabase client access exists
- Service-role key used only by trusted server workloads
- OAuth refresh tokens encrypted and never returned to the browser
- GCP service accounts separated by service
- Secret Manager for deployment secrets
- Pub/Sub push authenticated with OIDC
- Cloud Run internal services not publicly callable
- Webhook and job idempotency
- HTML sanitization
- Attachment limits
- Structured audit events
- Sentry scrubbing of bodies, addresses, tokens and attachments
- PostHog events without message bodies or shipment identifiers

Before an external customer pilot:

- Privacy policy and terms
- Data processing agreement review
- Google OAuth verification strategy
- Backup and restore test
- Incident response and deletion runbooks
- Dependency and container scanning
- Tenant isolation integration tests
- Attachment malware scanning
- Retention policy

## Observability

Sentry records:

- Unhandled web and worker errors
- Gmail API and Pub/Sub failures
- AI timeouts and invalid outputs
- Database failures
- Outbox delivery failures
- Performance traces with PII removed

PostHog records product events only:

- sign_in_completed
- inbox_connected
- inbound_email_recorded
- ai_extraction_completed
- ticket_created
- ticket_opened
- reply_started
- reply_sent
- ticket_resolved

Operational metrics:

- Email arrival to durable storage
- Storage to ticket creation latency
- AI latency and validation failure rate
- Duplicate event count
- Dead-letter count
- Reply delivery success
- Thread-match accuracy
- Operator correction rate

## Parallel Codex execution

Use independent Git worktrees or branches from the same repository.

### Workstream A — foundation and contracts

Owns:

- workspace tooling
- shared contracts
- database schema and migrations
- auth and tenant context
- test fixtures
- CI

May edit:

    packages/contracts
    packages/db
    packages/auth
    packages/testkit
    infra
    root configuration

### Workstream B — operator application

Owns:

- sign in
- inbox UI
- ticket detail
- conversation
- reply composer
- loading and error states
- Playwright flow

May edit:

    apps/web

Consumes contracts from Workstream A.

### Workstream C — Gmail and workflow worker

Owns:

- OAuth callback and token lifecycle
- Gmail watch setup and renewal
- Pub/Sub consumer
- history synchronization
- MIME storage
- ticket orchestration
- outbox and Gmail send
- retries and dead letters

May edit:

    apps/worker
    packages/gmail

Consumes database and extraction contracts.

### Workstream D — AI inference and evaluation

Owns:

- Qwen container
- OpenAI-compatible inference endpoint
- extraction prompt
- schema validation
- fixtures and evaluation
- confidence and evidence

May edit:

    services/ai
    packages/ai
    docs/evaluations

### Integration rule

Contracts and migrations merge first. Workstreams do not invent private copies of shared types. Every pull request must state the contract version it expects. Main must remain deployable.

Jira should contain one epic per workstream plus a CEO Demo Integration epic. The architecture document remains the decision authority; Jira represents execution status.

## Two-day execution plan

### Hour 0–2: access and foundation

Founder actions:

- Confirm exact domain spelling.
- Authenticate gcloud with the correct Google account.
- Select or create the dedicated GCP project and attach billing.
- Confirm whether the project belongs to the Skyvalence Workspace organization.
- Create the cargo mailbox alias and Gmail label/filter.
- Create or identify the Supabase project.
- Provide Sentry and PostHog project access through local environment configuration.

Engineering actions:

- Scaffold the monorepo.
- Define contracts and database schema.
- Configure local development and secret templates.
- Establish CI checks.

Gate: local web, database and worker health checks pass.

### Hour 2–8: inbound vertical slice

- Configure Gmail OAuth and required APIs.
- Configure Pub/Sub topic and authenticated push.
- Implement watch registration and cursor storage.
- Retrieve and persist one real Gmail message.
- Deploy or run Qwen.
- Validate one real AI extraction.
- Create a ticket transactionally.

Gate: sending a real email produces a database ticket without manual API calls.

### Hour 8–14: operations UI

- Build authenticated operations inbox.
- Build ticket detail and conversation.
- Display AI fields, evidence and confidence.
- Add status transitions.
- Add processing and failure states.

Gate: the real email-created ticket is usable in the browser.

### Hour 14–20: outbound reply

- Implement drafts and transactional outbox.
- Implement Gmail send with thread metadata.
- Record provider IDs and exact sent content.
- Add reply composer and send state.
- Test receipt in an external mailbox.

Gate: a browser-authored reply is received by the original sender.

### Hour 20–28: deployment

- Build production containers.
- Deploy web, worker and AI to Cloud Run.
- Apply Supabase migrations.
- Configure secrets and service accounts.
- Map cargo.skyvalence.com if DNS propagation is safe.
- Configure Sentry and PostHog.
- Seed the backup demo.

Gate: the complete flow works from deployed services.

### Hour 28–36: hardening and rehearsal

- Run duplicate notification tests.
- Run AI outage and Gmail retry tests.
- Verify authorization and tenant boundaries.
- Test an external customer reply.
- Add health and replay controls.
- Run the scripted demonstration at least three times.
- Freeze risky changes before the meeting.

Gate: three consecutive successful demonstrations.

## CEO demonstration script

1. Open Cargo Manager by Skyvalence and show an empty or known queue.
2. Send a realistic cargo email from an external mailbox to cargo@skyvalence.com.
3. Refresh or watch the ticket appear.
4. Open the ticket.
5. Show the original message.
6. Show Qwen-extracted category, urgency, reference, route, summary and requested action.
7. Change status or assignment.
8. Write a reply in the ticket.
9. Send it.
10. Open the external mailbox and show the received threaded reply.
11. Return to Cargo Manager and show the outbound timeline and audit event.
12. Explain that customer onboarding, more inboxes and cargo workflows are the next waves.

## Acceptance gates

### CEO demo gate

- Real Gmail message ingested
- Original message durably stored
- AI extraction produced by Qwen
- Ticket created exactly once
- Ticket displayed from PostgreSQL
- Human reply sent through Gmail
- External sender receives reply
- Audit events visible
- Deployed flow works
- Backup demo available

### Controlled pilot gate

In addition to the demo gate:

- Customer organization onboarding
- Verified external OAuth path
- Multiple users and roles
- Attachments and malware controls
- Replay and dead-letter tooling
- Automated backup and tested restore
- Tenant isolation tests
- Error and latency alerts
- Retention and deletion policy
- Five to twenty anonymized customer emails evaluated
- Customer approval of workflow and data handling

### Production MVP gate

In addition to the pilot gate:

- Multiple customer workspaces
- Google OAuth verification completed
- Microsoft 365 connector
- SLA and assignment rules
- Shipment-linked ticket model
- Search and operational reporting
- Support and incident runbooks
- Security review
- Billing and plan enforcement
- Measured AI quality thresholds

## Access required from the founder

Do not send secrets through chat. Authenticate locally or store values in ignored local environment files and cloud secret managers.

Immediate:

- GCP project selection and billing confirmation
- gcloud authentication
- Workspace administrator access for alias, OAuth and app controls
- Supabase project access
- DNS provider access for cargo.skyvalence.com
- One external test sender address
- Sentry project or auth token
- PostHog project key and host
- GitHub access already configured
- Jira project access if backlog creation is requested

Product input:

- One realistic anonymized cargo email is enough for the first flow
- Five to twenty samples are strongly preferred
- CEO meeting time and timezone
- Desired demo operator name
- Whether replies should display cargo@skyvalence.com or info@skyvalence.com

## Deployment and cost plan

### Demonstration

- Cloud Run services scale to zero
- AI maximum one instance
- Supabase Free
- PostHog Free
- Sentry Free
- Gmail API and Pub/Sub low-volume usage
- Existing domain
- Expected infrastructure spend near zero at demonstration volume, but GCP billing must be enabled

Configure:

- Cloud Run maximum instances
- GCP budget alerts
- Cloud Run spend cap when available
- Short log retention
- No always-on VM
- No Cloud SQL
- No Kubernetes
- No permanent GPU
- No VPC connector unless required

### First real customer

The first required paid upgrade should be Supabase Pro for non-pausing service and managed daily backups. Keep Cloud Run request-based until latency or volume proves otherwise.

Vercel Pro may be reconsidered later for frontend deployment convenience. It is not required for the architecture.

## Product waves after the demonstration

### Wave 1 — pilot foundation

- Customer organizations and onboarding
- Team invitation and roles
- Production Google OAuth
- Inbox connection health
- Attachment storage and scanning
- AI review workflow
- Operational backups and runbooks

### Wave 2 — cargo-native workflow

- Shipment records
- Master and house references
- Parties and trade lanes
- Milestones
- Cargo ticket taxonomy
- Queues, assignment and SLA
- Internal notes and watchers
- Merge, split and linked tickets

### Wave 3 — additional channels and integrations

- Microsoft 365
- Controlled forwarding fallback
- Carrier and terminal events
- TMS integration
- Customer portal
- Saved replies and translation

### Wave 4 — intelligence and automation

- Document OCR
- Missing-document detection
- Shipment matching
- Suggested actions
- Exception automation
- Customer-specific SOPs
- Analytics and manager reporting

Regulated actions always remain separately approved and jurisdiction-specific.

## Architecture decision log

### 2026-08-16 — greenfield reset

Decision: delete the previous implementation and retain Git history.

Reason: the implementation did not meet the required product and deployment direction.

### 2026-08-16 — monorepo

Decision: use one repository with separate deployable units.

Reason: speed, shared contracts, atomic integration and parallel Codex execution.

### 2026-08-16 — GCP-first compute

Decision: deploy web, worker and AI to Cloud Run.

Reason: existing GCP access, commercial use, scale-to-zero economics and native Gmail Pub/Sub integration.

### 2026-08-16 — direct Gmail integration

Decision: connect Google Workspace directly for the first demonstration.

Reason: the mailbox already exists, replies should use the real identity, and the same integration path is valuable for freight-forwarder customers.

### 2026-08-16 — Supabase data platform

Decision: use Supabase PostgreSQL, Auth and Storage initially.

Reason: fastest managed foundation at low cost. Upgrade before a real production pilot.

### 2026-08-16 — human-controlled AI

Decision: use open-source Qwen for extraction and suggestions, never automatic external sending during pilot.

Reason: operational safety, auditability and customer trust.

## Primary technical references

- Gmail push notifications: https://developers.google.com/workspace/gmail/api/guides/push
- Gmail API reference: https://developers.google.com/workspace/gmail/api/reference/rest
- Gmail labels: https://developers.google.com/workspace/gmail/api/guides/labels
- Google OAuth internal apps: https://support.google.com/cloud/answer/13464323
- Cloud Run Next.js deployment: https://docs.cloud.google.com/run/docs/quickstarts/frameworks/deploy-nextjs-service
- Cloud Run pricing: https://cloud.google.com/run/pricing
- Pub/Sub pricing: https://cloud.google.com/pubsub/pricing
- Supabase pricing: https://supabase.com/pricing
- PostHog privacy guidance: https://posthog.com/docs/privacy
- Sentry data scrubbing: https://docs.sentry.io/security-legal-pii/scrubbing/

## Definition of the first production MVP

An authenticated operator in a tenant-isolated freight workspace can connect a verified Google or Microsoft inbox, receive and preserve real operational email, inspect open-source AI-extracted cargo information with evidence and confidence, create or update a shipment-linked ticket, assign and progress the work, send a human-approved reply through the original mailbox and thread, see delivery and failure state, and audit every automated and human action. Duplicate events and sends are prevented, failures are replayable, backups are tested, and regulated decisions remain human-controlled.
