import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { APP_CANONICAL_URL } from "@/lib/brand";

const REPORT_SECRET = process.env.REPORT_SIGNING_SECRET?.trim();
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ??
  (process.env.NODE_ENV === "production"
    ? APP_CANONICAL_URL
    : "http://localhost:3000");
const REQUIRE_SIGNED_REPORTS = process.env.NODE_ENV === "production";
const REPORT_LINK_TTL_SECONDS = 60 * 60 * 24 * 7;

type ReportAccessOptions = {
  absolute?: boolean;
  baseUrl?: string;
  download?: boolean;
  expiresAt?: number;
  expiresInSeconds?: number;
  raw?: boolean;
};

function signValue(leadId: string, expiresAt: number) {
  if (!REPORT_SECRET) {
    return "";
  }

  return createHmac("sha256", REPORT_SECRET)
    .update(`${leadId}:${expiresAt}`)
    .digest("hex");
}

function constantTimeEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");

  if (leftBuffer.length !== rightBuffer.length || !leftBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function buildReportPdfPath(
  leadId: string,
  options: ReportAccessOptions = {}
) {
  const params = new URLSearchParams({ leadId });

  if (options.raw) {
    params.set("raw", "1");
  }

  if (options.download) {
    params.set("download", "1");
  }

  appendReportSignature(params, leadId, options);

  return `/api/report/pdf?${params.toString()}`;
}

export function buildRawReportPdfPath(
  leadId: string,
  options: {
    download?: boolean;
    expiresAt?: number;
    expiresInSeconds?: number;
  } = {}
) {
  return buildReportPdfPath(leadId, {
    download: options.download,
    expiresAt: options.expiresAt,
    expiresInSeconds: options.expiresInSeconds,
    raw: true,
  });
}

export function buildReportViewerPath(
  leadId: string,
  options: ReportAccessOptions = {}
) {
  const params = new URLSearchParams();
  appendReportSignature(params, leadId, options);
  const query = params.toString();

  return `/report/${encodeURIComponent(leadId)}${query ? `?${query}` : ""}`;
}

export function buildReportViewerUrl(
  leadId: string,
  options: ReportAccessOptions = {}
) {
  const path = buildReportViewerPath(leadId, options);

  if (!options.absolute) {
    return path;
  }

  return new URL(path, options.baseUrl ?? SITE_URL).toString();
}

export function buildSignedReportPdfPath(
  leadId: string,
  options: ReportAccessOptions = {}
) {
  assertReportSigningConfigured();
  return buildReportPdfPath(leadId, options);
}

export function buildReportAccessPath(
  leadId: string,
  options: ReportAccessOptions = {}
) {
  const params = new URLSearchParams({ leadId });
  appendReportSignature(params, leadId, options);

  return `/api/report/access?${params.toString()}`;
}

export function buildReportPdfUrl(
  leadId: string,
  options: ReportAccessOptions = {}
) {
  const path = buildReportPdfPath(leadId, {
    download: options.download,
    expiresAt: options.expiresAt,
    expiresInSeconds: options.expiresInSeconds,
    raw: options.raw,
  });

  if (!options.absolute) {
    return path;
  }

  return new URL(path, options.baseUrl ?? SITE_URL).toString();
}

export function buildReportAccessUrl(
  leadId: string,
  options: ReportAccessOptions = {}
) {
  const path = buildReportAccessPath(leadId, options);

  if (!options.absolute) {
    return path;
  }

  return new URL(path, options.baseUrl ?? SITE_URL).toString();
}

function appendReportSignature(
  params: URLSearchParams,
  leadId: string,
  options: ReportAccessOptions = {}
) {
  if (!REPORT_SECRET) {
    throw new Error("REPORT_SIGNING_SECRET is required to generate report links.");
  }

  const expiresAt =
    options.expiresAt ??
    Date.now() + (options.expiresInSeconds ?? REPORT_LINK_TTL_SECONDS) * 1000;

  params.set("exp", String(Math.floor(expiresAt)));
  params.set("token", signValue(leadId, Math.floor(expiresAt)));
}

function assertReportSigningConfigured() {
  if (!REPORT_SECRET) {
    throw new Error("REPORT_SIGNING_SECRET is required to generate signed report links.");
  }
}

export function verifyReportSignature(
  leadId: string,
  expiresAt: string | number | null,
  token: string | null
) {
  if (!REPORT_SECRET) {
    return {
      expired: false,
      missingSecret: REQUIRE_SIGNED_REPORTS,
      ok: !REQUIRE_SIGNED_REPORTS,
    };
  }

  if (!expiresAt || !token) {
    return { ok: false, expired: false, missingSecret: false };
  }

  const expiry = Number(expiresAt);

  if (!Number.isFinite(expiry)) {
    return { ok: false, expired: false, missingSecret: false };
  }

  if (Date.now() > expiry) {
    return { ok: false, expired: true, missingSecret: false };
  }

  const expected = signValue(leadId, expiry);

  return {
    ok: constantTimeEquals(expected, token),
    expired: false,
    missingSecret: false,
  };
}
