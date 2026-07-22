export interface DragOrigin {
  pointerX: number;
  pointerY: number;
  viewX: number;
  viewY: number;
}

export function panFromDrag(origin: DragOrigin, pointerX: number, pointerY: number): { x: number; y: number } {
  return {
    x: origin.viewX + pointerX - origin.pointerX,
    y: origin.viewY + pointerY - origin.pointerY
  };
}

export function zoomFromWheel(scale: number, deltaY: number): number {
  return Math.min(2.5, Math.max(0.3, scale * (deltaY > 0 ? 0.9 : 1.1)));
}
