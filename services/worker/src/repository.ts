import { sqlClient } from "@cargo/db";

import { safeErrorMessage } from "./runtime.js";
import type {
  ClaimedInboundEvent,
  ClaimedOutboxDelivery,
  ConnectedInbox,
  PersistInboundInput,
  PersistInboundResult,
  WorkerRepository,
} from "./types.js";

type IdRow = { id: string };

function normalizedSubject(subject: string): string {
  let value = subject.trim().toLowerCase();
  for (const prefix of ["re:", "fw:", "fwd:"]) {
    while (value.startsWith(prefix)) value = value.slice(prefix.length).trim();
  }
  return value || "(no subject)";
}

function parsedDeadline(value: string | null): string | null {
  if (!value) return null;
  const result = new Date(value);
  return Number.isNaN(result.getTime()) ? null : result.toISOString();
}

function retryDelaySeconds(attempts: number): number {
  return Math.min(15 * 2 ** Math.max(attempts - 1, 0), 900);
}

export class PostgresWorkerRepository implements WorkerRepository {
  constructor(private readonly organizationId: string | null = null) {}

  async listConnectedInboxes(): Promise<ConnectedInbox[]> {
    const organizationId = this.organizationId;
    return sqlClient<ConnectedInbox[]>`
      select id,
             organization_id as "organizationId",
             provider,
             lower(address) as address,
             credentials.encrypted_refresh_token as "encryptedRefreshToken",
             coalesce(credentials.granted_scopes, array[]::text[]) as "grantedScopes"
      from public.inbox_connections inbox
      left join public.inbox_credentials credentials
        on credentials.inbox_connection_id = inbox.id
      where inbox.status = 'connected'
        and inbox.provider in ('local_mailpit', 'gmail')
        and (${organizationId}::uuid is null or inbox.organization_id = ${organizationId}::uuid)
      order by inbox.created_at
    `;
  }

  async enqueueInbound(
    inbox: ConnectedInbox,
    providerMessageId: string,
    metadata: Record<string, unknown>,
  ): Promise<boolean> {
    const inserted = await sqlClient<IdRow[]>`
      insert into public.inbound_events (
        organization_id, inbox_connection_id, provider_event_id, payload, status
      ) values (
        ${inbox.organizationId}, ${inbox.id}, ${providerMessageId},
        ${JSON.stringify({ providerMessageId, ...metadata })}::jsonb, 'pending'
      )
      on conflict (organization_id, inbox_connection_id, provider_event_id) do nothing
      returning id
    `;
    return inserted.length === 1;
  }

  async claimInbound(workerId: string): Promise<ClaimedInboundEvent | null> {
    const organizationId = this.organizationId;
    const rows = await sqlClient<ClaimedInboundEvent[]>`
      with candidate as (
        select inbound_events.id
        from public.inbound_events
        where attempts < 5
          and (${organizationId}::uuid is null or organization_id = ${organizationId}::uuid)
          and available_at <= now()
          and (
            status in ('pending', 'failed')
            or (status = 'processing' and locked_at < now() - interval '10 minutes')
          )
        order by created_at
        for update skip locked
        limit 1
      )
      update public.inbound_events event
      set status = 'processing',
          attempts = event.attempts + 1,
          locked_at = now(),
          locked_by = ${workerId},
          last_error = null
      from candidate,
           public.inbox_connections inbox
           left join public.inbox_credentials credentials
             on credentials.inbox_connection_id = inbox.id
      where event.id = candidate.id
        and inbox.id = event.inbox_connection_id
      returning event.id,
                event.organization_id as "organizationId",
                event.inbox_connection_id as "inboxConnectionId",
                inbox.provider,
                lower(inbox.address) as address,
                credentials.encrypted_refresh_token as "encryptedRefreshToken",
                coalesce(credentials.granted_scopes, array[]::text[]) as "grantedScopes",
                event.provider_event_id as "providerMessageId",
                event.attempts
    `;
    return rows[0] ?? null;
  }

  async persistInbound(
    input: PersistInboundInput,
  ): Promise<PersistInboundResult> {
    const { event, parsed, extraction, rawObjectPath } = input;
    const email = parsed.email;
    return sqlClient.begin(async (transaction) => {
      const duplicate = await transaction<
        { ticketId: string; ticketNumber: string }[]
      >`
        select ticket.id as "ticketId", ticket.number as "ticketNumber"
        from public.emails email
        join public.ticket_emails link on link.email_id = email.id
        join public.tickets ticket on ticket.id = link.ticket_id
        where email.organization_id = ${event.organizationId}
          and email.provider = ${event.provider}
          and email.provider_message_id = ${event.providerMessageId}
        limit 1
      `;
      if (duplicate[0]) {
        await transaction`
          update public.inbound_events
          set status = 'processed', processed_at = now(), locked_at = null, locked_by = null
          where id = ${event.id}
        `;
        return { ...duplicate[0], duplicate: true };
      }

      const parentIds = [email.inReplyTo, ...email.references].filter(
        (value): value is string => Boolean(value),
      );
      let threadId: string | null = null;
      if (email.providerThreadId) {
        const providerThread = await transaction<IdRow[]>`
          select id
          from public.email_threads
          where organization_id = ${event.organizationId}
            and provider_thread_id = ${email.providerThreadId}
          limit 1
        `;
        threadId = providerThread[0]?.id ?? null;
      }
      if (!threadId && parentIds.length) {
        const parent = await transaction<IdRow[]>`
          select thread_id as id
          from public.emails
          where organization_id = ${event.organizationId}
            and rfc_message_id = any(${transaction.array(parentIds)})
          order by created_at desc
          limit 1
        `;
        threadId = parent[0]?.id ?? null;
      }
      if (!threadId) {
        const created = await transaction<IdRow[]>`
          insert into public.email_threads (organization_id, provider_thread_id, normalized_subject)
          values (${event.organizationId}, ${email.providerThreadId}, ${normalizedSubject(email.subject)})
          returning id
        `;
        threadId = created[0]?.id ?? null;
      }
      if (!threadId) throw new Error("Unable to create email thread");

      const insertedEmail = await transaction<IdRow[]>`
        insert into public.emails (
          organization_id, thread_id, inbound_event_id, direction, provider,
          provider_message_id, rfc_message_id, in_reply_to, "references",
          from_name, from_address, to_recipients, cc_recipients, subject,
          body_text, body_html, raw_object_path, delivery_status, received_at
        ) values (
          ${event.organizationId}, ${threadId}, ${event.id}, 'inbound', ${event.provider},
          ${event.providerMessageId}, ${email.messageId}, ${email.inReplyTo},
          ${transaction.array(email.references)}, ${email.from.name}, ${email.from.address},
          ${JSON.stringify(email.to)}::jsonb, ${JSON.stringify(email.cc)}::jsonb, ${email.subject},
          ${email.text}, ${email.html}, ${rawObjectPath}, 'received', ${email.receivedAt.toISOString()}
        )
        returning id
      `;
      const emailId = insertedEmail[0]?.id;
      if (!emailId) throw new Error("Unable to persist inbound email");

      const contacts = await transaction<IdRow[]>`
        insert into public.contacts (organization_id, email, name, company)
        values (
          ${event.organizationId}, ${email.from.address}, ${email.from.name},
          ${extraction.extraction.company}
        )
        on conflict (organization_id, email) do update
          set name = coalesce(excluded.name, contacts.name),
              company = coalesce(excluded.company, contacts.company)
        returning id
      `;
      const contactId = contacts[0]?.id ?? null;

      await transaction`
        insert into public.ai_runs (
          organization_id, email_id, status, provider, model, prompt_version,
          schema_version, input_tokens, output_tokens, extraction, started_at, completed_at
        ) values (
          ${event.organizationId}, ${emailId}, 'succeeded', ${extraction.provider},
          ${extraction.model}, ${extraction.promptVersion}, ${extraction.schemaVersion},
          ${extraction.usage.inputTokens}, ${extraction.usage.outputTokens},
          ${JSON.stringify(extraction.extraction)}::jsonb, now(), now()
        )
      `;

      const existingTicket = await transaction<
        {
          id: string;
          number: string;
          status: string;
        }[]
      >`
        select id, number, status
        from public.tickets
        where organization_id = ${event.organizationId} and thread_id = ${threadId}
        limit 1
      `;
      let ticketId: string;
      let ticketNumber: string;
      if (existingTicket[0]) {
        ticketId = existingTicket[0].id;
        ticketNumber = existingTicket[0].number;
        const nextStatus =
          existingTicket[0].status === "waiting_on_customer"
            ? "open"
            : existingTicket[0].status;
        await transaction`
          update public.tickets
          set last_activity_at = now(), status = ${nextStatus}
          where id = ${ticketId}
        `;
        if (nextStatus !== existingTicket[0].status) {
          await transaction`
            insert into public.ticket_status_history (
              organization_id, ticket_id, from_status, to_status, reason
            ) values (
              ${event.organizationId}, ${ticketId}, ${existingTicket[0].status},
              ${nextStatus}, 'Customer replied by email'
            )
          `;
        }
      } else {
        const triageStatus =
          extraction.extraction.confidence < 0.7 ? "needs_verification" : "new";
        const createdTicket = await transaction<
          { id: string; number: string }[]
        >`
          insert into public.tickets (
            organization_id, contact_id, thread_id, subject, summary, category,
            priority, status, requested_action, origin, destination, deadline,
            shipment_references, missing_information, ai_confidence
          ) values (
            ${event.organizationId}, ${contactId}, ${threadId}, ${email.subject},
            ${extraction.extraction.summary}, ${extraction.extraction.category},
            ${extraction.extraction.priority}, ${triageStatus},
            ${extraction.extraction.requestedAction}, ${extraction.extraction.origin},
            ${extraction.extraction.destination}, ${parsedDeadline(extraction.extraction.deadline)},
            ${JSON.stringify(extraction.extraction.shipmentReferences)}::jsonb,
            ${transaction.array(extraction.extraction.missingInformation)},
            ${extraction.extraction.confidence}
          )
          returning id, number
        `;
        const created = createdTicket[0];
        if (!created) throw new Error("Unable to create ticket");
        ticketId = created.id;
        ticketNumber = created.number;
        await transaction`
          insert into public.ticket_status_history (
            organization_id, ticket_id, from_status, to_status, reason
          ) values (
            ${event.organizationId}, ${ticketId}, null, ${triageStatus}, 'Created from inbound email'
          )
        `;
      }

      await transaction`
        insert into public.ticket_emails (ticket_id, email_id)
        values (${ticketId}, ${emailId})
        on conflict do nothing
      `;
      await transaction`
        insert into public.audit_events (
          organization_id, ticket_id, actor_type, actor_id, event_type, data
        ) values (
          ${event.organizationId}, ${ticketId}, 'system', ${event.id},
          'email.ingested', ${JSON.stringify({
            emailId,
            provider: event.provider,
            providerMessageId: event.providerMessageId,
            aiConfidence: extraction.extraction.confidence,
          })}::jsonb
        )
      `;
      await transaction`
        update public.inbound_events
        set status = 'processed', processed_at = now(), locked_at = null, locked_by = null
        where id = ${event.id}
      `;
      return { ticketId, ticketNumber, duplicate: false };
    });
  }

  async failInbound(event: ClaimedInboundEvent, error: Error): Promise<void> {
    const status = event.attempts >= 5 ? "dead_letter" : "failed";
    await sqlClient`
      update public.inbound_events
      set status = ${status},
          last_error = ${safeErrorMessage(error)},
          available_at = now() + (${retryDelaySeconds(event.attempts)} * interval '1 second'),
          locked_at = null,
          locked_by = null
      where id = ${event.id}
    `;
  }

  async claimOutbox(workerId: string): Promise<ClaimedOutboxDelivery | null> {
    const organizationId = this.organizationId;
    const claimed = await sqlClient<{ id: string }[]>`
      with candidate as (
        select id from public.outbox_jobs
        where attempts < 5 and available_at <= now()
          and (${organizationId}::uuid is null or organization_id = ${organizationId}::uuid)
          and (
            status in ('pending', 'failed')
            or (status = 'processing' and locked_at < now() - interval '10 minutes')
          )
        order by created_at
        for update skip locked
        limit 1
      )
      update public.outbox_jobs job
      set status = 'processing', attempts = job.attempts + 1,
          locked_at = now(), locked_by = ${workerId}, last_error = null
      from candidate
      where job.id = candidate.id
      returning job.id
    `;
    if (!claimed[0]) return null;

    const rows = await sqlClient<
      {
        jobId: string;
        organizationId: string;
        ticketId: string;
        emailId: string;
        attempts: number;
        inboxConnectionId: string;
        provider: ClaimedOutboxDelivery["provider"];
        address: string;
        encryptedRefreshToken: string | null;
        grantedScopes: string[];
        providerThreadId: string | null;
        fromAddress: string;
        toRecipients: Array<{ address: string }>;
        ccRecipients: Array<{ address: string }>;
        subject: string;
        bodyText: string;
        messageId: string;
        inReplyTo: string;
        references: string[];
      }[]
    >`
      select job.id as "jobId", job.organization_id as "organizationId",
             job.ticket_id as "ticketId", job.email_id as "emailId", job.attempts,
             inbox.id as "inboxConnectionId", inbox.provider,
             lower(inbox.address) as address,
             credentials.encrypted_refresh_token as "encryptedRefreshToken",
             coalesce(credentials.granted_scopes, array[]::text[]) as "grantedScopes",
             thread.provider_thread_id as "providerThreadId",
             inbox.address as "fromAddress",
             email.to_recipients as "toRecipients", email.cc_recipients as "ccRecipients",
             email.subject, email.body_text as "bodyText", email.rfc_message_id as "messageId",
             email.in_reply_to as "inReplyTo", email."references"
      from public.outbox_jobs job
      join public.emails email on email.id = job.email_id
      join public.email_threads thread on thread.id = email.thread_id
      join public.inbox_connections inbox on inbox.id = job.inbox_connection_id
      left join public.inbox_credentials credentials
        on credentials.inbox_connection_id = inbox.id
      where job.id = ${claimed[0].id}
      limit 1
    `;
    const row = rows[0];
    const recipient = row?.toRecipients[0]?.address;
    if (!row || !recipient || !row.inReplyTo) {
      throw new Error(
        "Claimed outbox email is missing recipient or thread headers",
      );
    }
    return {
      jobId: row.jobId,
      organizationId: row.organizationId,
      ticketId: row.ticketId,
      emailId: row.emailId,
      attempts: row.attempts,
      inboxConnectionId: row.inboxConnectionId,
      provider: row.provider,
      address: row.address,
      encryptedRefreshToken: row.encryptedRefreshToken,
      grantedScopes: row.grantedScopes,
      message: {
        from: row.fromAddress,
        to: recipient,
        cc: row.ccRecipients.map((entry) => entry.address),
        subject: row.subject,
        bodyText: row.bodyText,
        messageId: row.messageId,
        inReplyTo: row.inReplyTo,
        references: row.references,
        providerThreadId: row.providerThreadId,
      },
    };
  }

  async markOutboxSent(
    delivery: ClaimedOutboxDelivery,
    sent: { providerMessageId: string; messageId: string; sentAt: Date },
  ): Promise<void> {
    await sqlClient.begin(async (transaction) => {
      await transaction`
        update public.outbox_jobs
        set status = 'sent', sent_at = ${sent.sentAt.toISOString()}, locked_at = null, locked_by = null
        where id = ${delivery.jobId}
      `;
      await transaction`
        update public.emails
        set provider_message_id = ${sent.providerMessageId}, rfc_message_id = ${sent.messageId},
            delivery_status = 'sent', sent_at = ${sent.sentAt.toISOString()}
        where id = ${delivery.emailId}
      `;
      await transaction`
        insert into public.audit_events (
          organization_id, ticket_id, actor_type, actor_id, event_type, data
        ) values (
          ${delivery.organizationId}, ${delivery.ticketId}, 'system', ${delivery.jobId},
          'email.sent', ${JSON.stringify({ emailId: delivery.emailId, messageId: sent.messageId })}::jsonb
        )
      `;
    });
  }

  async failOutbox(
    delivery: ClaimedOutboxDelivery,
    error: Error,
  ): Promise<void> {
    await sqlClient`
      update public.outbox_jobs
      set status = 'failed', last_error = ${safeErrorMessage(error)},
          available_at = now() + (${retryDelaySeconds(delivery.attempts)} * interval '1 second'),
          locked_at = null, locked_by = null
      where id = ${delivery.jobId}
    `;
    await sqlClient`
      update public.emails set delivery_status = 'failed' where id = ${delivery.emailId}
    `;
  }

  async close(): Promise<void> {
    await sqlClient.end();
  }
}
