export const fmtAddr = (address?: string | null) =>
  address
    ?.replace(/,\s*USA\s*$/i, "")
    .replace(/,\s*United States\s*$/i, "")
    .trim() ?? "";

export const fmtAddress = fmtAddr;
