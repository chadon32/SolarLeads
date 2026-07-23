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

create or replace function public.enforce_request_rate_limit(
  p_route text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, current_count bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  event_count bigint;
begin
  if p_limit <= 0 or p_window_seconds <= 0 then
    raise exception 'Invalid rate-limit configuration';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_route || ':' || p_key_hash, 0)
  );

  select count(*)
  into event_count
  from public.request_events
  where route = p_route
    and key_hash = p_key_hash
    and created_at >= now() - make_interval(secs => p_window_seconds);

  if event_count >= p_limit then
    return query select false, event_count;
    return;
  end if;

  insert into public.request_events (route, key_hash)
  values (p_route, p_key_hash);

  return query select true, event_count + 1;
end;
$$;

revoke all on function public.enforce_request_rate_limit(text, text, integer, integer)
from public, anon, authenticated;
grant execute on function public.enforce_request_rate_limit(text, text, integer, integer)
to service_role;

-- Retain only the period needed by the longest configured limit. Schedule this
-- statement daily with Supabase Cron or another trusted scheduler.
-- delete from public.request_events where created_at < now() - interval '8 days';

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
