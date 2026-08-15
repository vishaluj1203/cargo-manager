create table public.inbox_credentials (
  inbox_connection_id uuid primary key
    references public.inbox_connections(id) on delete cascade,
  encrypted_refresh_token text not null,
  granted_scopes text[] not null default array[]::text[],
  token_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.inbox_credentials enable row level security;
revoke all on table public.inbox_credentials from anon, authenticated;
grant all on table public.inbox_credentials to service_role;

alter table public.outbox_jobs
  add column inbox_connection_id uuid
  references public.inbox_connections(id) on delete restrict;

create index outbox_jobs_inbox_idx
  on public.outbox_jobs(inbox_connection_id);

create or replace function public.assign_outbox_inbox()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.inbox_connection_id is null then
    select id into new.inbox_connection_id
    from public.inbox_connections
    where organization_id = new.organization_id
      and status = 'connected'
    order by case provider when 'gmail' then 0 else 1 end, created_at
    limit 1;
  end if;

  if new.inbox_connection_id is null then
    raise exception 'No connected inbox is available';
  end if;
  return new;
end;
$$;

create trigger outbox_jobs_assign_inbox
before insert on public.outbox_jobs
for each row execute function public.assign_outbox_inbox();

create or replace function public.create_workspace_v2(
  workspace_name text,
  workspace_slug text,
  workspace_company_type public.company_type,
  workspace_timezone text,
  workspace_modes text[],
  workspace_inbox_provider public.inbox_provider,
  workspace_inbox_address text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  created_organization_id uuid;
  current_email text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if length(trim(workspace_name)) < 2 then
    raise exception 'Workspace name is required';
  end if;
  if coalesce(array_length(workspace_modes, 1), 0) = 0 then
    raise exception 'At least one transport mode is required';
  end if;

  select email into current_email from auth.users where id = auth.uid();
  insert into public.profiles (id, email)
  values (auth.uid(), coalesce(current_email, ''))
  on conflict (id) do nothing;

  insert into public.organizations (
    name, slug, company_type, timezone, modes, onboarding_completed_at
  ) values (
    trim(workspace_name), lower(trim(workspace_slug)), workspace_company_type,
    workspace_timezone, workspace_modes, now()
  ) returning id into created_organization_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (created_organization_id, auth.uid(), 'owner');

  if workspace_inbox_provider is not null
     and nullif(trim(workspace_inbox_address), '') is not null then
    insert into public.inbox_connections (
      organization_id, provider, address, status, config
    ) values (
      created_organization_id,
      workspace_inbox_provider,
      lower(trim(workspace_inbox_address)),
      case when workspace_inbox_provider = 'local_mailpit'
        then 'connected'::public.connection_status
        else 'pending'::public.connection_status
      end,
      jsonb_build_object('created_during_onboarding', true)
    );
  end if;

  insert into public.audit_events (
    organization_id, actor_type, actor_id, event_type, data
  ) values (
    created_organization_id, 'user', auth.uid()::text,
    'workspace.created', jsonb_build_object('name', trim(workspace_name))
  );
  return created_organization_id;
end;
$$;

revoke all on function public.create_workspace_v2(
  text, text, public.company_type, text, text[], public.inbox_provider, text
) from public;
grant execute on function public.create_workspace_v2(
  text, text, public.company_type, text, text[], public.inbox_provider, text
) to authenticated;

create or replace function public.connect_gmail_inbox(
  target_organization_id uuid,
  inbox_address text,
  encrypted_refresh_token text,
  granted_scopes text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  connected_inbox_id uuid;
begin
  if not public.has_organization_role(
    target_organization_id,
    array['owner', 'admin']::public.member_role[]
  ) then
    raise exception 'Organization not found or insufficient permission';
  end if;
  if nullif(trim(inbox_address), '') is null
     or nullif(trim(encrypted_refresh_token), '') is null then
    raise exception 'Gmail address and refresh token are required';
  end if;

  insert into public.inbox_connections (
    organization_id, provider, address, status, config, last_synced_at
  ) values (
    target_organization_id, 'gmail', lower(trim(inbox_address)), 'connected',
    jsonb_build_object('oauth', true), null
  )
  on conflict (organization_id, address) do update
    set provider = 'gmail', status = 'connected',
        config = jsonb_build_object('oauth', true), updated_at = now()
  returning id into connected_inbox_id;

  insert into public.inbox_credentials (
    inbox_connection_id, encrypted_refresh_token, granted_scopes
  ) values (
    connected_inbox_id, encrypted_refresh_token, granted_scopes
  )
  on conflict (inbox_connection_id) do update
    set encrypted_refresh_token = excluded.encrypted_refresh_token,
        granted_scopes = excluded.granted_scopes,
        token_version = inbox_credentials.token_version + 1,
        updated_at = now();

  update public.inbox_connections
  set status = 'disconnected', updated_at = now()
  where organization_id = target_organization_id
    and provider = 'local_mailpit'
    and status = 'connected';

  insert into public.audit_events (
    organization_id, actor_type, actor_id, event_type, data
  ) values (
    target_organization_id, 'user', auth.uid()::text, 'inbox.connected',
    jsonb_build_object('inbox_id', connected_inbox_id, 'provider', 'gmail',
                       'address', lower(trim(inbox_address)))
  );
  return connected_inbox_id;
end;
$$;

revoke all on function public.connect_gmail_inbox(uuid, text, text, text[]) from public;
grant execute on function public.connect_gmail_inbox(uuid, text, text, text[]) to authenticated;

create or replace function public.disconnect_gmail_inbox(target_inbox_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_inbox public.inbox_connections%rowtype;
begin
  select * into target_inbox from public.inbox_connections
  where id = target_inbox_id and provider = 'gmail';
  if target_inbox.id is null or not public.has_organization_role(
    target_inbox.organization_id,
    array['owner', 'admin']::public.member_role[]
  ) then
    raise exception 'Inbox not found or insufficient permission';
  end if;

  delete from public.inbox_credentials where inbox_connection_id = target_inbox.id;
  update public.inbox_connections
  set status = 'disconnected', updated_at = now()
  where id = target_inbox.id;

  insert into public.audit_events (
    organization_id, actor_type, actor_id, event_type, data
  ) values (
    target_inbox.organization_id, 'user', auth.uid()::text,
    'inbox.disconnected', jsonb_build_object('inbox_id', target_inbox.id)
  );
end;
$$;

revoke all on function public.disconnect_gmail_inbox(uuid) from public;
grant execute on function public.disconnect_gmail_inbox(uuid) to authenticated;
