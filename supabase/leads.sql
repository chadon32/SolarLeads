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
alter table public.leads add column if not exists roi_years numeric(10, 2);
alter table public.leads add column if not exists roof_area_m2 numeric(10, 2);
alter table public.leads add column if not exists usable_area_m2 numeric(10, 2);
alter table public.leads add column if not exists roof_pitch_deg numeric(10, 2);
alter table public.leads add column if not exists lat double precision;
alter table public.leads add column if not exists lng double precision;
alter table public.leads add column if not exists status text not null default 'New';
alter table public.leads add column if not exists selected_panel_brand text;
alter table public.leads add column if not exists selected_panel_model text;
alter table public.leads add column if not exists selected_panel_watts integer;
alter table public.leads add column if not exists system_cost_before_incentives numeric(12, 2);
alter table public.leads add column if not exists federal_tax_credit numeric(12, 2);
alter table public.leads add column if not exists net_system_cost numeric(12, 2);
alter table public.leads add column if not exists selected_inverter_type text;
alter table public.leads add column if not exists lead_score integer;
alter table public.leads add column if not exists lead_score_label text;
alter table public.leads add column if not exists solar_suitability_score integer;
alter table public.leads add column if not exists twenty_year_savings numeric(12, 2);
alter table public.leads add column if not exists energy_offset_pct numeric(10, 2);
alter table public.leads add column if not exists pdf_generated boolean not null default false;
alter table public.leads add column if not exists pdf_downloaded boolean not null default false;
alter table public.leads add column if not exists utility_bill_uploaded boolean not null default false;
alter table public.leads add column if not exists notes text;
alter table public.leads add column if not exists follow_up_status text not null default 'Not started';
alter table public.leads add column if not exists last_contacted_at timestamptz;
alter table public.leads add column if not exists next_follow_up_at timestamptz;
alter table public.leads add column if not exists follow_up_notes text;

alter table public.leads enable row level security;

revoke all on table public.leads from anon;
revoke usage on schema public from anon;

drop policy if exists "Allow anon insert on leads" on public.leads;

drop policy if exists "Allow anon select on leads" on public.leads;

create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_status_idx on public.leads (status);
create index if not exists leads_lead_score_idx on public.leads (lead_score desc);
create index if not exists leads_follow_up_status_idx on public.leads (follow_up_status);
create index if not exists leads_next_follow_up_at_idx on public.leads (next_follow_up_at);
create unique index if not exists leads_dedupe_idx
on public.leads (lower(email), lower(address), monthly_bill);
