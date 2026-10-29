/** Right-hand inset, in stage pixels, for the layer underneath: the same maths
    the reference comparison used, so the split edge stays exactly under the
    divider while the content is zoomed or panned. Kept apart from the component
    so the geometry can be asserted without a browser. */
export function compareInset(input: {
  stageWidth: number;
  pos: number;
  zoom: number;
  panX: number;
}): number {
  const { stageWidth, pos, zoom, panX } = input;
  if (!(stageWidth > 0) || !(zoom > 0)) return 0;
  const dividerX = (stageWidth * pos) / 100;
  const raw = stageWidth - (dividerX - panX) / zoom;
  return Math.max(0, Math.min(stageWidth, raw));
}
