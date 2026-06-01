"use client";

import { ArrowRight, MapPin } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type Prediction = {
  description: string;
  place_id: string;
  structured_formatting?: {
    main_text: string;
    secondary_text: string;
  };
};

type AddressSearchProps = {
  onSelect: (property: { address: string; lat?: number; lng?: number }) => void;
  selectedAddress?: string;
};

type PlaceDetailsPayload = {
  formattedAddress?: string;
  lat?: number;
  lng?: number;
  message?: string;
  types?: string[];
  primaryType?: string;
  businessStatus?: string;
  addressComponents?: Array<{
    longText?: string;
    shortText?: string;
    types?: string[];
  }>;
};

const lookupUnavailableMessage =
  "Address lookup is temporarily unavailable. Please try again shortly.";

function buildFallbackSuggestions(query: string) {
  const typedAddress = query.trim();
  const typedSuggestion =
    typedAddress.length >= 5
      ? [
          {
            description: typedAddress,
            place_id: `manual-${typedAddress}`,
            structured_formatting: {
              main_text: typedAddress,
              secondary_text: "Use typed address",
            },
          },
        ]
      : [];

  return typedSuggestion;
}

function isArizonaAddress(address: string) {
  return address.includes(", AZ") || address.includes("Arizona");
}

function normalizeAddress(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function shouldAutoSelectPrediction(query: string, prediction: Prediction) {
  const normalizedQuery = normalizeAddress(query);
  const normalizedDescription = normalizeAddress(prediction.description);
  const normalizedMainText = normalizeAddress(
    prediction.structured_formatting?.main_text ?? prediction.description
  );

  if (normalizedQuery.length < 10) {
    return false;
  }

  return (
    normalizedDescription.includes(normalizedQuery) ||
    normalizedQuery.includes(normalizedMainText)
  );
}

function isClearlyNonResidentialPlace(payload: PlaceDetailsPayload) {
  const knownCommercialTypes = new Set([
    "establishment",
    "point_of_interest",
    "restaurant",
    "bar",
    "cafe",
    "store",
    "shopping_mall",
    "school",
    "hospital",
    "doctor",
    "bank",
    "hotel",
    "lodging",
    "car_dealer",
    "car_repair",
    "church",
    "synagogue",
    "mosque",
    "stadium",
    "gym",
    "post_office",
    "local_government_office",
    "fire_station",
    "police",
    "courthouse",
    "office",
    "apartment_building",
    "subpremise",
    "rooming_house",
  ]);

  const types = payload.types ?? [];
  const addressComponentTypes =
    payload.addressComponents?.flatMap((component) => component.types ?? []) ?? [];
  const allTypes = new Set([...types, ...addressComponentTypes]);
  const hasStreetAddressSignal =
    allTypes.has("street_address") ||
    allTypes.has("premise") ||
    allTypes.has("route");
  const hasCommercialSignal = [...allTypes].some((type) =>
    knownCommercialTypes.has(type)
  );

  if (payload.primaryType && knownCommercialTypes.has(payload.primaryType)) {
    return true;
  }

  if (!hasStreetAddressSignal && hasCommercialSignal) {
    return true;
  }

  if (
    payload.businessStatus === "OPERATIONAL" &&
    hasCommercialSignal &&
    !allTypes.has("street_address")
  ) {
    return true;
  }

  return false;
}

export function AddressSearch({
  onSelect,
  selectedAddress,
}: AddressSearchProps) {
  const [query, setQuery] = useState(selectedAddress ?? "");
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [open, setOpen] = useState(false);
  const [placesReady, setPlacesReady] = useState(false);
  const [fallbackActive, setFallbackActive] = useState(false);
  const [status, setStatus] = useState("Address lookup ready.");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selectPrediction = useCallback(
    async (prediction: Prediction) => {
      const address = prediction.description;

      setQuery(address);
      setPredictions([]);
      setActiveIndex(-1);
      setOpen(false);

      if (prediction.place_id.startsWith("manual-")) {
        if (!isArizonaAddress(address)) {
          setAddressError(
            "We currently only serve Arizona homes. Please enter an AZ address."
          );
          onSelect({ address: "" });
          setStatus("Arizona address required.");
          return;
        }

        setStatus(`Selected: ${address}`);
        setFallbackActive(false);
        setAddressError(null);
        onSelect({ address });
        return;
      }

      try {
        const response = await fetch(
          `/api/places/details?placeId=${encodeURIComponent(prediction.place_id)}`
        );
        const payload: PlaceDetailsPayload = await response.json().catch(() => ({}));
        const formattedAddress =
          response.ok && payload.formattedAddress ? payload.formattedAddress : address;

        if (!isArizonaAddress(formattedAddress)) {
          setAddressError(
            "We currently only serve Arizona homes. Please enter an AZ address."
          );
          setStatus("Arizona address required.");
          onSelect({ address: "" });
          return;
        }

        if (isClearlyNonResidentialPlace(payload)) {
          setAddressError(
            "That address looks like a business or non-residential property. Please choose a detached home address."
          );
          setStatus("Residential home required.");
          onSelect({ address: "" });
          return;
        }

        setQuery(formattedAddress);
        onSelect({
          address: formattedAddress,
          lat: payload.lat,
          lng: payload.lng,
        });
        setAddressError(null);
        setFallbackActive(false);
        setStatus(`Selected: ${formattedAddress}`);
      } catch {
        setAddressError(lookupUnavailableMessage);
        setFallbackActive(true);
        onSelect({ address: "" });
      }
    },
    [onSelect]
  );

  useEffect(() => {
    const handle = window.requestAnimationFrame(() => {
      setQuery(selectedAddress ?? "");
    });

    return () => window.cancelAnimationFrame(handle);
  }, [selectedAddress]);

  useEffect(() => {
    const trimmed = query.trim();
    const controller = new AbortController();

    const timer = window.setTimeout(async () => {
      if (!open) return;

      if (!trimmed) {
        setPredictions([]);
        setActiveIndex(-1);
        setStatus("Start typing to search Google Places.");
        setAddressError(null);
        setFallbackActive(false);
        setSearching(false);
        return;
      }

      setStatus("Searching Google Places...");
      setFallbackActive(false);
      setSearching(true);
      setAddressError(null);

      try {
        const response = await fetch("/api/places/autocomplete", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ input: trimmed }),
          signal: controller.signal,
        });

        const payload: { message?: string; predictions?: Prediction[] } =
          await response.json().catch(() => ({}));

        if (!response.ok) {
          const fallback = buildFallbackSuggestions(trimmed);
          setPredictions(fallback);
          setActiveIndex(fallback.length ? 0 : -1);
          setPlacesReady(false);
          setFallbackActive(true);
          setStatus(
            payload.message ??
              "Local fallback active - Google Places search is unavailable."
          );
          setAddressError(lookupUnavailableMessage);
          setSearching(false);
          return;
        }

        const nextPredictions = payload.predictions ?? [];

        if (
          nextPredictions.length === 1 &&
          shouldAutoSelectPrediction(trimmed, nextPredictions[0])
        ) {
          setPredictions(nextPredictions);
          setActiveIndex(0);
          setPlacesReady(true);
          setStatus("Exact property match found. Starting roof scan...");
          setAddressError(null);
          setSearching(false);
          void selectPrediction(nextPredictions[0]);
          return;
        }

        setPredictions(nextPredictions);
        setActiveIndex(nextPredictions.length ? 0 : -1);
        setPlacesReady(true);
        setFallbackActive(false);
        setStatus(
          nextPredictions.length
            ? "Choose the matching address to start the roof scan."
            : "No matching addresses found."
        );
        setAddressError(
          nextPredictions.length
            ? null
            : "No results found. Try a nearby street address or check your spelling."
        );
        setSearching(false);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        const fallback = buildFallbackSuggestions(trimmed);
        setPredictions(fallback);
        setActiveIndex(fallback.length ? 0 : -1);
        setPlacesReady(false);
        setFallbackActive(true);
        setStatus("Local fallback active - Google Places search is unavailable.");
        setAddressError(lookupUnavailableMessage);
        setSearching(false);
      }
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, query, selectPrediction]);

  const helperText =
    "Pick the matching address to start the solar report workflow.";

  const exactPredictionMatch = predictions.find(
    (prediction) =>
      normalizeAddress(prediction.description) === normalizeAddress(query.trim())
  );

  const showPredictions = open && predictions.length > 0;
  const showLoadingShell = open && searching && predictions.length === 0;
  const activePredictionId =
    activeIndex >= 0 && predictions[activeIndex]
      ? `address-option-${predictions[activeIndex].place_id}`
      : undefined;

  const submitCurrentAddress = () => {
    const prediction = exactPredictionMatch ?? predictions[activeIndex] ?? predictions[0];

    if (prediction) {
      void selectPrediction(prediction);
      return;
    }

    setOpen(true);
    inputRef.current?.focus();
  };

  return (
    <div className="relative w-full">
      <label className="mb-3 block text-xs font-semibold uppercase tracking-[0.34em] text-cyan-100/90">
        Enter your Arizona address
      </label>
      <div className="relative">
        <div className="relative">
          <MapPin
            className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-cyan-100/80"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-controls={showPredictions ? "address-suggestions" : undefined}
            aria-expanded={showPredictions}
            aria-activedescendant={activePredictionId}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
              setActiveIndex(-1);
              setFallbackActive(false);
              setAddressError(null);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (!predictions.length) return;

              if (event.key === "ArrowDown") {
                event.preventDefault();
                setOpen(true);
                setActiveIndex((current) =>
                  Math.min(current + 1, predictions.length - 1)
                );
                return;
              }

              if (event.key === "ArrowUp") {
                event.preventDefault();
                setOpen(true);
                setActiveIndex((current) => Math.max(current - 1, 0));
                return;
              }

              if (event.key === "Enter" && activeIndex >= 0) {
                event.preventDefault();
                void selectPrediction(predictions[activeIndex]);
                return;
              }

              if (
                event.key === "Enter" &&
                activeIndex < 0 &&
                (exactPredictionMatch || predictions[0])
              ) {
                event.preventDefault();
                void selectPrediction(exactPredictionMatch ?? predictions[0]);
                return;
              }

              if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
              }
            }}
            onBlur={() => {
              window.setTimeout(() => setOpen(false), 140);
            }}
            placeholder="Enter your Arizona address..."
            className={`w-full rounded-full border bg-black/24 py-4 pl-12 pr-16 text-base text-white outline-none transition placeholder:text-white/45 focus:border-cyan-200/50 focus:bg-black/32 ${
              addressError ? "border-rose-300/55" : "border-white/12"
            }`}
          />
          <button
            type="button"
            aria-label="Use selected address"
            onMouseDown={(event) => event.preventDefault()}
            onClick={submitCurrentAddress}
            className="absolute right-2 top-1/2 z-10 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white text-slate-950 shadow-[0_12px_30px_rgba(255,255,255,0.18)] transition hover:scale-105 hover:bg-cyan-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
          >
            <ArrowRight className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-white/58">
          <span>
            Search powered by Google Places.{" "}
            {fallbackActive
              ? "Local fallback"
              : placesReady
                ? "Google Places active"
                : "Address lookup ready"}
          </span>
        </div>
        {status !== "Address lookup ready." ? (
          <p className="mt-2 text-xs leading-5 text-white/45">{status}</p>
        ) : null}

        {open && exactPredictionMatch ? (
          <p className="mt-2 text-xs text-cyan-200">
            Press Enter to use{" "}
            <span className="font-semibold text-white">
              {exactPredictionMatch.description}
            </span>
            .
          </p>
        ) : null}

        {(showPredictions || showLoadingShell) && (
          <div
            id="address-suggestions"
            role="listbox"
            aria-label="Address suggestions"
            className="liquid-glass absolute z-20 mt-3 max-h-72 w-full overflow-auto rounded-[1.3rem] bg-black/72 shadow-[0_24px_70px_rgba(2,8,20,0.55)] backdrop-blur-xl"
          >
            {showLoadingShell
              ? Array.from({ length: 4 }).map((_, index) => (
                  <div
                    key={`skeleton-${index}`}
                    className="flex items-start gap-3 border-b border-white/6 px-4 py-3 last:border-b-0"
                  >
                    <span className="mt-1 h-2 w-2 rounded-full bg-cyan-300/40 shadow-[0_0_18px_rgba(103,232,249,0.25)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block h-3.5 w-44 rounded-full bg-white/8 animate-pulse" />
                      <span className="mt-2 block h-2.5 w-32 rounded-full bg-white/8 animate-pulse [animation-delay:140ms]" />
                    </span>
                  </div>
                ))
              : predictions.map((prediction, index) => {
                  const selected = index === activeIndex;

                  return (
                    <button
                      key={prediction.place_id}
                      id={`address-option-${prediction.place_id}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`flex w-full items-start gap-3 border-b border-white/6 px-4 py-3 text-left transition last:border-b-0 ${
                        selected ? "bg-white/10" : "hover:bg-white/6"
                      }`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectPrediction(prediction)}
                    >
                      <span className="mt-1 h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,0.7)]" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-white">
                          {prediction.structured_formatting?.main_text ??
                            prediction.description}
                        </span>
                        <span className="mt-1 block text-xs text-slate-400">
                          {prediction.structured_formatting?.secondary_text ??
                            `Match ${index + 1}`}
                        </span>
                      </span>
                    </button>
                  );
                })}
          </div>
        )}
      </div>
      <p className="mt-3 text-sm text-white/58">
        Currently serving Arizona addresses only.
      </p>
      {addressError ? (
        <p className="mt-2 text-sm leading-6 text-rose-300">{addressError}</p>
      ) : null}
      <p className="mt-3 text-sm leading-6 text-white/45">{helperText}</p>
    </div>
  );
}
