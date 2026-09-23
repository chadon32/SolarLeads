import "server-only";

import { normalizeFourfoldAttributionKey } from "@/lib/attribution";

const FOURFOLD_TIMEOUT_MS = 1_500;
const FOURFOLD_BEARER_PATTERN = /^[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/;
const OPAQUE_EVENT_ID_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;

export type FourfoldConversionInput = {
  eventId: string;
  timestamp: string;
  utmId?: string | null;
};

export type FourfoldConversionResult =
  | { status: "disabled" }
  | { status: "sent" }
  | { status: "invalid_input"; reason: string }
  | { status: "failed"; reason: string };

/**
 * Send the completed preliminary-report conversion to Fourfold when explicitly
 * configured. The payload matches Fourfold's `/api/conversions` contract and
 * contains only an opaque event ID, the occurred-at timestamp, and an optional
 * Fourfold-issued attribution key. Contact, property, and report values never
 * cross this boundary.
 *
 * Both environment variables are required, so this integration is disabled by
 * default and cannot accidentally send data to an invented endpoint.
 */
export async function sendFourfoldConversion(
  input: FourfoldConversionInput
): Promise<FourfoldConversionResult> {
  const endpoint = process.env.FOURFOLD_ATTRIBUTION_ENDPOINT?.trim();
  const secret = process.env.FOURFOLD_ATTRIBUTION_SECRET?.trim();

  if (!endpoint || !secret) {
    return { status: "disabled" };
  }

  const eventId = input.eventId.trim();
  const attributionKey = normalizeFourfoldAttributionKey(input.utmId);
  const timestamp = input.timestamp.trim();

  if (!OPAQUE_EVENT_ID_PATTERN.test(eventId)) {
    return { status: "invalid_input", reason: "event_id" };
  }

  if (!Number.isFinite(Date.parse(timestamp))) {
    return { status: "invalid_input", reason: "timestamp" };
  }

  if (!FOURFOLD_BEARER_PATTERN.test(secret)) {
    return { status: "failed", reason: "invalid_secret" };
  }

  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    return { status: "failed", reason: "invalid_endpoint" };
  }

  // Production calls must use TLS. HTTP is allowed only for local endpoint
  // tests so a developer never has to weaken the production guard.
  if (
    parsedEndpoint.protocol !== "https:" &&
    !(parsedEndpoint.protocol === "http:" && isLocalhost(parsedEndpoint.hostname))
  ) {
    return { status: "failed", reason: "insecure_endpoint" };
  }

  const payload: Record<string, string> = {
    eventId,
    occurredAt: timestamp,
  };

  if (attributionKey) {
    payload.attributionKey = attributionKey;
  }

  try {
    const response = await fetch(parsedEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      // Fourfold must never be redirected to an untrusted origin. A redirect
      // is a failed delivery and the report flow continues independently.
      redirect: "error",
      signal: AbortSignal.timeout(FOURFOLD_TIMEOUT_MS),
    });

    if (!response.ok) {
      return { status: "failed", reason: `http_${response.status}` };
    }

    return { status: "sent" };
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof Error ? error.name : "request_error",
    };
  }
}

function isLocalhost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
