/**
 * Front-face appearance of a PV module, from its datasheet cell layout.
 * `planModuleFace` is pure (tested); `paintModuleFace` draws a plan onto a
 * 2D canvas for the 3D viewer's glass texture.
 */

export type ModuleFaceLayout = {
  /** Cells across the module's short edge. */
  cellsAcross: number;
  /** Cell rows along the long edge (half-cut modules count half-cells). */
  cellsAlong: number;
  /** Half-cut modules are two strings with a split across the middle. */
  halfCut: boolean;
  backsheet: "black" | "white";
  frame: "black" | "silver";
  /** Visible front metallisation; back-contact cells have none. */
  frontContacts: "multi-busbar" | "none";
  /** Pseudo-square wafers with clipped corners expose the backsheet. */
  chamferedCells?: boolean;
  /** Zero-gap / gapless cell strings. */
  gapless?: boolean;
};

/** Generic modern module when a catalog entry has no face data. */
export const DEFAULT_MODULE_FACE: ModuleFaceLayout = {
  cellsAcross: 6,
  cellsAlong: 20,
  halfCut: true,
  backsheet: "black",
  frame: "black",
  frontContacts: "multi-busbar",
};

export type FaceRect = { x: number; y: number; w: number; h: number };

export type ModuleFacePlan = {
  width: number;
  height: number;
  backsheetColor: string;
  cellColors: [string, string];
  cells: FaceRect[];
  wires: FaceRect[];
  wireColor: string;
  chamferPx: number;
};

const BACKSHEET_COLORS = { black: "#05070b", white: "#c9d1db" } as const;

export function planModuleFace(
  layout: ModuleFaceLayout,
  {
    alongToAcrossRatio,
    landscape = false,
    pixelsAcrossCell = 40,
  }: { alongToAcrossRatio: number; landscape?: boolean; pixelsAcrossCell?: number }
): ModuleFacePlan {
  const across = Math.max(1, Math.round(layout.cellsAcross));
  const along = Math.max(1, Math.round(layout.cellsAlong));
  const width = across * pixelsAcrossCell;
  const ratio = Number.isFinite(alongToAcrossRatio) && alongToAcrossRatio > 0 ? alongToAcrossRatio : 1.8;
  const height = Math.round(width * ratio);
  const split = layout.halfCut ? Math.max(3, Math.round(height * 0.012)) : 0;
  const columnPitch = width / across;
  const rowPitch = (height - split) / along;
  const gap = layout.gapless ? 0 : Math.max(1, Math.round(columnPitch * 0.04));

  const cells: FaceRect[] = [];
  const wires: FaceRect[] = [];
  for (let row = 0; row < along; row++) {
    const top = row * rowPitch + (layout.halfCut && row >= along / 2 ? split : 0);
    for (let column = 0; column < across; column++) {
      const cell = { x: column * columnPitch + gap / 2, y: top + gap / 2, w: columnPitch - gap, h: rowPitch - gap };
      cells.push(cell);
      if (layout.frontContacts === "multi-busbar") {
        // Wires run along the string direction (the module's long edge).
        for (let wire = 1; wire <= 5; wire++) wires.push({ x: cell.x + (cell.w * wire) / 6, y: cell.y, w: 1, h: cell.h });
      }
    }
  }

  const portrait: ModuleFacePlan = {
    width,
    height,
    backsheetColor: BACKSHEET_COLORS[layout.backsheet],
    cellColors: layout.frontContacts === "none" ? ["#0d1016", "#090b10"] : ["#161c27", "#0c1018"],
    cells,
    wires,
    wireColor: "rgba(150, 168, 196, 0.1)",
    chamferPx: layout.chamferedCells ? Math.round(Math.min(columnPitch, rowPitch) * 0.14) : 0,
  };
  if (!landscape) return portrait;

  const transpose = ({ x, y, w, h }: FaceRect): FaceRect => ({ x: y, y: x, w: h, h: w });
  return { ...portrait, width: height, height: width, cells: cells.map(transpose), wires: wires.map(transpose) };
}

export function paintModuleFace(context: CanvasRenderingContext2D, plan: ModuleFacePlan) {
  context.fillStyle = plan.backsheetColor;
  context.fillRect(0, 0, plan.width, plan.height);
  for (const cell of plan.cells) {
    const wafer = context.createLinearGradient(cell.x, cell.y, cell.x + cell.w, cell.y + cell.h);
    wafer.addColorStop(0, plan.cellColors[0]);
    wafer.addColorStop(1, plan.cellColors[1]);
    context.fillStyle = wafer;
    const c = Math.min(plan.chamferPx, cell.w / 3, cell.h / 3);
    if (c > 0) {
      context.beginPath();
      context.moveTo(cell.x + c, cell.y);
      context.lineTo(cell.x + cell.w - c, cell.y);
      context.lineTo(cell.x + cell.w, cell.y + c);
      context.lineTo(cell.x + cell.w, cell.y + cell.h - c);
      context.lineTo(cell.x + cell.w - c, cell.y + cell.h);
      context.lineTo(cell.x + c, cell.y + cell.h);
      context.lineTo(cell.x, cell.y + cell.h - c);
      context.lineTo(cell.x, cell.y + c);
      context.closePath();
      context.fill();
    } else {
      context.fillRect(cell.x, cell.y, cell.w, cell.h);
    }
  }
  context.fillStyle = plan.wireColor;
  for (const wire of plan.wires) context.fillRect(wire.x, wire.y, wire.w, wire.h);
}
