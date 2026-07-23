-- Solartelligence hardening foundation migration.
-- Apply after leads.sql and security.sql. This migration is intentionally
-- forward-only: it does not delete leads or create uniqueness constraints
-- that could fail on an existing production dataset.

-- Keep updated_at correct even when a future write path forgets to set it.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
before update on public.leads
for each row
execute function public.set_updated_at();

drop trigger if exists roof_analysis_cache_set_updated_at
on public.roof_analysis_cache;
create trigger roof_analysis_cache_set_updated_at
before update on public.roof_analysis_cache
for each row
execute function public.set_updated_at();

drop trigger if exists ai_qualified_solar_leads_set_updated_at
on public.ai_qualified_solar_leads;

-- The AI-qualified table predates this trigger. Add the column only when the
-- table exists, so applying the foundation remains safe during staged setup.
alter table if exists public.ai_qualified_solar_leads
  add column if not exists updated_at timestamptz not null default now();

create trigger ai_qualified_solar_leads_set_updated_at
before update on public.ai_qualified_solar_leads
for each row
execute function public.set_updated_at();

comment on function public.set_updated_at() is
  'Maintains updated_at for mutable Solartelligence records.';

-- Preflight duplicate audit. Run this query before adding any future unique
-- normalized contact/property indexes. It is intentionally a comment so this
-- migration never fails or mutates existing duplicate data.
--
-- select normalized_email, normalized_address, count(*) as duplicate_count
-- from public.leads
-- where normalized_email is not null and normalized_address is not null
-- group by normalized_email, normalized_address
-- having count(*) > 1
-- order by duplicate_count desc;
--
-- select normalized_phone, normalized_address, count(*) as duplicate_count
-- from public.leads
-- where normalized_phone is not null and normalized_address is not null
-- group by normalized_phone, normalized_address
-- having count(*) > 1
-- order by duplicate_count desc;

-- After reviewing and merging duplicates, add these indexes in a separate
-- controlled migration. Composite keys preserve one contact across multiple
-- properties while closing the same-contact/same-property race.
--
-- create unique index leads_email_property_unique_idx
-- on public.leads (normalized_email, normalized_address)
-- where normalized_email is not null and normalized_address is not null;
--
-- create unique index leads_phone_property_unique_idx
-- on public.leads (normalized_phone, normalized_address)
-- where normalized_phone is not null and normalized_address is not null;

