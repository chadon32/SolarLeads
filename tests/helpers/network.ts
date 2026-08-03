import type { Page, Route } from "playwright/test";
import { writeArrayBuffer } from "geotiff";
import {
  autocompleteSuccess,
  dataLayersSuccess,
  leadSuccess,
  placeDetailsSuccess,
  roofAnalysisSuccess,
  satelliteImageSuccess,
  satellitePreviewSuccess,
} from "../fixtures/mock-api-responses";

type MockOptions = {
  autocompleteDelayMs?: number;
  analyzeDelayMs?: number;
  analyzeStatus?: number;
  analyzePayload?: unknown;
  leadDelayMs?: number;
  leadStatus?: number;
  leadPayload?: unknown;
  satelliteDelayMs?: number;
};

const TEST_DSM_URL = "**/__e2e__/test-dsm.tif";

function buildTestDsm() {
  const width = 32;
  const height = 24;
  const west = -111.83166;
  const east = -111.83134;
  const south = 33.41508;
  const north = 33.41532;
  const elevations = new Float32Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      elevations[y * width + x] = 400 + x * 0.04 + y * 0.02;
    }
  }

  return Buffer.from(
    writeArrayBuffer(elevations, {
      width,
      height,
      ModelPixelScale: [(east - west) / width, (north - south) / height, 0],
      ModelTiepoint: [0, 0, 0, west, north, 0],
      GeographicTypeGeoKey: 4326,
      GeogCitationGeoKey: "WGS 84",
      GTModelTypeGeoKey: 2,
    })
  );
}

const TEST_DSM = buildTestDsm();

async function json(route: Route, payload: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

export async function installSafeApiMocks(page: Page, options: MockOptions = {}) {
  await page.addInitScript(() => {
    class Overlay {
      map: unknown = null;
      onAdd = () => undefined;
      draw = () => undefined;
      onRemove = () => undefined;

      setMap(map: unknown) {
        this.map = map;
        if (map) {
          this.onAdd();
          this.draw();
        } else {
          this.onRemove();
        }
      }

      getPanes() {
        const map = this.map as { overlayLayer?: HTMLElement } | null;
        return { overlayLayer: map?.overlayLayer ?? document.body };
      }

      getProjection() {
        return {
          fromLatLngToDivPixel: (point: { lat?: number; lng?: number }) => ({
            x: 320 + ((point.lng ?? -111.8315) + 111.8315) * 1_000_000,
            y: 260 - ((point.lat ?? 33.4152) - 33.4152) * 1_000_000,
          }),
        };
      }
    }

    class MapStub {
      zoom = 20;
      overlayLayer: HTMLElement;

      constructor(element: HTMLElement) {
        const surface = document.createElement("div");
        surface.dataset.testid = "mock-satellite-map";
        surface.style.cssText =
          "position:absolute;inset:0;background:linear-gradient(145deg,#334155,#0f172a);";
        element.appendChild(surface);
        this.overlayLayer = document.createElement("div");
        this.overlayLayer.dataset.testid = "mock-map-overlay-pane";
        this.overlayLayer.style.cssText =
          "position:absolute;inset:0;overflow:hidden;pointer-events:none;";
        element.appendChild(this.overlayLayer);
      }

      fitBounds() {}
      getZoom() {
        return this.zoom;
      }
      setCenter() {}
      setZoom(zoom: number) {
        this.zoom = zoom;
      }
      setMapTypeId() {}
      setTilt() {}
    }

    class LatLngStub {
      constructor(
        public lat: number,
        public lng: number
      ) {}
    }

    class ShapeStub extends Overlay {
      constructor(options: unknown) {
        super();
        void options;
      }
    }

    Object.assign(window, {
      google: {
        maps: {
          Map: MapStub,
          LatLng: LatLngStub,
          Rectangle: ShapeStub,
          Polygon: ShapeStub,
          Polyline: ShapeStub,
          OverlayView: Overlay,
          MapTypeId: { SATELLITE: "satellite" },
        },
      },
    });
  });

  await page.route("**/api/neighborhood", (route) =>
    json(route, { totalEstimateCount: 412 })
  );
  await page.route("**/api/places/autocomplete", async (route) => {
    if (options.autocompleteDelayMs) {
      await new Promise((resolve) =>
        setTimeout(resolve, options.autocompleteDelayMs)
      );
    }
    await json(route, autocompleteSuccess);
  });
  await page.route("**/api/places/details**", (route) =>
    json(route, placeDetailsSuccess)
  );
  await page.route("**/api/satellite/preview", (route) =>
    json(route, satellitePreviewSuccess)
  );
  await page.route("**/api/analyze-roof", async (route) => {
    if (options.analyzeDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.analyzeDelayMs));
    }
    await json(
      route,
      options.analyzePayload ?? roofAnalysisSuccess,
      options.analyzeStatus ?? 200
    );
  });
  await page.route("**/api/satellite-image**", async (route) => {
    if (options.satelliteDelayMs) {
      await new Promise((resolve) =>
        setTimeout(resolve, options.satelliteDelayMs)
      );
    }
    await json(route, satelliteImageSuccess);
  });
  await page.route("**/api/solar/data-layers**", (route) =>
    json(route, dataLayersSuccess)
  );
  await page.route(TEST_DSM_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/tiff",
      body: TEST_DSM,
    })
  );
  await page.route("**/api/leads", async (route) => {
    if (options.leadDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.leadDelayMs));
    }
    await json(route, options.leadPayload ?? leadSuccess, options.leadStatus ?? 200);
  });
  await page.route("**/api/utility-bills", (route) =>
    json(route, { message: "Uploads are disabled in E2E tests." }, 503)
  );

  await page.route(/https:\/\/maps\.googleapis\.com\/.*/, (route) =>
    route.abort("blockedbyclient")
  );
  await page.route(/https:\/\/www\.googletagmanager\.com\/.*/, (route) =>
    route.abort("blockedbyclient")
  );
  await page.route(/https:\/\/www\.google-analytics\.com\/.*/, (route) =>
    route.abort("blockedbyclient")
  );
}

export function monitorUnexpectedErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      const text = message.text();
      if (!/ERR_BLOCKED_BY_CLIENT|favicon/i.test(text)) {
        errors.push(text);
      }
    }
  });
  return errors;
}
