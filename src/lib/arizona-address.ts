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
