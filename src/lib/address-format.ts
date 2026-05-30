import { fmtAddr } from "@/lib/utils";

export function formatDisplayAddress(address: string | null | undefined) {
  return fmtAddr(address);
}
