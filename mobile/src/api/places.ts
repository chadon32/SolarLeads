import { APP_URL } from "../config";

export type PlacePrediction = {
  description: string;
  place_id: string;
  structured_formatting?: {
    main_text?: string;
    secondary_text?: string;
  };
};

type AutocompleteResponse = {
  message?: string;
  predictions?: PlacePrediction[];
};

type PlaceDetailsResponse = {
  formattedAddress?: string;
  lat?: number;
  lng?: number;
  message?: string;
};

export class PlaceLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaceLookupError";
  }
}

export async function searchArizonaAddresses(
  input: string,
  signal?: AbortSignal
) {
  const response = await fetch(`${APP_URL}/api/places/autocomplete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-App-Platform": "ios",
    },
    body: JSON.stringify({ input }),
    signal,
  });
  const payload = (await response.json().catch(() => ({}))) as AutocompleteResponse;

  if (!response.ok) {
    throw new PlaceLookupError(
      payload.message ?? "Address search is temporarily unavailable."
    );
  }

  return payload.predictions ?? [];
}

export async function fetchPlaceAddress(placeId: string) {
  const response = await fetch(
    `${APP_URL}/api/places/details?placeId=${encodeURIComponent(placeId)}`,
    {
      headers: { "X-App-Platform": "ios" },
    }
  );
  const payload = (await response.json().catch(() => ({}))) as PlaceDetailsResponse;

  if (!response.ok || !payload.formattedAddress) {
    throw new PlaceLookupError(
      payload.message ?? "That property could not be verified."
    );
  }

  return {
    address: payload.formattedAddress,
    lat: payload.lat,
    lng: payload.lng,
  };
}
