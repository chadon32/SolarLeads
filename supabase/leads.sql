create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  address text not null,
  monthly_bill numeric(10, 2) not null,
  estimated_savings numeric(10, 2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.leads add column if not exists updated_at timestamptz not null default now();
alter table public.leads alter column phone drop not null;
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
alter table public.leads add column if not exists utility_bill_file_path text;
alter table public.leads add column if not exists notes text;
alter table public.leads add column if not exists follow_up_status text not null default 'Not started';
alter table public.leads add column if not exists last_contacted_at timestamptz;
alter table public.leads add column if not exists next_follow_up_at timestamptz;
alter table public.leads add column if not exists follow_up_notes text;
alter table public.leads add column if not exists quote_requested boolean not null default false;
alter table public.leads add column if not exists quote_requested_at timestamptz;
alter table public.leads add column if not exists preferred_contact_method text;
alter table public.leads add column if not exists best_time_to_contact text;
alter table public.leads add column if not exists quote_notes text;
alter table public.leads add column if not exists email_sent_at timestamptz;
alter table public.leads add column if not exists email_error text;
alter table public.leads add column if not exists notification_status text;
alter table public.leads add column if not exists battery_added boolean not null default false;
alter table public.leads add column if not exists battery_brand text;
alter table public.leads add column if not exists battery_model text;
alter table public.leads add column if not exists battery_cost integer;
alter table public.leads add column if not exists referral_code text;
alter table public.leads add column if not exists referred_by text;
alter table public.leads add column if not exists report_pdf_url text;
alter table public.leads add column if not exists report_snapshot jsonb;
alter table public.leads add column if not exists normalized_email text;
alter table public.leads add column if not exists normalized_phone text;
alter table public.leads add column if not exists normalized_address text;
alter table public.leads add column if not exists electric_bill_range text;
alter table public.leads add column if not exists owns_home text;
alter table public.leads add column if not exists solar_timeline text;
alter table public.leads add column if not exists report_delivery_consent_at timestamptz;
alter table public.leads add column if not exists installer_contact_consent boolean not null default false;
alter table public.leads add column if not exists installer_contact_consent_at timestamptz;
alter table public.leads add column if not exists marketing_email_consent boolean not null default false;
alter table public.leads add column if not exists phone_call_consent boolean not null default false;
alter table public.leads add column if not exists text_message_consent boolean not null default false;
alter table public.leads add column if not exists automated_contact_consent boolean not null default false;
alter table public.leads add column if not exists consent_disclosure_text text;
alter table public.leads add column if not exists consent_disclosure_version text;
alter table public.leads add column if not exists consent_source text;
alter table public.leads add column if not exists consent_ip_hash text;
alter table public.leads add column if not exists consent_user_agent_hash text;
alter table public.leads add column if not exists consent_revoked_at timestamptz;

alter table public.leads enable row level security;

revoke all on table public.leads from anon;
revoke usage on schema public from anon;

drop policy if exists "Allow anon insert on leads" on public.leads;

drop policy if exists "Allow anon select on leads" on public.leads;

create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_updated_at_idx on public.leads (updated_at desc);
create index if not exists leads_status_idx on public.leads (status);
create index if not exists leads_lead_score_idx on public.leads (lead_score desc);
create index if not exists leads_utility_bill_uploaded_idx on public.leads (utility_bill_uploaded);
create index if not exists leads_follow_up_status_idx on public.leads (follow_up_status);
create index if not exists leads_next_follow_up_at_idx on public.leads (next_follow_up_at);
create index if not exists leads_quote_requested_idx on public.leads (quote_requested, quote_requested_at desc);
create index if not exists leads_referred_by_idx on public.leads (referred_by);
create index if not exists leads_normalized_email_idx on public.leads (normalized_email);
create index if not exists leads_normalized_phone_idx on public.leads (normalized_phone);
create index if not exists leads_normalized_address_idx on public.leads (normalized_address);
create index if not exists leads_installer_contact_consent_idx
on public.leads (installer_contact_consent, created_at desc);
create unique index if not exists leads_referral_code_idx on public.leads (referral_code)
where referral_code is not null;
create unique index if not exists leads_dedupe_idx
on public.leads (lower(email), lower(address), monthly_bill);

-- Recommended after reviewing and merging existing duplicate rows. Composite
-- uniqueness allows one homeowner to analyze multiple properties while closing
-- the concurrent-submit race for the same contact and property.
-- create unique index if not exists leads_email_property_unique_idx
-- on public.leads (normalized_email, normalized_address)
-- where normalized_email is not null and normalized_address is not null;
-- create unique index if not exists leads_phone_property_unique_idx
-- on public.leads (normalized_phone, normalized_address)
-- where normalized_phone is not null and normalized_address is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'leads_monthly_bill_range_check'
  ) then
    alter table public.leads
      add constraint leads_monthly_bill_range_check
      check (monthly_bill > 0 and monthly_bill <= 5000) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'leads_panel_count_range_check'
  ) then
    alter table public.leads
      add constraint leads_panel_count_range_check
      check (panel_count is null or (panel_count >= 0 and panel_count <= 500)) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'leads_energy_offset_range_check'
  ) then
    alter table public.leads
      add constraint leads_energy_offset_range_check
      check (energy_offset_pct is null or (energy_offset_pct >= 0 and energy_offset_pct <= 100)) not valid;
  end if;
end $$;

-- Optional private utility bill storage bucket.
-- The app uploads with the Supabase service-role key through /api/utility-bills.
-- Do not add public read policies for this bucket. Admin downloads should use
-- short-lived signed URLs generated by /api/utility-bills/download.
-- Cleanup: call POST /api/utility-bills/cleanup with DASHBOARD_ACCESS_TOKEN
-- from a scheduler to remove pending uploads older than 24 hours.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'utility-bills',
  'utility-bills',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
