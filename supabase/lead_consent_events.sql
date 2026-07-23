-- Forward-only consent audit trail. Apply after supabase/leads.sql.
create table if not exists public.lead_consent_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  report_delivery_consent boolean not null default true,
  installer_contact_consent boolean not null default false,
  marketing_email_consent boolean not null default false,
  phone_call_consent boolean not null default false,
  text_message_consent boolean not null default false,
  automated_contact_consent boolean not null default false,
  consent_disclosure_text text not null,
  consent_disclosure_version text not null,
  consent_source text not null,
  consent_ip_hash text,
  consent_user_agent_hash text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table public.lead_consent_events enable row level security;

revoke all on table public.lead_consent_events from anon;
drop policy if exists "Allow anon select on lead_consent_events"
on public.lead_consent_events;
drop policy if exists "Allow anon insert on lead_consent_events"
on public.lead_consent_events;

create index if not exists lead_consent_events_lead_created_idx
on public.lead_consent_events (lead_id, created_at desc);
