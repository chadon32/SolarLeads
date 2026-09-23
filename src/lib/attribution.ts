// Fourfold currently creates content IDs with randomUUID(). Restrict the
// client supplied segment to that opaque identifier shape so a readable value
// cannot become an apparently valid attribution key.
const FOURFOLD_CONTENT_ID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const FOURFOLD_ATTRIBUTION_KEY_PATTERN = new RegExp(
  `^solarai-(?:threads|instagram|facebook|youtube|x)-${FOURFOLD_CONTENT_ID_PATTERN}$`,
  "i"
);

/**
 * Fourfold's deterministic attribution key is
 * `${brand}-${platform}-${contentId}`. Solartelligence is mapped to Fourfold's
 * `solarai` brand, and Fourfold validates the published content ID server-side.
 * Current Fourfold content IDs are UUIDs, so requiring that opaque shape
 * prevents arbitrary readable UTM values, contact data, and cross-brand keys
 * from being forwarded.
 */
export function normalizeFourfoldAttributionKey(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return FOURFOLD_ATTRIBUTION_KEY_PATTERN.test(normalized)
    ? normalized
    : null;
}
