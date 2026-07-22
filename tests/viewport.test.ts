import { describe, expect, it } from "vitest";
import { panFromDrag } from "../src/ui/viewport";

describe("viewport pan", () => {
  it("uses an immutable pointer-down origin", () => {
    const origin = { pointerX: 100, pointerY: 80, viewX: 12, viewY: -4 };
    expect(panFromDrag(origin, 130, 65)).toEqual({ x: 42, y: -19 });
    expect(origin).toEqual({ pointerX: 100, pointerY: 80, viewX: 12, viewY: -4 });
  });
});
