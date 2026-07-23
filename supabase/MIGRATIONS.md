# Supabase Migration Order

Apply the SQL files in this order from the Supabase SQL editor or a trusted
deployment pipeline:

1. `leads.sql`
2. `security.sql`
3. `utility_bills.sql`
4. `lead_followups.sql`
5. `lead_consent_events.sql`
6. `ai_qualified_solar_leads.sql`
7. `20260715_hardening_foundation.sql`

All files are intended to be repeatable. The hardening foundation migration
adds database-side `updated_at` triggers and does not delete or merge existing
leads.

## Duplicate preflight

Before enabling the commented unique indexes in
`20260715_hardening_foundation.sql`, run the two duplicate-audit queries in
that file. Resolve any existing duplicate contact/property rows through the
normal lead workflow first. Do not add a unique index blindly to production.

## Production safety

Run migrations with a trusted Supabase role only. Keep the `leads`, consent,
follow-up, cache, and utility-bill tables private with RLS enabled. The app
uses the service role server-side; browser clients must not receive the
service-role key.
