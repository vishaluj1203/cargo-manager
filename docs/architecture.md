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

## AI email parsing

The parser is an OpenAI-compatible client in `src/lib/ai-parser.ts`; it asks a model for a validated JSON extraction rather than using regex to infer cargo meaning. The extraction is stored on the ticket as `ai_extraction` plus queryable `summary`, `category`, and `priority` fields. Zod rejects malformed or invented-shaped responses, and the prompt explicitly requires `null` for missing values.

The lightweight default is the open-source Qwen2.5 1.5B Instruct model through Ollama for local development. For production, host the same model on a managed Hugging Face Inference Endpoint using an OpenAI-compatible vLLM/TGI deployment, then set `AI_BASE_URL`, `AI_MODEL`, and `AI_API_KEY` in Vercel. Vercel should call the hosted model; it should not run the model inside the serverless function. Keep a human review path for low-confidence extractions.

Local AI setup:

```bash
ollama serve
ollama pull qwen2.5:1.5b-instruct
```

Production AI setup:

1. Create a Hugging Face Inference Endpoint for `Qwen/Qwen2.5-1.5B-Instruct`.
2. Choose an OpenAI-compatible text-generation runtime and copy the endpoint URL/token.
3. Set `AI_BASE_URL` to the endpoint base URL, `AI_MODEL` to the deployed model name, and `AI_API_KEY` to the secret in Vercel.
4. Run evaluation fixtures against representative cargo emails before enabling automatic priority or routing.

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
4. Otherwise ask the AI parser for structured cargo fields and create a contact and a new ticket in one transaction.
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
