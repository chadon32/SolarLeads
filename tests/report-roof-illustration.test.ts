import assert from "node:assert/strict";
import test from "node:test";
import { selectCohesiveSolarPanels } from "../src/lib/panel-layout";
import {
  buildReportRoofIllustration,
  type ReportRoofIllustration,
} from "../src/lib/report-roof-illustration";
import type { SolarPanelPlacement } from "../src/lib/roof-analysis";
import type { SolarReportSnapshot } from "../src/lib/report-snapshot";
import { TEST_ROOF_ANALYSIS } from "./fixtures/test-data";

function makeSnapshot({
  panelCount = TEST_ROOF_ANALYSIS.panelCount,
  acceptedPanelCount = panelCount,
  panels = TEST_ROOF_ANALYSIS.solarPanels,
  segments = TEST_ROOF_ANALYSIS.roofSegments,
  source = "solar-api",
}: {
  panelCount?: number;
  acceptedPanelCount?: number;
  panels?: unknown[];
  segments?: unknown[];
  source?: string;
} = {}) {
  return {
    panelCount,
    roofAnalysis: {
      ...TEST_ROOF_ANALYSIS,
      acceptedPanelCount,
      panelCount,
      roofSegments: segments,
      solarPanels: panels,
      source,
    },
  } as unknown as SolarReportSnapshot;
}

function makePanel({
  lat,
  lng,
  segmentIndex = 0,
  azimuthDeg = 180,
  pitchDeg = 20,
  rowIndex = null,
  columnIndex = null,
}: {
  lat: number;
  lng: number;
  segmentIndex?: number;
  azimuthDeg?: number;
  pitchDeg?: number;
  rowIndex?: number | null;
  columnIndex?: number | null;
}): SolarPanelPlacement {
  return {
    center: { lat, lng },
    orientation: "PORTRAIT" as const,
    azimuthDeg,
    pitchDeg,
    rowIndex,
    columnIndex,
    yearlyEnergyDcKwh: 680,
    segmentIndex,
  };
}

function makeMixedSegments() {
  const common = {
    areaM2: 44,
    bounds: TEST_ROOF_ANALYSIS.roofBounds,
    label: "primary" as const,
    panelsFit: 2,
    usable: true,
  };
  return [
    {
      ...common,
      segmentIndex: 0,
      pitchDeg: 12,
      azimuthDeg: 180,
      outline: [
        { x: 10, y: 14 },
        { x: 48, y: 14 },
        { x: 48, y: 86 },
        { x: 10, y: 86 },
      ],
    },
    {
      ...common,
      segmentIndex: 1,
      pitchDeg: 34,
      azimuthDeg: 90,
      outline: [
        { x: 52, y: 14 },
        { x: 90, y: 14 },
        { x: 90, y: 86 },
        { x: 52, y: 86 },
      ],
    },
  ];
}

function assertFiniteIllustration(illustration: ReportRoofIllustration) {
  assert.equal(illustration.available, true);
  assert.equal(illustration.availability, "available");
  assert.ok(illustration.extents);
  for (const value of Object.values(illustration.extents)) {
    assert.ok(Number.isFinite(value), `non-finite extent ${value}`);
  }
  for (const polygon of illustration.projectedPolygons) {
    assert.ok(["roof", "wall", "panel"].includes(polygon.kind));
    assert.ok(Number.isFinite(polygon.depth));
    assert.ok(polygon.shade >= 0 && polygon.shade <= 1);
    for (const point of polygon.points) {
      assert.ok(Number.isFinite(point.x));
      assert.ok(Number.isFinite(point.y));
    }
  }
}

test("builds finite shaded roofs, walls, and panels from saved Solar API faces", () => {
  const illustration = buildReportRoofIllustration(makeSnapshot());

  assertFiniteIllustration(illustration);
  assert.equal(illustration.renderedPanelCount, TEST_ROOF_ANALYSIS.solarPanels.length);
  assert.ok(illustration.projectedPolygons.some((polygon) => polygon.kind === "roof"));
  assert.ok(illustration.projectedPolygons.some((polygon) => polygon.kind === "wall"));
  assert.ok(illustration.projectedPolygons.some((polygon) => polygon.kind === "panel"));
  assert.ok(illustration.limitationLabels.some((label) => /approximate/i.test(label)));
  assert.match(illustration.caption, /DSM|elevation scan/i);
  assert.deepEqual(illustration.polygons, illustration.projectedPolygons);

  for (const segmentIndex of new Set(
    illustration.projectedPolygons.map((polygon) => polygon.segmentIndex)
  )) {
    const group = illustration.projectedPolygons.flatMap((polygon, index) =>
      polygon.segmentIndex === segmentIndex ? [{ polygon, index }] : []
    );
    const roofIndex = group.find(({ polygon }) => polygon.kind === "roof")?.index;
    const panelIndices = group
      .filter(({ polygon }) => polygon.kind === "panel")
      .map(({ index }) => index);
    assert.ok(roofIndex !== undefined);
    assert.ok(panelIndices.every((index) => roofIndex! < index));
    assert.ok(
      group
        .filter(({ polygon }) => polygon.kind === "wall")
        .every(({ index }) => panelIndices.every((panelIndex) => index < panelIndex)),
      "walls should be drawn before panels in their owning face group"
    );
  }
});

test("honors the snapshot-selected count over the accepted capacity list", () => {
  const panels = TEST_ROOF_ANALYSIS.solarPanels;
  const selectedTen = buildReportRoofIllustration(
    makeSnapshot({ panelCount: 10, acceptedPanelCount: 20, panels })
  );
  assert.equal(selectedTen.renderedPanelCount, 10);
  assert.equal(
    selectedTen.projectedPolygons.filter((polygon) => polygon.kind === "panel").length,
    10
  );

  const selectedNone = buildReportRoofIllustration(
    makeSnapshot({ panelCount: 0, acceptedPanelCount: 20, panels })
  );
  assert.equal(selectedNone.renderedPanelCount, 0);
  assert.equal(
    selectedNone.projectedPolygons.filter((polygon) => polygon.kind === "panel").length,
    0
  );

  const metricsFallback = {
    ...makeSnapshot({ panelCount: 20, acceptedPanelCount: 20, panels }),
    panelCount: null,
    metrics: { panelCount: 4 },
  } as unknown as SolarReportSnapshot;
  const fromMetrics = buildReportRoofIllustration(metricsFallback);
  assert.equal(fromMetrics.renderedPanelCount, 4);
});

test("uses the cohesive panel selector and never renders outside-face replacements", () => {
  const panels: SolarPanelPlacement[] = TEST_ROOF_ANALYSIS.solarPanels.slice(0, 8);
  const snapshot = makeSnapshot({ panelCount: 6, acceptedPanelCount: 6, panels });
  const illustration = buildReportRoofIllustration(snapshot);
  const expected = selectCohesiveSolarPanels({
    panels,
    targetCount: 6,
    panelWidthMeters: TEST_ROOF_ANALYSIS.panelWidthMeters,
    panelHeightMeters: TEST_ROOF_ANALYSIS.panelHeightMeters,
  });
  const expectedIndices = expected
    .map((panel) => panels.indexOf(panel))
    .sort((left, right) => left - right);
  const actualIndices = illustration.projectedPolygons
    .filter((polygon) => polygon.kind === "panel")
    .map((polygon) => polygon.panelIndex ?? -1)
    .sort((left, right) => left - right);

  assert.deepEqual(actualIndices, expectedIndices);
  assert.equal(illustration.renderedPanelCount, expected.length);

  const outside = makePanel({
    lat: TEST_ROOF_ANALYSIS.roofBounds!.northeast.lat + 0.0001,
    lng: TEST_ROOF_ANALYSIS.roofBounds!.northeast.lng + 0.0001,
  });
  const withOutside = buildReportRoofIllustration(
    makeSnapshot({
      panelCount: 99,
      acceptedPanelCount: 99,
      panels: [...panels, outside],
    })
  );
  assert.equal(withOutside.renderedPanelCount, panels.length);
  assert.ok(withOutside.renderedPanelCount <= panels.length + 1);
  assert.ok(
    withOutside.limitationLabels.some((label) => /outside valid saved roof faces/i.test(label))
  );
  assert.ok(
    withOutside.projectedPolygons
      .filter((polygon) => polygon.kind === "panel")
      .every((polygon) => polygon.panelIndex !== panels.length)
  );
});

test("mixed faces remain available and different pitch changes the projection", () => {
  const bounds = TEST_ROOF_ANALYSIS.roofBounds!;
  const panels = [
    makePanel({
      lat: (bounds.northeast.lat + bounds.southwest.lat) / 2,
      lng: bounds.southwest.lng + (bounds.northeast.lng - bounds.southwest.lng) * 0.3,
      segmentIndex: 0,
    }),
    makePanel({
      lat: (bounds.northeast.lat + bounds.southwest.lat) / 2,
      lng: bounds.southwest.lng + (bounds.northeast.lng - bounds.southwest.lng) * 0.7,
      segmentIndex: 1,
      azimuthDeg: 90,
      pitchDeg: 34,
    }),
  ];
  const segments = makeMixedSegments();
  const mixed = buildReportRoofIllustration(
    makeSnapshot({ panelCount: 2, acceptedPanelCount: 2, panels, segments })
  );
  assertFiniteIllustration(mixed);
  assert.equal(mixed.renderedPanelCount, 2);
  assert.equal(mixed.projectedPolygons.filter((polygon) => polygon.kind === "roof").length, 2);
  assert.equal(mixed.projectedPolygons.filter((polygon) => polygon.kind === "panel").length, 2);
  for (const segmentIndex of [0, 1]) {
    const group = mixed.projectedPolygons.flatMap((polygon, index) =>
      polygon.segmentIndex === segmentIndex ? [{ polygon, index }] : []
    );
    const roofIndex = group.find(({ polygon }) => polygon.kind === "roof")!.index;
    const panelIndex = group.find(({ polygon }) => polygon.kind === "panel")!.index;
    assert.ok(roofIndex < panelIndex, `segment ${segmentIndex} roof must precede its panel`);
  }

  const lowPitch = buildReportRoofIllustration(
    makeSnapshot({
      panelCount: 0,
      acceptedPanelCount: 0,
      panels: [],
      segments: [
        {
          ...makeMixedSegments()[0],
          pitchDeg: 4,
        },
      ],
    })
  );
  const highPitch = buildReportRoofIllustration(
    makeSnapshot({
      panelCount: 0,
      acceptedPanelCount: 0,
      panels: [],
      segments: [
        {
          ...makeMixedSegments()[0],
          pitchDeg: 36,
        },
      ],
    })
  );
  const lowRoof = lowPitch.projectedPolygons.find((polygon) => polygon.kind === "roof")!;
  const highRoof = highPitch.projectedPolygons.find((polygon) => polygon.kind === "roof")!;
  assert.ok(
    lowRoof.points.some((point, index) => Math.abs(point.y - highRoof.points[index].y) > 0.01),
    "pitch should affect projected roof coordinates"
  );
});

test("an undrawable selected panel is omitted instead of replaced by a different candidate", () => {
  const panels = [
    { ...TEST_ROOF_ANALYSIS.solarPanels[0], segmentIndex: 99, yearlyEnergyDcKwh: 10_000 },
    { ...TEST_ROOF_ANALYSIS.solarPanels[1], yearlyEnergyDcKwh: 100 },
  ];
  const illustration = buildReportRoofIllustration(makeSnapshot({ panelCount: 1, acceptedPanelCount: 2, panels }));
  assert.equal(illustration.available, true);
  assert.equal(illustration.renderedPanelCount, 0);
  assert.ok(!illustration.projectedPolygons.some((polygon) => polygon.kind === "panel"));
});

test("returns unavailable for modeled, missing, or unusable saved geometry", () => {
  const cases = [
    makeSnapshot({ source: "modeled" }),
    makeSnapshot({ segments: [] }),
    {
      ...makeSnapshot(),
      roofAnalysis: {
        ...makeSnapshot().roofAnalysis,
        roofBounds: null,
      },
    } as unknown as SolarReportSnapshot,
    {
      ...makeSnapshot(),
      roofAnalysis: {
        ...makeSnapshot().roofAnalysis,
        roofSegments: [
          {
            ...TEST_ROOF_ANALYSIS.roofSegments[0],
            outline: [{ x: Number.NaN, y: 20 }],
          },
        ],
      },
    } as unknown as SolarReportSnapshot,
  ];

  for (const snapshot of cases) {
    const illustration = buildReportRoofIllustration(snapshot);
    assert.equal(illustration.availability, "unavailable");
    assert.equal(illustration.available, false);
    assert.equal(illustration.projectedPolygons.length, 0);
    assert.equal(illustration.renderedPanelCount, 0);
    assert.equal(illustration.extents, null);
    assert.ok(illustration.title.length > 0);
    assert.ok(illustration.caption.length > 0);
  }
});
