export type ReportEmailDeliveryStatus = "sent" | "failed" | "unavailable" | "unconfirmed";

export function getReportEmailDeliveryStatus(result: {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
}): ReportEmailDeliveryStatus {
  if (result.ok) return "sent";
  if (result.reason === "acceptance_unconfirmed") return "unconfirmed";
  return result.skipped ? "unavailable" : "failed";
}

export function normalizeReportEmailDeliveryStatus(
  status: unknown
): ReportEmailDeliveryStatus {
  return status === "sent" || status === "failed" || status === "unavailable" || status === "unconfirmed"
    ? status
    : "unavailable";
}

export function getReportEmailDeliveryCopy(
  status: ReportEmailDeliveryStatus
) {
  switch (status) {
    case "unconfirmed":
      return {
        title: "We couldn't confirm email delivery",
        message: "Your report is saved. Use the secure report link here; the email may still arrive. You don't need to submit another request.",
      };
    case "sent":
      return {
        title: "Your report email was sent",
        message: "A secure report link was sent to the email you entered.",
      };
    case "failed":
      return {
        title: "We couldn't send your report email",
        message:
          "Your report is saved and ready. Use the secure report link here to open it.",
      };
    case "unavailable":
      return {
        title: "Email delivery is unavailable",
        message:
          "Your report is saved and ready. Use the secure report link here to open it.",
      };
  }
}
