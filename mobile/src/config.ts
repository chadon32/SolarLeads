import Constants from "expo-constants";

export const APP_URL = (
  (Constants.expoConfig?.extra?.appUrl as string | undefined) ??
  "https://solartelligence.com"
).replace(/\/+$/, "");

export const ALLOWED_HOSTS = new Set([
  "solartelligence.com",
  "www.solartelligence.com",
  "solar-leads-psi.vercel.app",
]);

export function buildEstimateUrl(address: string) {
  const params = new URLSearchParams({
    address,
    app: "ios",
  });

  return `${APP_URL}/estimate?${params.toString()}`;
}

export function buildShareUrl(address: string) {
  return `${APP_URL}/estimate?address=${encodeURIComponent(address)}`;
}
