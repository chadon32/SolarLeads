create table if not exists public.request_events (
  id uuid primary key default gen_random_uuid(),
  route text not null,
  key_hash text not null,
  created_at timestamptz not null default now()
);

alter table public.request_events enable row level security;

revoke all on table public.request_events from anon;
revoke usage on schema public from anon;

create index if not exists request_events_route_hash_created_idx
on public.request_events (route, key_hash, created_at desc);

create index if not exists request_events_created_at_idx
on public.request_events (created_at desc);

alter table public.lead_followups
  add column if not exists attempts integer not null default 0;

alter table public.lead_followups
  add column if not exists processed_at timestamptz;

alter table public.lead_followups
  add column if not exists delivery_message text;

create index if not exists lead_followups_status_created_idx
on public.lead_followups (status, scheduled_for);
