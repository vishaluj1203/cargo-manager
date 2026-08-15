# Client onboarding runbook

## Recommended customer journey

1. **Create account and workspace** — the first user signs up, names the company, and becomes the workspace owner. Do not request mailbox credentials on this screen.
2. **Invite the pilot team** — invite one operations lead and one or two agents. Keep the pilot small enough to review every AI extraction.
3. **Choose an inbox connection** — offer demo data, forwarding (fastest pilot), Google Workspace OAuth, or Microsoft 365 OAuth.
4. **Verify delivery** — send one real test email containing an AWB/container number. Confirm that the ticket, AI fields, customer, and thread appear correctly.
5. **Configure reply identity** — verify the sender domain and choose the From address. Replies must be sent by the connected provider, not by a spoofed address.
6. **Go live gradually** — forward only one category or alias for the first few days. Review confidence, priority, routing, and reply delivery before forwarding the whole inbox.
7. **Collect feedback** — add a short in-app feedback prompt after the first resolved ticket and schedule a 20-minute review after the first week.

## Inbox integration choices

### Forwarding: recommended for the first demo

Cargo Manager generates a tenant-specific address such as `inbox+acme-logistics@inbound.cargomanager.app`. The customer creates a forwarding rule from `support@customer.com`. This avoids storing mailbox passwords and is usually the fastest path to a working pilot. The inbound provider should verify the forwarding sender and POST a normalized event to `/api/inbound/email`.

### Google or Microsoft OAuth: recommended for production shared mailboxes

The customer clicks Connect, approves the minimum mail scopes, and selects the shared inbox. Store only encrypted refresh tokens in a tenant-scoped integration record. Use provider webhooks or a cursor-based sync to ingest messages. For replies, call the same provider so `In-Reply-To` and `References` preserve the thread.

### IMAP: fallback only

Support IMAP only when a customer cannot use OAuth. Credentials must be encrypted, access must be tenant-scoped, and the connector needs a polling worker, cursor, reconnect handling, and an explicit security review.

## Production prerequisites still required

The current `/onboarding` page is a demo-ready UX shell. Before onboarding real tenants, add Supabase Auth, `organizations`, `organization_members`, `inbox_integrations`, and `onboarding_sessions`; add `organization_id` to every business table and enforce it in every query. Add OAuth callback routes, encrypted secrets, provider signature verification, outbound email delivery, and a background retry worker.
