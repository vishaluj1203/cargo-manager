alter type public.inbound_status add value if not exists 'ignored';

alter table public.inbound_events
  add column raw_object_path text;

create table public.email_classification_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  inbound_event_id uuid not null unique
    references public.inbound_events(id) on delete cascade,
  status public.ai_run_status not null default 'succeeded',
  provider text not null,
  model text not null,
  prompt_version text not null,
  schema_version text not null,
  input_tokens integer,
  output_tokens integer,
  classification jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index email_classification_runs_org_idx
  on public.email_classification_runs(organization_id, created_at desc);

alter table public.email_classification_runs enable row level security;
grant select on table public.email_classification_runs to authenticated;
grant all on table public.email_classification_runs to service_role;
revoke insert, update, delete on table public.email_classification_runs
  from anon, authenticated;

create policy "Members can view email classification runs"
on public.email_classification_runs for select
to authenticated
using (public.is_organization_member(organization_id));

create or replace function public.ensure_inbox_enquiry_detection_policy()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  existing_policy jsonb;
  default_policy constant jsonb := jsonb_build_object(
    'minimumConfidence', 0.75,
    'acceptExistingQuoteFollowUps', true,
    'uncertainAction', 'review'
  );
begin
  existing_policy := new.config -> 'enquiryDetection';
  if existing_policy is null and tg_op = 'UPDATE' then
    existing_policy := old.config -> 'enquiryDetection';
  end if;
  new.config := jsonb_set(
    coalesce(new.config, '{}'::jsonb),
    '{enquiryDetection}',
    coalesce(existing_policy, default_policy),
    true
  );
  return new;
end;
$$;

create trigger inbox_connections_enquiry_detection_policy
before insert or update of config on public.inbox_connections
for each row execute function public.ensure_inbox_enquiry_detection_policy();

update public.inbox_connections
set config = jsonb_set(
  config,
  '{enquiryDetection}',
  coalesce(
    config -> 'enquiryDetection',
    jsonb_build_object(
      'minimumConfidence', 0.75,
      'acceptExistingQuoteFollowUps', true,
      'uncertainAction', 'review'
    )
  ),
  true
), updated_at = now();

create or replace function public.update_inbox_enquiry_policy(
  target_inbox_id uuid,
  minimum_confidence real,
  accept_existing_quote_follow_ups boolean,
  uncertain_action text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_inbox public.inbox_connections%rowtype;
  policy jsonb;
begin
  select * into target_inbox
  from public.inbox_connections
  where id = target_inbox_id;

  if target_inbox.id is null or not public.has_organization_role(
    target_inbox.organization_id,
    array['owner', 'admin']::public.member_role[]
  ) then
    raise exception 'Inbox not found or insufficient permission';
  end if;
  if minimum_confidence < 0.5 or minimum_confidence > 0.99 then
    raise exception 'Minimum confidence must be between 0.50 and 0.99';
  end if;
  if uncertain_action not in ('review', 'ignore') then
    raise exception 'Uncertain action must be review or ignore';
  end if;

  policy := jsonb_build_object(
    'minimumConfidence', minimum_confidence,
    'acceptExistingQuoteFollowUps', accept_existing_quote_follow_ups,
    'uncertainAction', uncertain_action
  );

  update public.inbox_connections
  set config = jsonb_set(config, '{enquiryDetection}', policy, true),
      updated_at = now()
  where id = target_inbox.id;

  insert into public.audit_events (
    organization_id, actor_type, actor_id, event_type, data
  ) values (
    target_inbox.organization_id,
    'user',
    auth.uid()::text,
    'inbox.enquiry_policy_updated',
    jsonb_build_object('inbox_id', target_inbox.id, 'policy', policy)
  );
end;
$$;

revoke all on function public.update_inbox_enquiry_policy(
  uuid, real, boolean, text
) from public;
grant execute on function public.update_inbox_enquiry_policy(
  uuid, real, boolean, text
) to authenticated;
