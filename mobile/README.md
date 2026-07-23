# Solartelligence iPhone app

This Expo client provides a native iPhone entry flow for Solartelligence and
uses Expo EAS to build and submit through TestFlight from Windows.

The home screen, Arizona address search, recent property, navigation, sharing,
safe areas, and connection recovery are native. The complex rooftop workspace
uses the production web renderer in a dedicated app mode so Google Maps, roof
geometry, panel overlays, report generation, and lead submission continue to
share one trusted implementation with the website.

## Local development

```powershell
cd mobile
npm install
npm start
```

Scan the QR code with Expo Go for basic testing. Native build behavior, file
uploads, PDF links, and iOS sharing should be verified with an EAS development
or TestFlight build before release.

## First-time EAS setup

```powershell
cd mobile
npm run eas:login
npm run eas:init
```

When EAS creates the project, keep the owner/project ID it adds to `app.json`.
Use bundle identifier `com.solartelligence.app` in Apple Developer and App Store
Connect.

## Build and upload to TestFlight

```powershell
cd mobile
npm run testflight
```

EAS builds and signs the iOS binary on a cloud Mac, then uploads it to
TestFlight. The first run asks for Apple signing and App Store Connect details;
EAS stores those credentials securely, not in this repository.

The native app contains no Google, Supabase, Resend, report-signing, or dashboard
secrets. Those remain in the Vercel production environment. The app loads only
the Solartelligence production domains internally and opens external links with
iOS.
