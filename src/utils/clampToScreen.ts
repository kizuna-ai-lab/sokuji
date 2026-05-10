export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorkArea extends Bounds {}

export function clampToScreen(bounds: Bounds, work: WorkArea): Bounds {
  const width = Math.min(bounds.width, work.width);
  const height = Math.min(bounds.height, work.height);
  const x = Math.max(work.x, Math.min(bounds.x, work.x + work.width - width));
  const y = Math.max(work.y, Math.min(bounds.y, work.y + work.height - height));
  return { x, y, width, height };
}
