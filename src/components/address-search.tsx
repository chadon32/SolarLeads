"use client";

import { useEffect, useState } from "react";

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

const demoSuggestions = [
  "7140 E Via Dona Rd, Scottsdale, AZ",
  "8420 E Shea Blvd, Scottsdale, AZ",
  "2405 E Camelback Rd, Phoenix, AZ",
  "117 W Orchid Ln, Phoenix, AZ",
  "11310 N Scottsdale Rd, Scottsdale, AZ",
];

const lookupUnavailableMessage =
  "Address lookup is temporarily unavailable. Please try again or call us at (602) 555-0100.";

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

  const demoMatches = demoSuggestions
    .filter((address) => address.toLowerCase().includes(query.toLowerCase()))
    .map((address, index) => ({
      description: address,
      place_id: `demo-${index}`,
    }));

  return [...typedSuggestion, ...demoMatches].slice(0, 5);
}

function isArizonaAddress(address: string) {
  return address.includes(", AZ") || address.includes("Arizona");
}

export function AddressSearch({
  onSelect,
  selectedAddress,
}: AddressSearchProps) {
  const [query, setQuery] = useState(selectedAddress ?? "");
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [open, setOpen] = useState(false);
  const [placesReady, setPlacesReady] = useState(false);
  const [status, setStatus] = useState("Search powered by Google Places.");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);

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
        const fallback = demoSuggestions.map((address, index) => ({
          description: address,
          place_id: `demo-${index}`,
        }));
        setPredictions(fallback);
        setActiveIndex(fallback.length ? 0 : -1);
        setStatus("Start typing to search real addresses.");
        setAddressError(null);
        setSearching(false);
        return;
      }

      setStatus("Searching Google Places...");
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
          setStatus(payload.message ?? "Google Places search is unavailable.");
          setAddressError(lookupUnavailableMessage);
          setSearching(false);
          return;
        }

        const nextPredictions = payload.predictions ?? [];
        setPredictions(nextPredictions);
        setActiveIndex(nextPredictions.length ? 0 : -1);
        setPlacesReady(true);
        setStatus(
          nextPredictions.length
            ? "Autocomplete suggestions ready."
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
        setStatus("Google Places search is unavailable.");
        setAddressError(lookupUnavailableMessage);
        setSearching(false);
      }
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const helperText =
    "Type your address below and we will show a roof analysis only after a valid Arizona property is selected.";

  const selectPrediction = async (prediction: Prediction) => {
    const address = prediction.description;

    setQuery(address);
    setPredictions([]);
    setActiveIndex(-1);
    setOpen(false);

    if (
      prediction.place_id.startsWith("demo-") ||
      prediction.place_id.startsWith("manual-")
    ) {
      if (!isArizonaAddress(address)) {
        setAddressError(
          "We currently only serve Arizona homes. Please enter an AZ address."
        );
        onSelect({ address: "" });
        setStatus("Arizona address required.");
        return;
      }

      setStatus(`Selected: ${address}`);
      setAddressError(null);
      onSelect({ address });
      return;
    }

    try {
      const response = await fetch(
        `/api/places/details?placeId=${encodeURIComponent(prediction.place_id)}`
      );
      const payload: {
        formattedAddress?: string;
        lat?: number;
        lng?: number;
        message?: string;
      } =
        await response.json().catch(() => ({}));
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

      setQuery(formattedAddress);
      onSelect({
        address: formattedAddress,
        lat: payload.lat,
        lng: payload.lng,
      });
      setAddressError(null);
      setStatus(`Selected: ${formattedAddress}`);
    } catch {
      setAddressError(lookupUnavailableMessage);
      onSelect({ address: "" });
    }
  };

  const showPredictions = open && predictions.length > 0;
  const showLoadingShell = open && searching && predictions.length === 0;
  const activePredictionId =
    activeIndex >= 0 && predictions[activeIndex]
      ? `address-option-${predictions[activeIndex].place_id}`
      : undefined;

  return (
    <div className="relative w-full">
      <label className="mb-3 block text-xs font-semibold uppercase tracking-[0.34em] text-cyan-300">
        Address input
      </label>
      <div className="relative">
        <input
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

            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
            }
          }}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 140);
          }}
          placeholder="Start typing your Arizona address..."
          className={`w-full rounded-[1.35rem] border bg-slate-950/45 px-5 py-4 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/35 focus:bg-slate-950/65 ${
            addressError ? "border-rose-400/45" : "border-white/10"
          }`}
        />

        <div className="mt-3 flex items-center justify-between gap-4 text-xs text-slate-400">
          <span>{status}</span>
          <span>{placesReady ? "Google Places" : "Local fallback"}</span>
        </div>

        {(showPredictions || showLoadingShell) && (
          <div
            id="address-suggestions"
            role="listbox"
            aria-label="Address suggestions"
            className="absolute z-20 mt-3 max-h-72 w-full overflow-auto rounded-[1.3rem] border border-white/10 bg-slate-950/95 shadow-[0_24px_70px_rgba(2,8,20,0.55)] backdrop-blur-xl"
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
                        selected ? "bg-white/8" : "hover:bg-white/5"
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
      <p className="mt-3 text-sm text-slate-400">
        Currently serving Arizona addresses only.
      </p>
      {addressError ? (
        <p className="mt-2 text-sm leading-6 text-rose-300">{addressError}</p>
      ) : null}
      <p className="mt-3 text-sm leading-6 text-slate-400">{helperText}</p>
    </div>
  );
}
