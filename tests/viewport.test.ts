import { describe, expect, it } from "vitest";
import { panFromDrag, zoomFromWheel } from "../src/ui/viewport";

describe("viewport pan", () => {
  it("uses an immutable pointer-down origin", () => {
    const origin = { pointerX: 100, pointerY: 80, viewX: 12, viewY: -4 };
    expect(panFromDrag(origin, 130, 65)).toEqual({ x: 42, y: -19 });
    expect(origin).toEqual({ pointerX: 100, pointerY: 80, viewX: 12, viewY: -4 });
  });

  it("zooms smoothly across trackpad and mouse-wheel deltas within deterministic bounds", () => {
    expect(zoomFromWheel(1, -1)).toBeCloseTo(Math.exp(0.00125));
    expect(zoomFromWheel(1, -100)).toBeCloseTo(Math.exp(0.05));
    expect(zoomFromWheel(1, 100)).toBeCloseTo(Math.exp(-0.05));
    expect(zoomFromWheel(1, 0)).toBe(1);
    expect(zoomFromWheel(2.5, -100)).toBe(2.5);
    expect(zoomFromWheel(0.3, 100)).toBe(0.3);
  });
});
