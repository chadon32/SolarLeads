export const fmtAddress = (address?: string | null) =>
  address
    ?.replace(/,\s*USA\s*$/i, "")
    .replace(/,\s*United States\s*$/i, "")
    .trim() ?? "";
