import type { Page, Route } from "playwright/test";
import { writeArrayBuffer } from "geotiff";
import type { RoofGeoBounds } from "../../src/lib/roof-analysis";
import { buildSyntheticRoof, type SyntheticRoof, type SyntheticRoofKind, type SyntheticRoofOptions } from "../fixtures/synthetic-roofs";
import { TEST_ANALYSIS_PROOF, TEST_ROOF_ANALYSIS } from "../fixtures/test-data";

/**
 * Serves a synthetic house through the analyze-roof, data-layers and GeoTIFF
 * routes. Install after `installSafeApiMocks` — later routes take precedence.
 */
export async function installSyntheticRoof(page: Page, kind: SyntheticRoofKind, options: SyntheticRoofOptions = {}): Promise<SyntheticRoof> {
  const roof = buildSyntheticRoof(kind, options);
  const roofBounds = houseBounds(roof);
  const segmentLabels = ["primary", "secondary", "garage"] as const;
  const analysis = {
    ...TEST_ROOF_ANALYSIS,
    roofShape: kind === "gable" ? "gable" : kind === "hip" ? "hip" : "complex",
    panelCount: roof.panels.length,
    originalPanelCandidateCount: roof.panels.length,
    acceptedPanelCount: roof.panels.length,
    panelWidthMeters: 1.045,
    panelHeightMeters: 1.879,
    annualSunlightHours: roof.bestCaseFlux,
    obstructionOutlines: [],
    roofBounds,
    roofSegments: roof.segments.map((segment, index) => ({
      label: segmentLabels[index] ?? "primary",
      pitchDeg: segment.pitchDeg,
      azimuthDeg: segment.azimuthDeg,
      areaM2: 60,
      panelsFit: roof.panels.filter((panel) => panel.segmentIndex === segment.segmentIndex).length,
      usable: true,
      outline: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
      bounds: roofBounds,
      segmentIndex: segment.segmentIndex,
    })),
    solarPanels: roof.panels,
    solarPanelConfigs: [{ panelsCount: roof.panels.length, yearlyEnergyDcKwh: roof.panels.length * 600 }],
  };

  const tiff = (values: Float32Array | Uint8Array) =>
    Buffer.from(
      writeArrayBuffer(values, {
        width: roof.width,
        height: roof.height,
        ModelPixelScale: [
          (roof.bounds.northeast.lng - roof.bounds.southwest.lng) / roof.width,
          (roof.bounds.northeast.lat - roof.bounds.southwest.lat) / roof.height,
          0,
        ],
        ModelTiepoint: [0, 0, 0, roof.bounds.southwest.lng, roof.bounds.northeast.lat, 0],
        GeographicTypeGeoKey: 4326,
        GeogCitationGeoKey: "WGS 84",
        GTModelTypeGeoKey: 2,
      })
    );
  const layers: Record<string, Buffer> = {
    dsm: tiff(roof.dsm),
    mask: tiff(roof.mask),
    flux: tiff(roof.flux),
  };

  const json = (route: Route, payload: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  await page.route("**/api/analyze-roof", (route) => json(route, { analysis, analysisProof: TEST_ANALYSIS_PROOF }));
  await page.route("**/api/solar/data-layers**", (route) =>
    json(route, {
      dsmUrl: `/__e2e__/synthetic-${kind}-dsm.tif`,
      maskUrl: `/__e2e__/synthetic-${kind}-mask.tif`,
      annualFluxUrl: `/__e2e__/synthetic-${kind}-flux.tif`,
      rgbUrl: null,
      imageryQuality: "HIGH",
    })
  );
  await page.route(`**/__e2e__/synthetic-${kind}-*.tif`, (route) => {
    const layer = /-(dsm|mask|flux)\.tif$/.exec(route.request().url())?.[1];
    return layer ? route.fulfill({ status: 200, contentType: "image/tiff", body: layers[layer] }) : route.fulfill({ status: 404, body: "" });
  });
  return roof;
}

/** Lat/lng bounds of the house itself (pixels whose centre lies on the roof). */
function houseBounds(roof: SyntheticRoof): RoofGeoBounds {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const step = roof.pixelSizeMeters;
  const half = (roof.width * step) / 2;
  for (let row = 0; row < roof.height; row++) {
    for (let col = 0; col < roof.width; col++) {
      const x = -half + (col + 0.5) * step, z = -half + (row + 0.5) * step;
      if (roof.roofHeightAt(x, z) === null) continue;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
  }
  return { northeast: roof.toLatLng(maxX, minZ), southwest: roof.toLatLng(minX, maxZ) };
}
