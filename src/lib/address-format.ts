import { fmtAddress } from "@/lib/utils";

export function formatDisplayAddress(address: string | null | undefined) {
  return fmtAddress(address);
}
