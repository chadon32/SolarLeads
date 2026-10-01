/**
 * Raster → polygon helpers shared by the roof reconstruction and the
 * surroundings extraction. Coordinates are pixel-edge units (a vertex at
 * x = 3 lies on the edge between columns 2 and 3).
 */

export type Point = [number, number];

/**
 * Marching squares over pixel-centre samples → closed loops. Segments keep
 * the inside on the right (y down), so every midpoint has exactly one
 * outgoing segment and loops chain cleanly.
 */
export function traceRasterLoops(
  inside: (x: number, y: number) => boolean,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): Point[][] {
  const outgoing = new Map<string, Point[]>();
  const add = (from: Point, to: Point) => {
    const key = `${from[0]},${from[1]}`;
    const list = outgoing.get(key) ?? [];
    list.push(to);
    outgoing.set(key, list);
  };
  for (let y = y0 - 1; y <= y1; y++) {
    for (let x = x0 - 1; x <= x1; x++) {
      const tl = inside(x, y), tr = inside(x + 1, y), br = inside(x + 1, y + 1), bl = inside(x, y + 1);
      const top: Point = [x + 1, y + 0.5], right: Point = [x + 1.5, y + 1], bottom: Point = [x + 1, y + 1.5], left: Point = [x + 0.5, y + 1];
      switch ((tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0)) {
        case 1: add(left, bottom); break;
        case 2: add(bottom, right); break;
        case 3: add(left, right); break;
        case 4: add(right, top); break;
        case 5: add(left, top); add(right, bottom); break;
        case 6: add(bottom, top); break;
        case 7: add(left, top); break;
        case 8: add(top, left); break;
        case 9: add(top, bottom); break;
        case 10: add(top, right); add(bottom, left); break;
        case 11: add(top, right); break;
        case 12: add(right, left); break;
        case 13: add(right, bottom); break;
        case 14: add(bottom, left); break;
        default: break;
      }
    }
  }
  const loops: Point[][] = [];
  for (const [startKey, startList] of outgoing) {
    if (!startList.length) continue;
    const start = startKey.split(",").map(Number) as Point;
    const loop: Point[] = [start];
    let current = start;
    for (let guard = 0; guard < 1_000_000; guard++) {
      const next = outgoing.get(`${current[0]},${current[1]}`)?.pop();
      if (!next || (next[0] === start[0] && next[1] === start[1])) break;
      loop.push(next);
      current = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/** Douglas–Peucker for a closed ring, split at its two farthest-apart points. */
export function simplifyClosedLoop(points: Point[], tolerance: number): Point[] {
  if (points.length < 4) return points;
  let far = 0, farDistance = -1;
  for (let k = 1; k < points.length; k++) {
    const d = (points[k][0] - points[0][0]) ** 2 + (points[k][1] - points[0][1]) ** 2;
    if (d > farDistance) {
      farDistance = d;
      far = k;
    }
  }
  const first = douglasPeucker(points.slice(0, far + 1), tolerance);
  const second = douglasPeucker([...points.slice(far), points[0]], tolerance);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

function douglasPeucker(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  const [ax, ay] = points[0], [bx, by] = points[points.length - 1];
  const length = Math.hypot(bx - ax, by - ay) || 1e-9;
  let index = -1, maxDistance = 0;
  for (let k = 1; k < points.length - 1; k++) {
    const d = Math.abs((bx - ax) * (ay - points[k][1]) - (ax - points[k][0]) * (by - ay)) / length;
    if (d > maxDistance) {
      maxDistance = d;
      index = k;
    }
  }
  if (maxDistance <= tolerance) return [points[0], points[points.length - 1]];
  return [...douglasPeucker(points.slice(0, index + 1), tolerance).slice(0, -1), ...douglasPeucker(points.slice(index), tolerance)];
}

/** Width across a pixel region's principal axis (a strip of width w has variance w²/12). */
export function regionWidthPixels(region: number[], width: number) {
  let mx = 0, my = 0;
  for (const i of region) {
    mx += i % width;
    my += (i / width) | 0;
  }
  mx /= region.length;
  my /= region.length;
  let cxx = 0, cyy = 0, cxy = 0;
  for (const i of region) {
    const ex = (i % width) - mx, ey = ((i / width) | 0) - my;
    cxx += ex * ex;
    cyy += ey * ey;
    cxy += ex * ey;
  }
  cxx /= region.length;
  cyy /= region.length;
  cxy /= region.length;
  const minorVariance = (cxx + cyy) / 2 - Math.sqrt(((cxx - cyy) / 2) ** 2 + cxy * cxy);
  return Math.sqrt(12 * Math.max(0, minorVariance) + 1);
}
