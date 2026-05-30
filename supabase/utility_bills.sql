alter table public.leads
add column if not exists utility_bill_uploaded boolean not null default false;

alter table public.leads
add column if not exists utility_bill_file_path text;

create index if not exists leads_utility_bill_uploaded_idx
on public.leads (utility_bill_uploaded);

-- Private Supabase Storage bucket for homeowner utility bills.
-- The application uploads through a server route using the service-role key.
-- Keep this bucket private; do not expose file URLs in homeowner emails.
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
