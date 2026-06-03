This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Environment Variables

Create a `.env.local` file with:

```bash
GOOGLE_PLACES_API_KEY=your_google_places_api_key_here
GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here
GOOGLE_SOLAR_API_KEY=your_google_solar_api_key_here
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_maps_browser_key_here
# Optional legacy alias for local experiments only; server-side key above is preferred.
NEXT_PUBLIC_GOOGLE_SOLAR_API_KEY=your_google_solar_api_key_here
NEXT_PUBLIC_SITE_URL=https://your-domain.com
REPORT_SIGNING_SECRET=your_report_link_signing_secret_here
UTILITY_BILL_UPLOAD_SECRET=your_utility_bill_claim_secret_here
RATE_LIMIT_SECRET=your_rate_limit_secret_here
FOLLOW_UP_PROCESS_SECRET=your_follow_up_process_secret_here
SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here
RESEND_API_KEY=your_resend_api_key_here
FROM_EMAIL=reports@solartelligence.com
RESEND_FROM_EMAIL=reports@solartelligence.com
ADMIN_EMAIL=owner@yourdomain.com
DASHBOARD_ACCESS_TOKEN=your_dashboard_token_here
```

For Vercel, add the same values in the project environment settings. Keep `GOOGLE_MAPS_API_KEY`, `GOOGLE_PLACES_API_KEY`, `GOOGLE_SOLAR_API_KEY`, the service role key, report signing secret, rate limit secret, follow-up process secret, dashboard access token, and Resend values server-side only. `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is the browser key used only for rendering the satellite map overlays.

Lead notifications are sent server-side after Supabase confirms a new lead. Resend sends the homeowner report email and the optional admin lead email. If `RESEND_API_KEY` is missing in development, the app logs the email payload and still lets the homeowner reach the success screen. `FROM_EMAIL` and `ADMIN_EMAIL` are preferred; `RESEND_FROM_EMAIL` and `OWNER_EMAIL` remain supported for existing deployments. `FROM_EMAIL` should point to a verified Resend sender such as `reports@solartelligence.com`.

To verify production notifications without creating a lead, call the protected test endpoint with your dashboard token:

```bash
curl -X POST "https://your-domain.com/api/notifications/test?token=$DASHBOARD_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel":"email","testEmail":"you@example.com"}'
```

The response reports safe env status, whether email was attempted, the Resend message id, and sanitized provider errors. It never returns API keys. If email fails, check that `RESEND_API_KEY` is set in the Vercel Production environment, that `FROM_EMAIL`/`RESEND_FROM_EMAIL` is a verified Resend sender or verified domain, and that the deployment was redeployed after env changes. Inspect Vercel Function logs for `[notification-email:*]` and `[lead-notifications:*]` entries.

For per-lead notification diagnostics, run the latest `supabase/leads.sql` migration so the `leads` table has `email_sent_at`, `email_error`, and `notification_status`.

Production report links fail closed unless `REPORT_SIGNING_SECRET` is configured. The dashboard also fails closed in production unless `DASHBOARD_ACCESS_TOKEN` is configured, because it can expose homeowner lead data.

Report PDF URLs are signed with `exp` and `token` query parameters when `REPORT_SIGNING_SECRET` is present. In production, `/api/report/pdf` and `/report/[leadId]` reject unsigned, expired, invalid, or misconfigured public report links. Dashboard admins can still view/download reports by using the protected dashboard URL with `DASHBOARD_ACCESS_TOKEN`.

Dashboard unlock forms create a signed HttpOnly `azsa_dashboard_session` cookie so day-to-day admin access does not keep the token in the URL. Dashboard APIs also accept the token via `Authorization: Bearer <DASHBOARD_ACCESS_TOKEN>`, `x-dashboard-token`, or a `token` query parameter for automation/backward compatibility. This protects lead status changes, manual follow-up sends, utility bill viewing, and dashboard PDF downloads.

The rooftop analysis pipeline now uses Google Geocoding plus the Google Maps Platform Solar API by default. The analysis is live per address, so every selected rooftop pulls real Solar API values for panel count, roof area, pitch, and energy estimates.

Run the SQL files in `supabase/` to create the `leads`, `lead_followups`, `request_events`, and `roof_analysis_cache` tables before testing the dashboard, rooftop analysis cache, or follow-up flow.

Utility bill uploads are stored in the private `utility-bills` bucket. The browser receives only a short-lived signed upload claim, never the raw Supabase object path. New uploads land under `pending/YYYY-MM-DD/` and are moved to `leads/{leadId}/utility-bill.ext` after a lead is saved. Keep the bucket private. Do not create public storage policies or expose storage object paths in emails, CSVs, dashboard markup, or homeowner pages. A dashboard-protected cleanup route is available at `POST /api/utility-bills/cleanup` to remove pending uploads older than 24 hours; schedule it daily with the dashboard token.

The follow-up processor route is ready for a scheduler call. If you use Vercel Cron or another job runner, send `FOLLOW_UP_PROCESS_SECRET` as a bearer token or `x-process-secret` header when calling `POST /api/follow-ups/process`.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Before deploying, make sure `GOOGLE_PLACES_API_KEY`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_SOLAR_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `REPORT_SIGNING_SECRET`, `DASHBOARD_ACCESS_TOKEN`, `RATE_LIMIT_SECRET`, `FOLLOW_UP_PROCESS_SECRET`, and any Resend variables are set in Vercel. `UTILITY_BILL_UPLOAD_SECRET` is recommended; if omitted, utility bill upload claims fall back to existing server-only secrets.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
