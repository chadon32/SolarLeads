/**
 * Shared sunlight heatmap colouring for the 2D map overlay and the 3D roof.
 *
 * Colours are on an ABSOLUTE scale: each pixel's annual flux as a share of
 * this roof's best-case sun (Solar API maxSunshineHoursPerYear, which is in
 * the same kWh/kW/yr unit as the annual flux layer). 50% or less is the
 * shade end, 100% the sunny end. Percentile stretching made a 10% east/west
 * difference look like "shade vs sun" and tied colours to the neighbours.
 *
 * Pure (no DOM) so both views and the tests share one implementation.
 */

export type Rgb = { r: number; g: number; b: number };

const SHADE: Rgb = { r: 30, g: 64, b: 175 };
const WARM: Rgb = { r: 251, g: 191, b: 36 };
const SUNNY: Rgb = { r: 249, g: 115, b: 22 };

/** Share of best-case sun mapped to the shade end of the ramp. */
export const SUNLIGHT_RAMP_FLOOR = 0.5;

export function isValidFlux(value: number) {
  return Number.isFinite(value) && value > -9990;
}

/** Ramp position (0–1) for an annual flux value against the roof's best case. */
export function sunlightRampPosition(annualFlux: number, bestCaseFlux: number) {
  if (!isValidFlux(annualFlux) || !Number.isFinite(bestCaseFlux) || bestCaseFlux <= 0) {
    return 0;
  }
  const share = annualFlux / bestCaseFlux;
  return Math.min(1, Math.max(0, (share - SUNLIGHT_RAMP_FLOOR) / (1 - SUNLIGHT_RAMP_FLOOR)));
}

/** Shade blue → warm amber → sunny orange. */
export function sunlightRampColor(position: number): Rgb {
  const t = Math.min(1, Math.max(0, Number.isFinite(position) ? position : 0));
  return t <= 0.5 ? mix(SHADE, WARM, t / 0.5) : mix(WARM, SUNNY, (t - 0.5) / 0.5);
}

/** CSS gradient for legends, built from the same stops as the heatmap. */
export function sunlightRampGradientCss() {
  const stop = (color: Rgb, at: number) => `rgb(${color.r}, ${color.g}, ${color.b}) ${at}%`;
  return `linear-gradient(90deg, ${stop(SHADE, 0)}, ${stop(WARM, 50)}, ${stop(SUNNY, 100)})`;
}

export type RoofFluxColoringInput = {
  flux: ArrayLike<number>;
  width: number;
  height: number;
  isRoofPixel: (index: number) => boolean;
  bestCaseFlux: number;
  /**
   * Passes that bleed roof colours into neighbouring non-roof pixels, so
   * bilinear texture filtering at the eaves never samples non-roof colours.
   */
  outsideBleedPx?: number;
  /** RGBA for the remaining non-roof pixels; alpha 0 hides them on the map. */
  outsideRgba?: readonly [number, number, number, number];
  /**
   * How far (pixels) the roof must extend in every axis direction for a
   * pixel to count as interior — about 0.5 m: 1 px at 0.5 m, 2 px at 0.25 m.
   */
  interiorRadiusPx?: number;
};

/**
 * RGBA pixels for an annual-flux raster restricted to a roof.
 *
 * Edge pixels of a 0.25–0.5 m raster mix roof with wall/ground and read as
 * false "shade", so only interior roof pixels (roof for `interiorRadiusPx`
 * in every axis direction) are coloured from their own flux; edge and
 * no-data roof pixels take the average of already-coloured neighbours.
 */
export function colorRoofFlux({
  flux,
  width,
  height,
  isRoofPixel,
  bestCaseFlux,
  outsideBleedPx = 0,
  outsideRgba = [0, 0, 0, 0],
  interiorRadiusPx = 1,
}: RoofFluxColoringInput): Uint8ClampedArray {
  const count = width * height;
  const pixels = new Uint8ClampedArray(count * 4);
  const rgb = new Float32Array(count * 3);
  const filled = new Uint8Array(count);
  const roof = new Uint8Array(count);
  for (let index = 0; index < count; index++) roof[index] = isRoofPixel(index) ? 1 : 0;

  const reach = Math.max(1, Math.round(interiorRadiusPx));
  const isInterior = (index: number) => {
    const x = index % width, y = (index / width) | 0;
    for (let d = 1; d <= reach; d++) {
      if (x - d < 0 || y - d < 0 || x + d >= width || y + d >= height) return false;
      if (!roof[index - d] || !roof[index + d] || !roof[index - d * width] || !roof[index + d * width]) return false;
    }
    return true;
  };
  const paint = (index: number, color: Rgb) => {
    rgb[index * 3] = color.r;
    rgb[index * 3 + 1] = color.g;
    rgb[index * 3 + 2] = color.b;
    filled[index] = 1;
  };

  for (let index = 0; index < count; index++) {
    const value = Number(flux[index]);
    if (roof[index] && isValidFlux(value) && isInterior(index)) {
      paint(index, sunlightRampColor(sunlightRampPosition(value, bestCaseFlux)));
    }
  }

  // Edge and no-data roof pixels inherit from coloured neighbours.
  fillFromNeighbours(rgb, filled, width, height, (index) => roof[index] === 1, 64);
  for (let index = 0; index < count; index++) {
    if (roof[index] && !filled[index]) {
      paint(index, sunlightRampColor(sunlightRampPosition(Number(flux[index]), bestCaseFlux)));
    }
  }
  if (outsideBleedPx > 0) {
    fillFromNeighbours(rgb, filled, width, height, (index) => roof[index] === 0, outsideBleedPx);
  }

  for (let index = 0; index < count; index++) {
    const offset = index * 4;
    if (filled[index]) {
      pixels[offset] = Math.round(rgb[index * 3]);
      pixels[offset + 1] = Math.round(rgb[index * 3 + 1]);
      pixels[offset + 2] = Math.round(rgb[index * 3 + 2]);
      pixels[offset + 3] = 255;
    } else {
      pixels[offset] = outsideRgba[0];
      pixels[offset + 1] = outsideRgba[1];
      pixels[offset + 2] = outsideRgba[2];
      pixels[offset + 3] = outsideRgba[3];
    }
  }
  return pixels;
}

/** Breadth-wise fill: each pass colours eligible pixels touching coloured ones. */
function fillFromNeighbours(
  rgb: Float32Array,
  filled: Uint8Array,
  width: number,
  height: number,
  eligible: (index: number) => boolean,
  maxPasses: number
) {
  for (let pass = 0; pass < maxPasses; pass++) {
    const snapshot = filled.slice();
    let changed = 0;
    for (let index = 0; index < filled.length; index++) {
      if (snapshot[index] || !eligible(index)) continue;
      const x = index % width, y = (index / width) | 0;
      let r = 0, g = 0, b = 0, n = 0;
      for (const neighbour of [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, y > 0 ? index - width : -1, y < height - 1 ? index + width : -1]) {
        if (neighbour >= 0 && snapshot[neighbour]) {
          r += rgb[neighbour * 3];
          g += rgb[neighbour * 3 + 1];
          b += rgb[neighbour * 3 + 2];
          n++;
        }
      }
      if (n) {
        rgb[index * 3] = r / n;
        rgb[index * 3 + 1] = g / n;
        rgb[index * 3 + 2] = b / n;
        filled[index] = 1;
        changed++;
      }
    }
    if (!changed) break;
  }
}

function mix(left: Rgb, right: Rgb, amount: number): Rgb {
  return {
    r: Math.round(left.r + (right.r - left.r) * amount),
    g: Math.round(left.g + (right.g - left.g) * amount),
    b: Math.round(left.b + (right.b - left.b) * amount),
  };
}
