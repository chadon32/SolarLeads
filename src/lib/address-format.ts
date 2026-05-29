export function formatDisplayAddress(address: string | null | undefined) {
  return (address ?? "")
    .replace(/,\s*USA\s*$/i, "")
    .replace(/\s+USA\s*$/i, "")
    .trim();
}
