export type ReportEmailDeliveryStatus = "sent" | "failed" | "unavailable";

export function getReportEmailDeliveryStatus(result: {
  ok: boolean;
  skipped?: boolean;
}): ReportEmailDeliveryStatus {
  if (result.ok) return "sent";
  return result.skipped ? "unavailable" : "failed";
}

export function normalizeReportEmailDeliveryStatus(
  status: unknown
): ReportEmailDeliveryStatus {
  return status === "sent" || status === "failed" || status === "unavailable"
    ? status
    : "unavailable";
}

export function getReportEmailDeliveryCopy(
  status: ReportEmailDeliveryStatus
) {
  switch (status) {
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
