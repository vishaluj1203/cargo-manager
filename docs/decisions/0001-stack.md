# ADR 0001: Vercel, Next.js, PostgreSQL, and provider adapters

- Status: accepted
- Date: 2026-08-16

## Decision

Use Next.js/TypeScript for the Vercel-hosted web and API surface, PostgreSQL for durable relational state (locally and through Supabase), and adapter interfaces around inbound/outbound email providers.

## Why

This gives a single deployable product with fast iteration, strong relational constraints for ticket history, and a migration path from synchronous MVP handlers to a durable queue/worker when volume requires it. Supabase adds managed PostgreSQL, backups, SQL tooling, and room for auth/storage without making the domain dependent on Supabase APIs.

## Consequences

Vercel functions should remain short-lived and idempotent. Long-running parsing, attachment scanning, and retries must move to a queue/worker in the scale phase. Database migrations must be reviewed and applied consistently across local and hosted environments.
