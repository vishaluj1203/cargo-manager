# Cargo Manager — phased architecture plan

## Product objective

Cargo Manager is a shipment-linked operations workspace for freight forwarders. It ingests customer and partner email, uses AI to understand cargo work, creates or updates operational tickets, and lets operators reply through the original email conversation.

The product is not a generic help desk and should not initially attempt to replace a complete TMS, customs platform, warehouse system, or accounting suite.

```text
Email     = communication record
Ticket    = work requiring action
Shipment  = durable cargo record
Task      = specific operational responsibility
Milestone = planned or actual shipment event
Document  = evidence, instruction, or commercial record
```

One shipment can have many tickets, messages, documents, tasks, parties, and milestones. Several email threads may concern one shipment, and one email may mention more than one shipment.

## Recommended initial market

Start with small and mid-sized freight-forwarder import/export operations teams that use a shared Gmail or Microsoft inbox. Initial supported work should include:

- Booking and capacity requests
- Documentation questions and corrections
- Shipment status and ETA requests
- Carrier and routing exceptions
- Release and delivery coordination
- Customer communication

Customs-related cases may be managed as tickets, but the initial product must not automatically file customs declarations, classify goods, approve dangerous goods, authorize release, accept claims, or make other regulated decisions.

## Target system architecture

```text
                         ┌────────────────────┐
                         │ Next.js Web App    │
                         │ Vercel             │
                         └─────────┬──────────┘
                                   │
                         ┌─────────▼──────────┐
                         │ Application API    │
                         │ Auth + tenant RBAC │
                         └─────────┬──────────┘
                                   │
                  ┌────────────────┼────────────────┐
                  │                │                │
        ┌─────────▼──────┐ ┌──────▼───────┐ ┌─────▼─────────┐
        │ Supabase       │ │ Object Store │ │ Job Queue     │
        │ PostgreSQL     │ │ Attachments  │ │ PostgreSQL    │
        │ Auth + RLS     │ │ Raw emails   │ │ based first   │
        └────────────────┘ └──────────────┘ └─────┬─────────┘
                                                  │
                                        ┌─────────▼──────────┐
                                        │ Background Worker  │
                                        │ Railway/Fly/Render │
                                        └─────────┬──────────┘
                                                  │
                  ┌───────────────────────────────┼────────────────────┐
                  │                               │                    │
        ┌─────────▼─────────┐          ┌──────────▼────────┐ ┌────────▼────────┐
        │ Gmail / Microsoft│          │ AI Extraction     │ │ Email Delivery │
        │ Postmark inbound │          │ Qwen + Docling    │ │ Gmail/Graph/   │
        │ connectors       │          │ Hosted separately │ │ Postmark       │
        └───────────────────┘          └───────────────────┘ └─────────────────┘
```

Vercel hosts the web application and short request/response APIs. Inbox synchronization, OCR, model inference, retries, attachment processing, and outbound delivery run in a persistent background worker. The initial implementation should remain a modular monolith rather than introducing microservices prematurely.

## Bounded modules

- Identity and organizations
- Client onboarding
- Inbox integrations
- Email ingestion and threading
- AI and document extraction
- Shipments and references
- Cargo-native ticket workflows
- Outbound communication
- Audit and compliance
- Notifications and SLA
- Reporting and feedback

## Wave 0 — Domain discovery and product contract

### Goal

Define the first product from observed freight operations before expanding the database or implementation.

### Work

- Interview and shadow 5–8 freight operators across at least two forwarders.
- Review 100–200 anonymized operational emails.
- Select the first operational niche and modes.
- Produce the ticket taxonomy and state machine.
- Define every AI extraction field and its business meaning.
- Document customer-specific SOP differences.
- Identify regulated, sensitive, and approval-only actions.
- Create an anonymized, versioned AI evaluation dataset.
- Define pilot success metrics and acceptance criteria.

### Exit criteria

- At least 100 representative emails are categorized.
- At least 90% fit the initial taxonomy.
- Every extracted field has a written definition.
- Actions requiring human approval are explicit.
- The first pilot customer profile and scope are fixed.

## Wave 1 — SaaS and tenant foundation

### Goal

Make the application safe for multiple freight-forwarder customers.

### Capabilities

- Supabase Auth
- Organizations and workspaces
- Organization membership
- Branches, teams, and locations
- Roles and permissions
- PostgreSQL row-level security
- Tenant-scoped records and queries
- Immutable audit events
- Managed secrets and environment separation

### Initial roles

- Workspace owner
- Administrator
- Operations manager
- Operator
- Sales/customer service
- Customs specialist
- Read-only auditor

### Core records

```text
organizations
organization_members
users
branches
teams
roles
permissions
audit_events
```

Every business record must have `organization_id`. A ticket, customer, message, attachment, shipment, or integration query must never execute without tenant scope.

### Exit criteria

- Users can authenticate and belong to multiple workspaces.
- Tenant isolation is enforced and automatically tested.
- Role restrictions are covered by authorization tests.
- Sensitive actions always produce audit events.

## Wave 2 — Proper client onboarding

### Goal

Let a freight forwarder create a useful workspace without engineering assistance.

### Journey

1. Create account and workspace.
2. Select company type and legal/operational role.
3. Add branches, time zones, working hours, modes, and trade lanes.
4. Invite the pilot team and assign responsibilities.
5. Configure queues, escalation paths, and SLA expectations.
6. Select inbox connection method.
7. Configure and verify reply identity.
8. Send a test email.
9. Review the generated ticket and AI extraction.
10. Enter a controlled shadow-mode pilot.

### Information collected

- Company and legal name
- Forwarder, NVOCC, broker, operator, or handler role
- Branches and working hours
- Air, ocean, road, rail, or multimodal activity
- Import/export workflows and trade lanes
- Shared inboxes and aliases
- Existing TMS and job-number formats
- Teams, roles, and escalation paths
- Customer response SLA
- Reply signatures and languages
- Retention and approval requirements
- Compliance regions and dangerous-goods activity

### Demo mode

The customer may skip inbox connection and load realistic tickets for booking, missing documentation, container delay, customs hold, arrival notice, invoice dispute, AI extraction, email conversations, and shipment milestones.

### Exit criteria

- A new user reaches a useful demo workspace in under five minutes.
- Progress is persisted and resumable.
- Team invitations and permissions work.
- Inbox connection can be postponed or changed.

## Wave 3 — Durable email ingestion

### Goal

Receive real email without loss, duplication, or broken threading.

### Initial pilot path

```text
Client shared inbox
    → tenant-specific forwarding address
    → inbound email provider
    → signed webhook
    → immutable inbound event
    → processing queue
```

Forwarding is the first pilot option. Google Workspace OAuth and Microsoft 365 OAuth follow for production. IMAP is a controlled fallback only.

### Requirements

- Verify provider signatures.
- Persist the raw event before processing.
- Preserve original RFC/MIME content and headers.
- Decode text, HTML, recipients, and attachments.
- Store attachments outside the database.
- Deduplicate by tenant, mailbox, and provider message ID.
- Preserve `Message-ID`, `In-Reply-To`, and `References`.
- Maintain provider history/delta cursors.
- Retry safely and expose dead-letter events.
- Detect loops, bounces, spam, and automatic replies.
- Enforce file size, MIME, retention, and malware policies.

### Records

```text
inbox_integrations
mailboxes
mailbox_cursors
inbound_events
emails
email_recipients
email_attachments
email_threads
processing_attempts
dead_letter_events
```

### Exit criteria

- Repeated webhook delivery creates one email.
- Failed events can be inspected and replayed.
- Attachments are securely stored.
- Thread metadata survives processing.
- Email preservation does not depend on AI availability.

## Wave 4 — AI and document extraction

### Goal

Convert emails and attachments into validated cargo information using AI rather than regex business rules.

### Pipeline

```text
Email + attachments
    → MIME/document normalization
    → malware checks and Docling/OCR
    → intent classification
    → cargo field extraction
    → shipment candidate matching
    → schema and consistency validation
    → confidence policy
    → human review or automatic continuation
```

### Components

- Qwen2.5 1.5B Instruct as the initial lightweight semantic model
- Docling for PDF, office document, email, scan, OCR, and table conversion
- A separately hosted model endpoint
- Strict structured JSON output validated at the boundary
- Versioned prompts, models, schemas, and evaluations
- Field-level confidence and source provenance

### No-regex policy

Regex must not determine intent, category, priority, shipment fields, customer requests, next actions, document meaning, or shipment matching. RFC/MIME libraries may decode email transport structures. Deterministic checks may validate values already proposed by AI, but they must not discover cargo data from message text.

### Extraction provenance

```text
field name
extracted value
source email or attachment
source page/location
model and version
prompt version
confidence
validation result
operator correction
correction author and time
```

### Confidence policy

- High confidence: create or update normally.
- Medium confidence: create with `Needs verification`.
- Low confidence: place in an unclassified review queue.
- Compliance-sensitive: always require human approval.

### Exit criteria

- Performance is measured against the Wave 0 dataset.
- Invalid model output cannot create records.
- Every important field has provenance.
- Corrections are retained as evaluation feedback.
- No regulated action is performed autonomously.

## Wave 5 — Cargo-native ticketing

### Goal

Provide a clean, JIRA-like operations queue connected to shipments and conversations.

```text
Shipment
 ├── References
 ├── Parties
 ├── Documents
 ├── Milestones
 ├── Tickets
 │    ├── Conversation
 │    ├── Tasks
 │    ├── SLA
 │    └── Audit events
 └── Exceptions
```

### Ticket types

- Enquiry or quotation
- Booking or capacity
- Pickup or warehouse
- Documentation
- Customs or security filing
- Tracking or ETA
- Shipment exception
- Carrier hold or rejection
- Customs hold or inspection
- Cargo release
- Delivery or POD
- Billing or invoice dispute
- Damage, shortage, or claim

### Workflow

```text
New
→ AI triaged
→ Needs verification
→ Assigned
→ In progress
→ Waiting on customer/carrier/agent/customs
→ Monitoring milestone
→ Resolved
→ Closed
```

Waiting states must affect SLA according to workspace rules.

### Capabilities

- Queue, assignee, watchers, and branch
- Category, subtype, priority, due date, and SLA
- Shipment, customer, party, and document links
- AI summary, confidence, missing information, and suggested next action
- Internal notes versus customer-visible messages
- Related tickets, merge, and split
- Required-document checklists
- Search and immutable timeline

### Essential screens

- Operations inbox
- My queue, unassigned, and overdue
- Ticket and conversation detail
- Shipment detail and milestones
- Document viewer
- AI verification panel
- Customer/party profile
- Team workload and audit timeline

### Exit criteria

- Operators can triage without searching the original inbox.
- One shipment supports multiple tickets and conversations.
- Tickets can be linked, merged, and split safely.
- Internal and external communication are visually distinct.
- Workflow and SLA behavior is tested and auditable.

## Wave 6 — Replies through tickets

### Goal

Let operators reply through the original email conversation safely and reliably.

```text
Operator draft
    → authorization and optional approval
    → transactional outbox
    → background delivery worker
    → Gmail/Microsoft/email provider
    → provider delivery event
    → ticket timeline
```

### Requirements

- Preserve the configured sender identity.
- Maintain `In-Reply-To` and `References`.
- Support To, Cc, Bcc, drafts, and attachments.
- Separate customer replies from internal notes.
- Prevent duplicate sends with idempotency keys.
- Retry transient failures and expose permanent failures.
- Track queued, sent, delivered, bounced, and failed states.
- Reopen resolved tickets on customer reply according to policy.
- Sanitize HTML, signatures, and quoted history.
- Store the exact message that was sent.

AI may summarize, translate, list missing information, or propose a draft. It may not send automatically during the pilot.

### Exit criteria

- Replies remain in the customer’s existing email thread.
- Duplicate delivery is prevented.
- Provider failures are visible and retryable.
- Internal notes cannot be sent accidentally.
- Every outbound message has a complete audit trail.

## Wave 7 — Shipment intelligence

### Goal

Evolve from email ticketing into cargo operations control without becoming a full TMS.

### Shipment capabilities

- Air, ocean, road, and multimodal modes
- House/master relationships and consolidations
- Parties, references, equipment, cargo, and documents
- Planned, estimated, and actual milestones
- Holds, inspections, release, pickup, delivery, and POD
- Exception and document-version timelines

### Standards alignment

- IATA/Cargo iQ milestones for air
- DCSA events and references for ocean
- WCO-aligned customs, party, and location data
- UN/LOCODE and ISO country/currency codes
- Customer mappings layered over standard definitions

### Event-driven work

- ETA changed → notify owner.
- Arrival without customs release → create task.
- Free time approaching expiry → urgent exception.
- Required document missing → request it.
- Customer reply received → reopen ticket.
- Carrier rejection received → assign documentation queue.

### Exit criteria

- Emails update existing shipment records reliably.
- Milestones create tickets/tasks only when action is required.
- Planned, estimated, and actual times are distinct.
- Customer-facing and internal operational statuses are separate.
- Every automatic task explains its trigger.

## Wave 8 — Pilot hardening and production readiness

### Goal

Safely onboard the first live freight-forwarder workspace.

### Reliability

- Backup and restore testing
- Queue and dead-letter monitoring
- Webhook replay tools
- Rate limiting and idempotency
- Health checks and structured logs
- Error and performance monitoring
- Operational support runbooks

### Security

- RLS and tenant-isolation verification
- Encrypted OAuth tokens and secret rotation
- Signed attachment URLs and malware scanning
- Data retention and deletion
- Least-privilege provider permissions
- Audit exports and admin-session controls
- Security incident process

### Controlled pilot

- One customer, branch, and shared inbox
- Small operations team
- Selected message categories
- Human review of uncertain AI extraction
- Human approval for every external reply
- Daily mistake review and weekly feedback

### Exit criteria

- Restore drill completed.
- Tenant-isolation tests pass.
- No unresolved critical security issues.
- AI evaluation report is approved.
- Real-provider reply delivery is verified.
- Support, incident, and rollback runbooks exist.
- Pilot customer accepts the data-handling agreement.

## Wave 9 — Integrations and controlled automation

Only after a successful pilot:

- Direct Gmail and Microsoft integrations
- Carrier and terminal APIs
- DCSA Track & Trace
- Existing TMS integrations
- Customer portal
- Automated milestone notifications
- Customer-specific SOP rules
- Saved replies and multilingual assistance
- Manager analytics and reports
- Accounting handoff
- Country-specific customs integrations
- Mobile notifications

Customs declaration automation remains a separate jurisdiction-specific program requiring qualified domain experts.

## Release gates

| Release | Waves | Audience |
|---|---:|---|
| Product prototype | 0–2 | Internal demos and discovery |
| Technical alpha | 3–4 | Internal test inboxes |
| Operations alpha | 5–6 | Design partners with controlled email |
| Private pilot | 7–8 | First live freight forwarder |
| Production MVP | 0–8 hardened | Multiple paying customers |
| Expansion | 9 | Integrations and automation |

## Recommended repository structure

```text
apps/
  web/                 Next.js UI and short APIs
  worker/              Email, AI, OCR, jobs, retries, outbound delivery

packages/
  auth/
  db/
  domain/
  email/
  ai/
  documents/
  tickets/
  shipments/
  workflows/
  integrations/
  observability/

docs/
  research/
  product/
  runbooks/
  security/
  evaluations/
```

## Initial product decisions

Recommended defaults until discovery invalidates them:

1. First customer: small or mid-sized freight-forwarder operations team.
2. First connection: one shared inbox using forwarding.
3. First scope: booking, documentation, status, and exception emails.
4. AI policy: create proposed tickets automatically, require review for uncertainty, and require approval for every reply.
5. Architecture: modular monolith plus a persistent worker, not microservices.
6. Compliance policy: no autonomous customs, dangerous-goods, release, claims, or liability decisions.

## Success metrics

- Ticket creation accuracy
- Shipment-match accuracy
- Email-thread accuracy
- Field-level extraction precision
- Operator correction rate
- Time from email arrival to assignment
- First-response time
- Missed-email reduction
- Duplicate-ticket and duplicate-send rates
- Work resolved without searching the original inbox
- Operator satisfaction after one week

## Definition of production MVP

An authenticated operator in a tenant-isolated workspace can connect a verified inbox, receive a real email, inspect AI-extracted cargo fields with provenance, create or update a shipment-linked ticket, assign and progress the work, reply through the original email thread, see delivery status, and audit every automated and human action. Duplicate events and sends are safely handled, failures are replayable, and regulated decisions remain human-controlled.
