alter table public.profiles
  add constraint profiles_id_auth_users_fk
  foreign key (id) references auth.users(id) on delete cascade;

insert into storage.buckets (id, name, public, file_size_limit)
values ('cargo-email-raw', 'cargo-email-raw', false, 52428800)
on conflict (id) do nothing;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name),
        updated_at = now();
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute procedure public.handle_new_auth_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles',
    'organizations',
    'inbox_connections',
    'inbound_events',
    'email_threads',
    'emails',
    'contacts',
    'tickets',
    'outbox_jobs'
  ]
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute procedure public.set_updated_at()',
      table_name || '_set_updated_at',
      table_name
    );
  end loop;
end;
$$;

create or replace function public.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members
    where organization_id = target_organization_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.has_organization_role(
  target_organization_id uuid,
  allowed_roles public.member_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members
    where organization_id = target_organization_id
      and user_id = auth.uid()
      and role = any(allowed_roles)
  );
$$;

revoke all on function public.is_organization_member(uuid) from public;
revoke all on function public.has_organization_role(uuid, public.member_role[]) from public;
grant execute on function public.is_organization_member(uuid) to authenticated;
grant execute on function public.has_organization_role(uuid, public.member_role[]) to authenticated;

create or replace function public.create_workspace(
  workspace_name text,
  workspace_slug text,
  workspace_company_type public.company_type,
  workspace_timezone text,
  workspace_modes text[],
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
    name,
    slug,
    company_type,
    timezone,
    modes,
    onboarding_completed_at
  )
  values (
    trim(workspace_name),
    lower(trim(workspace_slug)),
    workspace_company_type,
    workspace_timezone,
    workspace_modes,
    now()
  )
  returning id into created_organization_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (created_organization_id, auth.uid(), 'owner');

  insert into public.inbox_connections (
    organization_id,
    provider,
    address,
    status,
    config
  )
  values (
    created_organization_id,
    'local_mailpit',
    lower(trim(workspace_inbox_address)),
    'connected',
    jsonb_build_object('mode', 'local')
  );

  insert into public.audit_events (
    organization_id,
    actor_type,
    actor_id,
    event_type,
    data
  )
  values (
    created_organization_id,
    'user',
    auth.uid()::text,
    'workspace.created',
    jsonb_build_object('name', trim(workspace_name))
  );

  return created_organization_id;
end;
$$;

revoke all on function public.create_workspace(
  text,
  text,
  public.company_type,
  text,
  text[],
  text
) from public;
grant execute on function public.create_workspace(
  text,
  text,
  public.company_type,
  text,
  text[],
  text
) to authenticated;

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.inbox_connections enable row level security;
alter table public.mailbox_cursors enable row level security;
alter table public.inbound_events enable row level security;
alter table public.email_threads enable row level security;
alter table public.emails enable row level security;
alter table public.contacts enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_emails enable row level security;
alter table public.ticket_status_history enable row level security;
alter table public.ai_runs enable row level security;
alter table public.outbox_jobs enable row level security;
alter table public.audit_events enable row level security;

create policy profiles_select_self_or_colleague
on public.profiles for select
to authenticated
using (
  id = auth.uid()
  or exists (
    select 1
    from public.organization_members mine
    join public.organization_members theirs
      on theirs.organization_id = mine.organization_id
    where mine.user_id = auth.uid()
      and theirs.user_id = profiles.id
  )
);

create policy profiles_update_self
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy organizations_member_access
on public.organizations for select
to authenticated
using (public.is_organization_member(id));

create policy organizations_admin_update
on public.organizations for update
to authenticated
using (public.has_organization_role(id, array['owner', 'admin']::public.member_role[]))
with check (public.has_organization_role(id, array['owner', 'admin']::public.member_role[]));

create policy organization_members_member_select
on public.organization_members for select
to authenticated
using (public.is_organization_member(organization_id));

create policy organization_members_admin_write
on public.organization_members for all
to authenticated
using (
  public.has_organization_role(
    organization_id,
    array['owner', 'admin']::public.member_role[]
  )
)
with check (
  public.has_organization_role(
    organization_id,
    array['owner', 'admin']::public.member_role[]
  )
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'inbox_connections',
    'inbound_events',
    'email_threads',
    'emails',
    'contacts',
    'tickets',
    'ticket_status_history',
    'ai_runs',
    'outbox_jobs',
    'audit_events'
  ]
  loop
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id))',
      table_name || '_organization_access',
      table_name
    );
  end loop;
end;
$$;

create policy mailbox_cursors_organization_access
on public.mailbox_cursors for all
to authenticated
using (
  exists (
    select 1 from public.inbox_connections
    where inbox_connections.id = mailbox_cursors.inbox_connection_id
      and public.is_organization_member(inbox_connections.organization_id)
  )
)
with check (
  exists (
    select 1 from public.inbox_connections
    where inbox_connections.id = mailbox_cursors.inbox_connection_id
      and public.is_organization_member(inbox_connections.organization_id)
  )
);

create policy ticket_emails_organization_access
on public.ticket_emails for all
to authenticated
using (
  exists (
    select 1 from public.tickets
    where tickets.id = ticket_emails.ticket_id
      and public.is_organization_member(tickets.organization_id)
  )
)
with check (
  exists (
    select 1 from public.tickets
    where tickets.id = ticket_emails.ticket_id
      and public.is_organization_member(tickets.organization_id)
  )
);

revoke update, delete on public.audit_events from authenticated;
revoke update, delete on public.ai_runs from authenticated;
revoke update, delete on public.ticket_status_history from authenticated;

create policy cargo_email_raw_member_read
on storage.objects for select
to authenticated
using (
  bucket_id = 'cargo-email-raw'
  and public.is_organization_member((storage.foldername(name))[1]::uuid)
);

create policy cargo_email_raw_service_write
on storage.objects for all
to service_role
using (bucket_id = 'cargo-email-raw')
with check (bucket_id = 'cargo-email-raw');
