type AddressComponent = {
  long_name?: string;
  longText?: string;
  short_name?: string;
  shortText?: string;
  types?: string[];
};

const ARIZONA_BOUNDS = {
  north: 37.1,
  south: 31.2,
  east: -108.9,
  west: -115,
} as const;

export function isArizonaCoordinate(lat: unknown, lng: unknown) {
  const latitude = Number(lat);
  const longitude = Number(lng);

  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= ARIZONA_BOUNDS.south &&
    latitude <= ARIZONA_BOUNDS.north &&
    longitude >= ARIZONA_BOUNDS.west &&
    longitude <= ARIZONA_BOUNDS.east
  );
}

export function isArizonaAddressComponents(
  components?: AddressComponent[] | null
) {
  const state = components?.find((component) =>
    component.types?.includes("administrative_area_level_1")
  );
  const shortName = state?.shortText ?? state?.short_name ?? "";
  const longName = state?.longText ?? state?.long_name ?? "";

  return shortName.toUpperCase() === "AZ" || /^arizona$/i.test(longName);
}

export function looksLikeArizonaAddress(value?: string | null) {
  const address = value?.trim() ?? "";

  return /(?:\bArizona\b|\bAZ\s+\d{5}(?:-\d{4})?\b)/i.test(address);
}

/**
 * Two-letter state named at the end of an address ("…, Mesa, AZ 85201",
 * "…, Henderson, NV, USA"), "AZ" when it spells out Arizona, otherwise null.
 */
export function addressStateCode(value?: string | null) {
  const address = value?.trim() ?? "";
  const match = address.match(
    /,\s*([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*(?:,\s*(?:USA|US|United States))?\s*$/
  );

  if (match) {
    return match[1].toUpperCase();
  }

  return /\bArizona\b/i.test(address) ? "AZ" : null;
}

/**
 * An Arizona home: coordinates (when known) inside Arizona's bounds, and the
 * address does not name another state. The bounds alone also cover border
 * towns in Nevada, Utah, New Mexico and California, hence the state check.
 */
export function isArizonaHome({
  address,
  lat,
  lng,
}: {
  address?: string | null;
  lat?: unknown;
  lng?: unknown;
}) {
  const hasCoordinates = lat !== null && lat !== undefined && lng !== null && lng !== undefined;

  if (hasCoordinates && !isArizonaCoordinate(lat, lng)) {
    return false;
  }

  const state = addressStateCode(address);

  if (state) {
    return state === "AZ";
  }

  return hasCoordinates || looksLikeArizonaAddress(address);
}
