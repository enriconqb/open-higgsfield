/** Local overlay math shared by the live canvas and the exported PNG. */

export type UnfaceMethod = "grid" | "scenery" | "x" | "sheet";

export interface GridSettings {
  columns: number;
  rows: number;
  /** Stroke width in source pixels. */
  lineWidth: number;
  /** 0–100 */
  opacity: number;
  color: string;
}

export interface ScenerySettings {
  /** 0–100 */
  opacity: number;
  /** 100 covers the portrait. */
  scale: number;
  /** Center of layer 2, 0–1 across the main image. */
  cx: number;
  cy: number;
}

export interface MarkSettings {
  /** Center, 0–1 across the source image. */
  cx: number;
  cy: number;
  /** Box width as a fraction of the image width. */
  w: number;
  /** Box height as a fraction of the image height. */
  h: number;
  rotation: number;
}

export interface Raster {
  image: CanvasImageSource;
  width: number;
  height: number;
}

export interface CompositeInput {
  image: Raster;
  method: UnfaceMethod;
  grid: GridSettings;
  scenery: ScenerySettings;
  sceneryImage: Raster | null;
  marks: MarkSettings[];
}

export const SHEET_TITLE = "CHARACTER REFERENCE SHEET";

export const DEFAULT_MARK: MarkSettings = {
  cx: 0.5,
  cy: 0.42,
  w: 0.3,
  h: 0.3,
  rotation: -8,
};

export function sheetHeaderHeight(imageWidth: number): number {
  return Math.max(56, Math.round(imageWidth * 0.14));
}

export function outputSize(
  imageWidth: number,
  imageHeight: number,
  method: UnfaceMethod,
): { width: number; height: number; header: number } {
  const header = method === "sheet" ? sheetHeaderHeight(imageWidth) : 0;
  return { width: imageWidth, height: imageHeight + header, header };
}

export function markExtent(imageWidth: number, imageHeight: number, mark: MarkSettings): number {
  const shorter = Math.min(imageWidth, imageHeight);
  if (shorter <= 0) return 1;
  const average = (mark.w * imageWidth + mark.h * imageHeight) / 2;
  return (average / shorter) * 100;
}

export function drawComposite(ctx: CanvasRenderingContext2D, input: CompositeInput): void {
  const { width: imageWidth, height: imageHeight } = input.image;
  const { width, height, header } = outputSize(imageWidth, imageHeight, input.method);

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, header, imageWidth, imageHeight);
  ctx.clip();
  ctx.drawImage(input.image.image, 0, header, imageWidth, imageHeight);

  if (input.method === "scenery" && input.sceneryImage) {
    const scale = Math.max(0.2, input.scenery.scale / 100);
    const dw = imageWidth * scale;
    const dh = imageHeight * scale;
    const dx = input.scenery.cx * imageWidth - dw / 2;
    const dy = header + input.scenery.cy * imageHeight - dh / 2;
    ctx.save();
    ctx.globalAlpha = clamp(input.scenery.opacity, 0, 100) / 100;
    ctx.globalCompositeOperation = "source-over";
    drawCover(ctx, input.sceneryImage, dx, dy, dw, dh);
    ctx.restore();
  }

  if (input.method === "grid") {
    ctx.save();
    ctx.globalAlpha = clamp(input.grid.opacity, 0, 100) / 100;
    ctx.strokeStyle = input.grid.color;
    ctx.lineWidth = Math.max(1, input.grid.lineWidth);
    ctx.lineCap = "butt";
    const columns = clamp(Math.round(input.grid.columns), 2, 16);
    const rows = clamp(Math.round(input.grid.rows), 2, 16);
    ctx.beginPath();
    for (let column = 0; column <= columns; column += 1) {
      const x = (column / columns) * imageWidth;
      ctx.moveTo(x, header);
      ctx.lineTo(x, header + imageHeight);
    }
    for (let row = 0; row <= rows; row += 1) {
      const y = header + (row / rows) * imageHeight;
      ctx.moveTo(0, y);
      ctx.lineTo(imageWidth, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  if (input.method === "x" || input.method === "sheet") {
    for (const mark of input.marks) drawMark(ctx, imageWidth, imageHeight, header, mark);
  }
  ctx.restore();

  if (input.method === "sheet") {
    ctx.fillStyle = "#f7f4ee";
    ctx.fillRect(0, 0, width, header);
    ctx.fillStyle = "#1c1e22";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const fontSize = Math.max(14, Math.round(header * 0.34));
    ctx.font = `700 ${fontSize}px Inter, ui-sans-serif, sans-serif`;
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${Math.round(fontSize * 0.08)}px`;
    ctx.fillText(SHEET_TITLE, width / 2, header / 2);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  }
}

function drawMark(
  ctx: CanvasRenderingContext2D,
  imageWidth: number,
  imageHeight: number,
  header: number,
  mark: MarkSettings,
): void {
  const boxW = Math.max(1, mark.w * imageWidth);
  const boxH = Math.max(1, mark.h * imageHeight);
  const cx = mark.cx * imageWidth;
  const cy = header + mark.cy * imageHeight;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((mark.rotation * Math.PI) / 180);
  ctx.strokeStyle = "#e23d3d";
  ctx.lineWidth = Math.max(1, Math.min(boxW, boxH) * 0.16);
  ctx.lineCap = "round";
  const inset = ctx.lineWidth / 2;
  const armX = Math.max(0, boxW / 2 - inset);
  const armY = Math.max(0, boxH / 2 - inset);
  ctx.beginPath();
  ctx.moveTo(-armX, -armY);
  ctx.lineTo(armX, armY);
  ctx.moveTo(armX, -armY);
  ctx.lineTo(-armX, armY);
  ctx.stroke();
  ctx.restore();
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  raster: Raster,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  const scale = Math.max(dw / raster.width, dh / raster.height);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (raster.width - sw) / 2;
  const sy = (raster.height - sh) / 2;
  ctx.drawImage(raster.image, sx, sy, sw, sh, dx, dy, dw, dh);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function fitBox(
  boardWidth: number,
  boardHeight: number,
  outputWidth: number,
  outputHeight: number,
): { left: number; top: number; width: number; height: number; scale: number } {
  const pad = 28;
  const maxWidth = Math.max(1, boardWidth - pad * 2);
  const maxHeight = Math.max(1, boardHeight - pad * 2);
  const scale = Math.min(maxWidth / outputWidth, maxHeight / outputHeight);
  const width = outputWidth * scale;
  const height = outputHeight * scale;
  return {
    left: (boardWidth - width) / 2,
    top: (boardHeight - height) / 2,
    width,
    height,
    scale,
  };
}
