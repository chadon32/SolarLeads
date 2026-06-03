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
NEXT_PUBLIC_SITE_URL=https://your-domain.com
NEXT_PUBLIC_TURNSTILE_SITE_KEY=your_cloudflare_turnstile_site_key_here
REPORT_SIGNING_SECRET=your_report_link_signing_secret_here
UTILITY_BILL_UPLOAD_SECRET=your_utility_bill_claim_secret_here
RATE_LIMIT_SECRET=your_rate_limit_secret_here
FOLLOW_UP_PROCESS_SECRET=your_follow_up_process_secret_here
TURNSTILE_SECRET_KEY=your_cloudflare_turnstile_secret_key_here
SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here
RESEND_API_KEY=your_resend_api_key_here
FROM_EMAIL=reports@solartelligence.com
RESEND_FROM_EMAIL=reports@solartelligence.com
ADMIN_EMAIL=owner@yourdomain.com
DASHBOARD_ACCESS_TOKEN=your_dashboard_token_here
ROOF_ANALYSIS_CACHE_TTL_DAYS=30
DISABLE_SOLAR_API_CALLS=false
DISABLE_PDF_GENERATION=false
DISABLE_EMAIL_SENDING=false
MAINTENANCE_MODE=false
```

For Vercel, add the same values in the project environment settings. Keep `GOOGLE_MAPS_API_KEY`, `GOOGLE_PLACES_API_KEY`, `GOOGLE_SOLAR_API_KEY`, the service role key, report signing secret, rate limit secret, follow-up process secret, dashboard access token, Turnstile secret, and Resend values server-side only. `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is the browser key used only for rendering the satellite map overlays. Do not create or deploy a `NEXT_PUBLIC_GOOGLE_SOLAR_API_KEY`; Solar API calls must stay behind server routes.

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

## Abuse protection and API credit controls

Paid services are protected behind server routes and route-specific limits. Current defaults:

- `POST /api/leads`: 3 submissions per IP per hour, plus 5 per normalized email per day, 5 per normalized phone per day, and 8 per normalized address per day.
- `POST /api/analyze-roof`: 5 requests per IP per 10 minutes, 20 per IP per day, and 8 per normalized address per day.
- `GET /api/report/pdf?raw=1`: 3 PDF generations per lead per day after report auth/signature passes.
- `POST /api/utility-bills`: 6 upload attempts per IP per hour, plus 2 uploads per normalized email, phone, or address per day when the form provides that context.
- `POST /api/notifications/test`: dashboard auth required, then 5 test sends per hour.

The app also rejects oversized JSON/multipart requests, hidden honeypot submissions, and lead forms submitted too quickly to be realistic. Rate-limit events log route, IP, user-agent hash, normalized address where relevant, cache hit/miss, and whether a paid API was called. Logs never include API keys, dashboard tokens, or full submitted payloads.

Roof analysis cache entries are stored in `roof_analysis_cache` by normalized address plus rounded coordinates. The cache stores the normalized address, lat/lng, analysis payload, optional report/panel snapshots, `created_at`, `updated_at`, and `expires_at`. `ROOF_ANALYSIS_CACHE_TTL_DAYS` defaults to 30 days. The app checks the cache before calling the Google Solar API and returns cached valid or invalid analysis when available.

Cloudflare Turnstile is optional. Set both `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` to enable it on the lead form. If the secret is not configured, local development and production continue without Turnstile.

Emergency switches:

- `DISABLE_SOLAR_API_CALLS=true`: skips Google Solar API/data-layer calls and uses cache/fallback responses where possible.
- `DISABLE_PDF_GENERATION=true`: stops raw PDF generation.
- `DISABLE_EMAIL_SENDING=true`: skips Resend sends from all notification helpers.
- `MAINTENANCE_MODE=true`: returns a safe maintenance response from public submission and analysis routes.

For Google Cloud, restrict server keys to the needed APIs and deployment egress where possible. Restrict `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` by HTTP referrer to your production domains and localhost development origins. Consider Vercel WAF or Cloudflare firewall rules for country/rate filtering, known bot challenges, and blocking repeated 429 sources.

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

Before deploying, make sure `GOOGLE_PLACES_API_KEY`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_SOLAR_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `REPORT_SIGNING_SECRET`, `DASHBOARD_ACCESS_TOKEN`, `RATE_LIMIT_SECRET`, `FOLLOW_UP_PROCESS_SECRET`, `UTILITY_BILL_UPLOAD_SECRET`, and any Resend variables are set in Vercel. Add Turnstile variables only when you are ready to enforce the challenge.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
