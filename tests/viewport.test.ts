import { describe, expect, it } from "vitest";
import { panFromDrag, zoomFromWheel } from "../src/ui/viewport";

describe("viewport pan", () => {
  it("uses an immutable pointer-down origin", () => {
    const origin = { pointerX: 100, pointerY: 80, viewX: 12, viewY: -4 };
    expect(panFromDrag(origin, 130, 65)).toEqual({ x: 42, y: -19 });
    expect(origin).toEqual({ pointerX: 100, pointerY: 80, viewX: 12, viewY: -4 });
  });

  it("zooms within deterministic bounds", () => {
    expect(zoomFromWheel(1, -1)).toBeCloseTo(1.1);
    expect(zoomFromWheel(2.5, -1)).toBe(2.5);
    expect(zoomFromWheel(0.3, 1)).toBe(0.3);
  });
});
