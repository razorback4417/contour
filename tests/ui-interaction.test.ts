// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/ui/App";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("topology interaction", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("collapses, compacts, and expands a subtree from the disclosure control", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } })));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(App)));
    const initial = container.querySelectorAll("g.node").length;
    const disclosure = container.querySelector("g.collapse-control")!;
    act(() => disclosure.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.querySelectorAll("g.node")).toHaveLength(1);
    expect(container.querySelector("g.collapse-control")?.getAttribute("aria-label")).toBe("Expand subtree");
    act(() => container.querySelector("g.collapse-control")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.querySelectorAll("g.node")).toHaveLength(initial);
    const endpoints = container.querySelectorAll("g.node");
    act(() => endpoints[4].dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => endpoints[endpoints.length - 1].dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.querySelectorAll("path.edge.traced").length).toBeGreaterThan(0);
    expect(container.querySelector(".trace-state")?.textContent).toContain("hops");
    const wheel = new WheelEvent("wheel", { deltaY: -1, cancelable: true });
    act(() => container.querySelector(".viewport svg")!.dispatchEvent(wheel));
    expect(wheel.defaultPrevented).toBe(true);
    act(() => root.unmount());
    container.remove();
  });
});
