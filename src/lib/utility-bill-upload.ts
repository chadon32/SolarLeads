export const UTILITY_BILL_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;

export type UtilityBillMimeType =
  (typeof UTILITY_BILL_ALLOWED_MIME_TYPES)[number];

export const UTILITY_BILL_MAX_FILE_SIZE_BYTES = 4 * 1024 * 1024;
export const UTILITY_BILL_MAX_REQUEST_SIZE_BYTES =
  UTILITY_BILL_MAX_FILE_SIZE_BYTES + 256 * 1024;
export const UTILITY_BILL_UPLOAD_TIMEOUT_MS = 30_000;
export const UTILITY_BILL_FILE_TYPE_MESSAGE =
  "Upload a PDF, JPG, or PNG utility bill.";
export const UTILITY_BILL_MAX_FILE_SIZE_MESSAGE =
  "Utility bill uploads must be 4MB or smaller.";

export function getUtilityBillMimeType(
  fileName: string,
  reportedMimeType: string
): UtilityBillMimeType | null {
  const normalizedMimeType = reportedMimeType.trim().toLowerCase();

  if (isUtilityBillMimeType(normalizedMimeType)) {
    return normalizedMimeType;
  }

  // FormData serializes a blank File.type as application/octet-stream. Infer
  // the type from the extension, then let the server's signature check
  // validate the bytes.
  if (normalizedMimeType && normalizedMimeType !== "application/octet-stream") {
    return null;
  }

  const extension = fileName.toLowerCase().match(/\.(pdf|jpe?g|png)$/)?.[1];

  if (extension === "pdf") return "application/pdf";
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";

  return null;
}

function isUtilityBillMimeType(value: string): value is UtilityBillMimeType {
  return (UTILITY_BILL_ALLOWED_MIME_TYPES as readonly string[]).includes(value);
}
