import { normalizeAddress } from "@/lib/lead-normalization";

export type PropertyLeadCandidate = {
  address?: string | null;
  normalized_address?: string | null;
};

export function selectLeadForNormalizedProperty<T extends PropertyLeadCandidate>(
  candidates: T[] | null | undefined,
  normalizedAddress: string | null | undefined
) {
  if (!normalizedAddress || !candidates?.length) {
    return null;
  }

  return (
    candidates.find(
      (candidate) =>
        candidate.normalized_address === normalizedAddress ||
        normalizeAddress(candidate.address) === normalizedAddress
    ) ?? null
  );
}
