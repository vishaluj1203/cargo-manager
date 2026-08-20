create type public.inbox_scan_scope as enum ('recent_demo', 'all_demo');
create type public.inbox_scan_status as enum (
  'pending', 'processing', 'retrying', 'completed', 'failed'
);

create or replace function public.initialize_gmail_sync_baseline()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.provider = 'gmail'
     and new.status = 'connected'
     and new.last_synced_at is null then
    new.last_synced_at := now();
  end if;
  return new;
end;
$$;

create trigger inbox_connections_gmail_sync_baseline
before insert or update of provider, status on public.inbox_connections
for each row execute function public.initialize_gmail_sync_baseline();

update public.inbox_connections
set last_synced_at = now(), updated_at = now()
where provider = 'gmail'
  and status = 'connected'
  and last_synced_at is null;

create table public.inbox_scan_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  inbox_connection_id uuid not null
    references public.inbox_connections(id) on delete cascade,
  requested_by uuid not null
    references public.profiles(id) on delete restrict,
  scope public.inbox_scan_scope not null,
  gmail_query text not null,
  status public.inbox_scan_status not null default 'pending',
  attempts integer not null default 0,
  discovered_count integer not null default 0,
  last_error text,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index inbox_scan_requests_queue_idx
  on public.inbox_scan_requests(status, available_at, created_at);
create index inbox_scan_requests_inbox_idx
  on public.inbox_scan_requests(inbox_connection_id, created_at desc);
create unique index inbox_scan_requests_one_active_idx
  on public.inbox_scan_requests(inbox_connection_id)
  where status in ('pending', 'processing', 'retrying');

alter table public.inbox_scan_requests enable row level security;
grant select on table public.inbox_scan_requests to authenticated;
grant all on table public.inbox_scan_requests to service_role;
revoke insert, update, delete on table public.inbox_scan_requests
  from anon, authenticated;

create policy "Members can view inbox scan requests"
on public.inbox_scan_requests for select
to authenticated
using (public.is_organization_member(organization_id));

create or replace function public.request_inbox_scan(
  target_inbox_id uuid,
  requested_scope public.inbox_scan_scope
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_inbox public.inbox_connections%rowtype;
  scan_request_id uuid;
begin
  select * into target_inbox
  from public.inbox_connections
  where id = target_inbox_id;

  if target_inbox.id is null
     or target_inbox.status <> 'connected'
     or not public.has_organization_role(
       target_inbox.organization_id,
       array['owner', 'admin', 'manager', 'operator']::public.member_role[]
     ) then
    raise exception 'Connected inbox not found or insufficient permission';
  end if;

  select id into scan_request_id
  from public.inbox_scan_requests
  where inbox_connection_id = target_inbox.id
    and status in ('pending', 'processing', 'retrying')
  order by created_at
  limit 1;

  if scan_request_id is not null then
    return scan_request_id;
  end if;

  insert into public.inbox_scan_requests (
    organization_id, inbox_connection_id, requested_by, scope, gmail_query
  ) values (
    target_inbox.organization_id,
    target_inbox.id,
    auth.uid(),
    requested_scope,
    case requested_scope
      when 'recent_demo' then 'newer_than:7d subject:"[Cargo Demo]"'
      when 'all_demo' then 'subject:"[Cargo Demo]"'
    end
  ) returning id into scan_request_id;

  insert into public.audit_events (
    organization_id, actor_type, actor_id, event_type, data
  ) values (
    target_inbox.organization_id,
    'user',
    auth.uid()::text,
    'inbox.scan_requested',
    jsonb_build_object(
      'scan_request_id', scan_request_id,
      'inbox_id', target_inbox.id,
      'scope', requested_scope
    )
  );

  return scan_request_id;
exception
  when unique_violation then
    select id into scan_request_id
    from public.inbox_scan_requests
    where inbox_connection_id = target_inbox.id
      and status in ('pending', 'processing', 'retrying')
    order by created_at
    limit 1;
    return scan_request_id;
end;
$$;

revoke all on function public.request_inbox_scan(
  uuid, public.inbox_scan_scope
) from public;
grant execute on function public.request_inbox_scan(
  uuid, public.inbox_scan_scope
) to authenticated;
