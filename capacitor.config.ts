import type { CapacitorConfig } from "@capacitor/cli";

const appUrl = process.env.CAPACITOR_APP_URL ?? "https://solartelligence.com";
const appHost = new URL(appUrl).hostname;

const config: CapacitorConfig = {
  appId: "com.solartelligence.app",
  appName: "Solartelligence",
  webDir: "mobile-shell",
  appendUserAgent: " Solartelligence-iOS",
  backgroundColor: "#020617",
  loggingBehavior: "debug",
  zoomEnabled: false,
  server: {
    url: appUrl,
    cleartext: appUrl.startsWith("http://"),
    allowNavigation: [appHost, "*.solartelligence.com"],
    errorPath: "offline.html",
  },
  ios: {
    contentInset: "automatic",
    scrollEnabled: true,
    allowsLinkPreview: false,
    preferredContentMode: "mobile",
    webContentsDebuggingEnabled: false,
  },
};

export default config;
