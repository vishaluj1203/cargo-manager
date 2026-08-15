# Cargo Manager architecture

## Goal

Give cargo operations teams a shared inbox that behaves like a focused JIRA: every request has an owner, status, priority, conversation, searchable identifiers, and an immutable history.

## System shape

```text
Inbound email provider -> /api/inbound/email -> validate + deduplicate -> ticket service -> PostgreSQL/Supabase
                                                                    |-> audit event
Agent web app -> ticket API/server actions -> PostgreSQL
Agent reply -> outbound message queue -> email provider -> customer thread
```

The core domain owns ticket state and message history. Email providers only translate provider webhooks/API payloads into the normalized email contract and deliver outbound messages. This keeps provider replacement and future channels (portal, WhatsApp, API) low-risk.

## Data model

- `contacts`: normalized customer identity.
- `tickets`: stable `CAR-######` reference, lifecycle state, priority, assignee, tags, and activity timestamps.
- `messages`: inbound/outbound conversation entries, provider IDs, threading headers, and delivery status.
- `inbound_events`: raw provider event receipt for idempotency and replay.
- `audit_events`: append-only business history for every state change, assignment, reply, and automation.

## Email-to-ticket rules

1. Verify the provider signature at the edge before parsing (the starter webhook uses a shared secret).
2. Store the raw event keyed by provider `messageId`; repeated delivery must return the original result.
3. Match an existing ticket by `In-Reply-To`, `References`, or a `CAR-######` token in subject/body.
4. Otherwise create a contact and a new ticket in one transaction.
5. Store the inbound message and audit event, then update `last_activity_at`.
6. Never send email inside the inbound request after the database commit; enqueue an outbound job and retry safely.

## Security and reliability

Use authenticated team users with organization-level authorization before exposing ticket APIs. Redact secrets and unnecessary personal data from logs. Validate MIME size and attachment types, virus-scan attachments, rate-limit webhooks, and retain raw email only according to the customer data policy. Outbound sends need idempotency keys, exponential retry, dead-letter visibility, and provider delivery webhooks.

## Delivery roadmap

1. Foundation (this repo): schema, migration, normalized webhook, first ticket transaction, UI shell, local/Supabase docs.
2. Usable MVP: auth/RBAC, ticket list/detail, message composer, real outbound provider adapter, threading matcher, attachments, filters, and audit timeline.
3. Cargo workflow: shipment/AWB/container fields, SLA timers, saved views, assignment rules, canned replies, internal notes, and customer-facing status.
4. Operations scale: queue worker, provider retries, full-text search, metrics, observability, exports, automation rules, and multi-tenant isolation.

## Definition of done for MVP

An authenticated agent can open a ticket created from a real email, see the complete thread and metadata, reply from the ticket, see delivery status, re-open or resolve it, and inspect who changed what and when. Duplicate provider deliveries do not create duplicate tickets or messages.
