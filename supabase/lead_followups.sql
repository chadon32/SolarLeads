create table if not exists public.lead_followups (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  step_order integer not null,
  channel text not null,
  title text not null,
  body text not null,
  scheduled_for timestamptz not null,
  status text not null default 'queued',
  created_at timestamptz not null default now()
);

alter table public.lead_followups enable row level security;

revoke all on table public.lead_followups from anon;
revoke usage on schema public from anon;

drop policy if exists "Allow anon select on lead_followups" on public.lead_followups;

create unique index if not exists lead_followups_unique_step_idx
on public.lead_followups (lead_id, step_order);

create index if not exists lead_followups_scheduled_for_idx
on public.lead_followups (scheduled_for desc);

alter table public.lead_followups
  add column if not exists attempts integer not null default 0;

alter table public.lead_followups
  add column if not exists processed_at timestamptz;

alter table public.lead_followups
  add column if not exists delivery_message text;

create index if not exists lead_followups_status_scheduled_idx
on public.lead_followups (status, scheduled_for);
