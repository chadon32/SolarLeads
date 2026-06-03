-- AI-qualified lead marketplace foundation.
-- This table is intentionally separate from public.leads so the current
-- homeowner intake flow remains stable while installer-facing qualification
-- and exclusivity workflows can evolve independently.

create table if not exists public.ai_qualified_solar_leads (
  lead_id uuid primary key default gen_random_uuid(),
  report_id uuid not null default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  address text not null,
  owns_home boolean,
  monthly_electric_bill_range text,
  solar_timeline text,
  preferred_contact_method text,
  roof_suitability_score integer,
  solar_readiness_score integer,
  lead_score_internal integer,
  lead_temperature_internal text,
  panel_count integer,
  system_size_kw numeric(10, 2),
  annual_savings numeric(12, 2),
  monthly_savings numeric(12, 2),
  energy_offset numeric(10, 2),
  solar_ready_area_sqft numeric(12, 2),
  report_pdf_url text,
  exclusive_status text not null default 'available',
  installer_claimed_by uuid,
  created_at timestamptz not null default now(),
  constraint ai_qualified_solar_leads_report_id_key unique (report_id),
  constraint ai_qualified_solar_leads_email_format_chk
    check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint ai_qualified_solar_leads_monthly_bill_range_chk
    check (
      monthly_electric_bill_range is null
      or monthly_electric_bill_range in (
        'under_150',
        '150_250',
        '250_400',
        '400_600',
        'over_600',
        'unknown'
      )
    ),
  constraint ai_qualified_solar_leads_solar_timeline_chk
    check (
      solar_timeline is null
      or solar_timeline in (
        'immediately',
        '1_3_months',
        '3_6_months',
        '6_12_months',
        'researching'
      )
    ),
  constraint ai_qualified_solar_leads_preferred_contact_method_chk
    check (
      preferred_contact_method is null
      or preferred_contact_method in ('phone', 'text', 'email')
    ),
  constraint ai_qualified_solar_leads_temperature_chk
    check (
      lead_temperature_internal is null
      or lead_temperature_internal in (
        'Cold Lead',
        'Warm Lead',
        'Qualified Lead',
        'Hot Lead',
        'Premium Lead'
      )
    ),
  constraint ai_qualified_solar_leads_exclusive_status_chk
    check (
      exclusive_status in (
        'available',
        'reserved',
        'claimed',
        'released',
        'expired'
      )
    ),
  constraint ai_qualified_solar_leads_score_ranges_chk
    check (
      (roof_suitability_score is null or roof_suitability_score between 0 and 100)
      and (solar_readiness_score is null or solar_readiness_score between 0 and 100)
      and (lead_score_internal is null or lead_score_internal between 0 and 100)
    ),
  constraint ai_qualified_solar_leads_nonnegative_metrics_chk
    check (
      (panel_count is null or panel_count >= 0)
      and (system_size_kw is null or system_size_kw >= 0)
      and (annual_savings is null or annual_savings >= 0)
      and (monthly_savings is null or monthly_savings >= 0)
      and (energy_offset is null or energy_offset >= 0)
      and (solar_ready_area_sqft is null or solar_ready_area_sqft >= 0)
    )
);

alter table public.ai_qualified_solar_leads enable row level security;

revoke all on table public.ai_qualified_solar_leads from anon;

create index if not exists ai_qualified_solar_leads_created_at_idx
on public.ai_qualified_solar_leads (created_at desc);

create index if not exists ai_qualified_solar_leads_temperature_idx
on public.ai_qualified_solar_leads (lead_temperature_internal, lead_score_internal desc);

create index if not exists ai_qualified_solar_leads_exclusive_status_idx
on public.ai_qualified_solar_leads (exclusive_status, created_at desc);

create index if not exists ai_qualified_solar_leads_installer_claimed_by_idx
on public.ai_qualified_solar_leads (installer_claimed_by)
where installer_claimed_by is not null;

create index if not exists ai_qualified_solar_leads_report_id_idx
on public.ai_qualified_solar_leads (report_id);
