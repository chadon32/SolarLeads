create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text not null,
  address text not null,
  monthly_bill numeric(10, 2) not null,
  estimated_savings numeric(10, 2) not null,
  created_at timestamptz not null default now()
);

alter table public.leads add column if not exists panel_count integer;
alter table public.leads add column if not exists system_size_kw numeric(10, 2);
alter table public.leads add column if not exists annual_savings numeric(10, 2);
alter table public.leads add column if not exists monthly_savings numeric(10, 2);
alter table public.leads add column if not exists annual_energy_kwh numeric(12, 2);
alter table public.leads add column if not exists roof_area_m2 numeric(10, 2);
alter table public.leads add column if not exists usable_area_m2 numeric(10, 2);
alter table public.leads add column if not exists roof_pitch_deg numeric(10, 2);
alter table public.leads add column if not exists lat double precision;
alter table public.leads add column if not exists lng double precision;

alter table public.leads enable row level security;

revoke all on table public.leads from anon;
revoke usage on schema public from anon;

drop policy if exists "Allow anon insert on leads" on public.leads;

drop policy if exists "Allow anon select on leads" on public.leads;

create index if not exists leads_created_at_idx on public.leads (created_at desc);
create unique index if not exists leads_dedupe_idx
on public.leads (lower(email), lower(address), monthly_bill);
