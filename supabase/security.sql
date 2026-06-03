create table if not exists public.request_events (
  id uuid primary key default gen_random_uuid(),
  route text not null,
  key_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.roof_analysis_cache (
  address_key text primary key,
  address text not null,
  normalized_address text,
  place_id text,
  lat double precision not null,
  lng double precision not null,
  analysis_version integer not null default 1,
  analysis jsonb not null,
  report_snapshot jsonb,
  panel_layout_snapshot jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.roof_analysis_cache
  add column if not exists normalized_address text;

alter table public.roof_analysis_cache
  add column if not exists place_id text;

alter table public.roof_analysis_cache
  add column if not exists report_snapshot jsonb;

alter table public.roof_analysis_cache
  add column if not exists panel_layout_snapshot jsonb;

alter table public.roof_analysis_cache
  add column if not exists expires_at timestamptz;

alter table public.request_events enable row level security;
alter table public.roof_analysis_cache enable row level security;

revoke all on table public.request_events from anon;
revoke all on table public.roof_analysis_cache from anon;
revoke usage on schema public from anon;

create index if not exists request_events_route_hash_created_idx
on public.request_events (route, key_hash, created_at desc);

create index if not exists request_events_created_at_idx
on public.request_events (created_at desc);

create index if not exists roof_analysis_cache_updated_at_idx
on public.roof_analysis_cache (updated_at desc);

create index if not exists roof_analysis_cache_normalized_address_idx
on public.roof_analysis_cache (normalized_address, updated_at desc);

create index if not exists roof_analysis_cache_expires_at_idx
on public.roof_analysis_cache (expires_at);

alter table public.lead_followups
  add column if not exists attempts integer not null default 0;

alter table public.lead_followups
  add column if not exists processed_at timestamptz;

alter table public.lead_followups
  add column if not exists delivery_message text;

create index if not exists lead_followups_status_created_idx
on public.lead_followups (status, scheduled_for);
