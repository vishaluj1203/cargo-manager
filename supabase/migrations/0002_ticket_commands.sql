create or replace function public.change_ticket_status(
  target_ticket_id uuid,
  target_status public.ticket_status,
  change_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_ticket public.tickets%rowtype;
  previous_status public.ticket_status;
begin
  select * into target_ticket
  from public.tickets
  where id = target_ticket_id;

  if target_ticket.id is null or not public.is_organization_member(target_ticket.organization_id) then
    raise exception 'Ticket not found';
  end if;

  previous_status := target_ticket.status;
  if previous_status = target_status then
    return;
  end if;

  update public.tickets
  set status = target_status,
      resolved_at = case when target_status in ('resolved', 'closed') then now() else null end,
      last_activity_at = now()
  where id = target_ticket_id;

  insert into public.ticket_status_history (
    organization_id, ticket_id, from_status, to_status, actor_user_id, reason
  ) values (
    target_ticket.organization_id, target_ticket_id, previous_status, target_status,
    auth.uid(), nullif(trim(change_reason), '')
  );

  insert into public.audit_events (
    organization_id, ticket_id, actor_type, actor_id, event_type, data
  ) values (
    target_ticket.organization_id, target_ticket_id, 'user', auth.uid()::text,
    'ticket.status_changed',
    jsonb_build_object('from', previous_status, 'to', target_status, 'reason', change_reason)
  );
end;
$$;

create or replace function public.queue_ticket_reply(
  target_ticket_id uuid,
  reply_body text,
  reply_cc jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_ticket public.tickets%rowtype;
  parent_email public.emails%rowtype;
  sending_inbox public.inbox_connections%rowtype;
  reply_email_id uuid := gen_random_uuid();
  reply_outbox_id uuid := gen_random_uuid();
  reply_message_id text := '<' || gen_random_uuid()::text || '@cargo-manager.skyvalence.com>';
  reply_subject text;
  cc_recipients jsonb;
begin
  if length(trim(reply_body)) = 0 or length(reply_body) > 20000 then
    raise exception 'Reply body must contain between 1 and 20000 characters';
  end if;
  if jsonb_typeof(reply_cc) <> 'array' then
    raise exception 'CC must be an array';
  end if;

  select * into target_ticket
  from public.tickets
  where id = target_ticket_id;

  if target_ticket.id is null or not public.is_organization_member(target_ticket.organization_id) then
    raise exception 'Ticket not found';
  end if;

  select e.* into parent_email
  from public.emails e
  join public.ticket_emails te on te.email_id = e.id
  where te.ticket_id = target_ticket_id
    and e.direction = 'inbound'
  order by e.received_at desc nulls last, e.created_at desc
  limit 1;

  if parent_email.id is null then
    raise exception 'Ticket has no inbound customer email';
  end if;

  select * into sending_inbox
  from public.inbox_connections
  where organization_id = target_ticket.organization_id
    and status = 'connected'
  order by created_at
  limit 1;

  if sending_inbox.id is null then
    raise exception 'No connected inbox is available';
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object('name', null, 'address', lower(trim(value)))),
    '[]'::jsonb
  ) into cc_recipients
  from jsonb_array_elements_text(reply_cc);

  reply_subject := case
    when left(lower(trim(parent_email.subject)), 3) = 're:' then parent_email.subject
    else 'Re: ' || parent_email.subject
  end;

  insert into public.emails (
    id, organization_id, thread_id, direction, provider, provider_message_id,
    rfc_message_id, in_reply_to, "references", from_name, from_address,
    to_recipients, cc_recipients, subject, body_text, delivery_status
  ) values (
    reply_email_id,
    target_ticket.organization_id,
    target_ticket.thread_id,
    'outbound',
    sending_inbox.provider,
    reply_message_id,
    reply_message_id,
    parent_email.rfc_message_id,
    array_append(parent_email."references", parent_email.rfc_message_id),
    'Cargo Manager',
    sending_inbox.address,
    jsonb_build_array(jsonb_build_object(
      'name', parent_email.from_name,
      'address', parent_email.from_address
    )),
    cc_recipients,
    reply_subject,
    trim(reply_body),
    'queued'
  );

  insert into public.ticket_emails (ticket_id, email_id)
  values (target_ticket_id, reply_email_id);

  insert into public.outbox_jobs (
    id, organization_id, ticket_id, email_id, idempotency_key, status
  ) values (
    reply_outbox_id, target_ticket.organization_id, target_ticket_id,
    reply_email_id, reply_email_id::text, 'pending'
  );

  if target_ticket.status <> 'waiting_on_customer' then
    insert into public.ticket_status_history (
      organization_id, ticket_id, from_status, to_status, actor_user_id, reason
    ) values (
      target_ticket.organization_id, target_ticket_id, target_ticket.status,
      'waiting_on_customer', auth.uid(), 'Agent replied to customer'
    );
  end if;

  update public.tickets
  set status = 'waiting_on_customer', last_activity_at = now()
  where id = target_ticket_id;

  insert into public.audit_events (
    organization_id, ticket_id, actor_type, actor_id, event_type, data
  ) values (
    target_ticket.organization_id, target_ticket_id, 'user', auth.uid()::text,
    'ticket.reply_queued', jsonb_build_object('email_id', reply_email_id)
  );

  return reply_outbox_id;
end;
$$;

revoke all on function public.change_ticket_status(uuid, public.ticket_status, text) from public;
revoke all on function public.queue_ticket_reply(uuid, text, jsonb) from public;
grant execute on function public.change_ticket_status(uuid, public.ticket_status, text) to authenticated;
grant execute on function public.queue_ticket_reply(uuid, text, jsonb) to authenticated;
