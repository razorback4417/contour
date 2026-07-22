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
