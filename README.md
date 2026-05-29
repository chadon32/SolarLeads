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
RATE_LIMIT_SECRET=your_rate_limit_secret_here
FOLLOW_UP_PROCESS_SECRET=your_follow_up_process_secret_here
SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here
RESEND_API_KEY=your_resend_api_key_here
RESEND_FROM_EMAIL=reports@yourdomain.com
TWILIO_ACCOUNT_SID=your_twilio_account_sid_here
TWILIO_AUTH_TOKEN=your_twilio_auth_token_here
TWILIO_FROM_NUMBER=+16025550123
DASHBOARD_ACCESS_TOKEN=your_dashboard_token_here
```

For Vercel, add the same values in the project environment settings. Keep `GOOGLE_MAPS_API_KEY`, `GOOGLE_PLACES_API_KEY`, `GOOGLE_SOLAR_API_KEY`, the service role key, report signing secret, rate limit secret, follow-up process secret, dashboard access token, and Twilio values server-side only. `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is the browser key used only for rendering the satellite map overlays.

Production report links fail closed unless `REPORT_SIGNING_SECRET` is configured. The dashboard also fails closed in production unless `DASHBOARD_ACCESS_TOKEN` is configured, because it can expose homeowner lead data.

The rooftop analysis pipeline now uses Google Geocoding plus the Google Maps Platform Solar API by default. The analysis is live per address, so every selected rooftop pulls real Solar API values for panel count, roof area, pitch, and energy estimates.

Run the SQL files in `supabase/` to create the `leads`, `lead_followups`, `request_events`, and `roof_analysis_cache` tables before testing the dashboard, rooftop analysis cache, or follow-up flow.

The follow-up processor route is ready for a scheduler call. If you use Vercel Cron or another job runner, send `FOLLOW_UP_PROCESS_SECRET` as a bearer token or `x-process-secret` header when calling `POST /api/follow-ups/process`.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Before deploying, make sure `GOOGLE_PLACES_API_KEY`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_SOLAR_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `REPORT_SIGNING_SECRET`, `RATE_LIMIT_SECRET`, `FOLLOW_UP_PROCESS_SECRET`, `TWILIO_*`, and any Resend variables are set in Vercel.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
