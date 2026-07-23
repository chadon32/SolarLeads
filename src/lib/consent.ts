import "server-only";

import { createHmac } from "node:crypto";
import {
  APP_LEAD_DISCLOSURE_COPY,
  CONTACT_CONSENT_VERSION,
  REPORT_DELIVERY_DISCLOSURE,
} from "@/lib/brand";
import { getClientIp } from "@/lib/rate-limit";

export type ConsentEvidence = {
  automatedContactConsent: false;
  consentDisclosureText: string;
  consentDisclosureVersion: string;
  consentIpHash: string | null;
  consentSource: "lead-report-form";
  consentUserAgentHash: string | null;
  installerContactConsent: boolean;
  installerContactConsentAt: string | null;
  marketingEmailConsent: false;
  phoneCallConsent: boolean;
  reportDeliveryConsentAt: string;
  textMessageConsent: false;
};

export function buildConsentEvidence(
  request: Request,
  installerContactConsent: boolean,
  preferredContactMethod?: string | null
): ConsentEvidence {
  const now = new Date().toISOString();
  const userAgent = request.headers.get("user-agent")?.trim() ?? "";
  const contactMethod = preferredContactMethod?.trim().toLowerCase() ?? "";

  return {
    automatedContactConsent: false,
    consentDisclosureText: installerContactConsent
      ? `${REPORT_DELIVERY_DISCLOSURE} ${APP_LEAD_DISCLOSURE_COPY}`
      : REPORT_DELIVERY_DISCLOSURE,
    consentDisclosureVersion: CONTACT_CONSENT_VERSION,
    consentIpHash: hashEvidence(getClientIp(request)),
    consentSource: "lead-report-form",
    consentUserAgentHash: hashEvidence(userAgent),
    installerContactConsent,
    installerContactConsentAt: installerContactConsent ? now : null,
    marketingEmailConsent: false,
    phoneCallConsent:
      installerContactConsent && contactMethod === "phone",
    reportDeliveryConsentAt: now,
    textMessageConsent: false,
  };
}

function hashEvidence(value: string) {
  if (!value || value === "unknown") {
    return null;
  }

  const secret = process.env.RATE_LIMIT_SECRET?.trim();

  if (!secret && process.env.NODE_ENV === "production") {
    return null;
  }

  return createHmac("sha256", secret || "local-consent-evidence")
    .update(value)
    .digest("hex");
}
