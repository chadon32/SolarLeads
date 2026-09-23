export const REDACTED_NATIVE_SHARE_TITLE =
  "Solartelligence preliminary solar scenario";

export type RedactedNativeSharePayload = Readonly<{
  title: string;
  message: string;
}>;

const REDACTED_NATIVE_SHARE_MESSAGE = [
  REDACTED_NATIVE_SHARE_TITLE,
  "Illustrative roof and energy planning snapshot.",
  "This summary omits private property and contact details.",
  "Verify roof condition, utility plan, pricing, and final design with a qualified installer.",
].join("\n");

/**
 * A deliberately generic native share payload. Keep this independent from
 * WebView navigation state so property, bill, contact, and report data cannot
 * cross the native outbound share boundary.
 */
export function buildRedactedNativeShareMessage() {
  return REDACTED_NATIVE_SHARE_MESSAGE;
}

/**
 * The native share boundary has an explicit allow-list. In particular, this
 * payload intentionally has no URL field and accepts no estimate state.
 */
export function buildRedactedNativeSharePayload(): RedactedNativeSharePayload {
  return {
    title: REDACTED_NATIVE_SHARE_TITLE,
    message: REDACTED_NATIVE_SHARE_MESSAGE,
  };
}
