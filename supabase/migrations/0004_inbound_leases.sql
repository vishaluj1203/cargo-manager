alter table public.inbound_events
  add column locked_at timestamp with time zone,
  add column locked_by text;

create index inbound_events_lease_idx
  on public.inbound_events (status, locked_at)
  where status = 'processing';
