// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/ui/App";

const styles = readFileSync("src/ui/styles.css", "utf8");

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("progressive topology interaction", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("gives the workspace all remaining viewport height", () => {
    expect(cssRule(".shell")).toMatch(/display:\s*flex/);
    expect(cssRule(".shell")).toMatch(/flex-direction:\s*column/);
    expect(cssRule("main")).toMatch(/flex:\s*1/);
  });

  function cssRule(selector: string): string {
    const start = styles.indexOf(`${selector} {`);
    return start < 0 ? "" : styles.slice(start, styles.indexOf("}", start) + 1);
  }

  it("keeps the overview to one system brief and two investigation routes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } })));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(App)));

    expect(container.querySelector("main")?.classList.contains("overview-mode")).toBe(true);
    expect(container.querySelector(".system-line")).not.toBeNull();
    expect(container.querySelectorAll(".question-card")).toHaveLength(2);
    expect(container.querySelector(".controls")).toBeNull();
    expect(container.querySelector(".details")).toBeNull();
    expect(container.querySelector(".overview-findings")).toBeNull();

    act(() => root.unmount());
    container.remove();
  });

  it("does not expose a temporary fixture while the server snapshot is loading", async () => {
    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; })));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(App)));

    expect(container.querySelector(".loading-workspace")).not.toBeNull();
    expect(container.querySelector(".question-card")).toBeNull();

    await act(async () => {
      resolveFetch(new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } }));
      await Promise.resolve();
    });
    expect(container.querySelector(".question-card")).not.toBeNull();
    act(() => root.unmount());
    container.remove();
  });

  it("starts with questions, drills into one I/O group, and traces only by explicit action", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } })));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(App)));

    expect(container.querySelector(".overview-title")?.textContent).toContain("SYSTEM");
    expect(container.querySelectorAll("g.node")).toHaveLength(0);

    act(() => container.querySelector<HTMLButtonElement>(".question-card")!.click());
    const groupedCount = container.querySelectorAll("g.node").length;
    expect(groupedCount).toBeGreaterThan(0);
    expect(groupedCount).toBeLessThan(28);

    const group = [...container.querySelectorAll<SVGGElement>("g.node")].find((node) => node.querySelector("text.secondary")?.textContent?.includes("downstream"))!;
    act(() => group.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.querySelector(".trace-state")).toBeNull();
    expect(container.querySelector(".node-actions")?.textContent).toContain("Use as endpoint A");

    act(() => container.querySelector<HTMLButtonElement>(".node-actions .primary")!.click());
    expect(container.querySelectorAll("g.node").length).toBeGreaterThan(groupedCount);

    for (const node of container.querySelectorAll<SVGGElement>("g.node")) {
      act(() => node.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      expect(container.querySelector(".details-heading h2")).not.toBeNull();
    }

    const endpoint = container.querySelector<SVGGElement>("g.node")!;
    act(() => endpoint.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const traceButton = [...container.querySelectorAll<HTMLButtonElement>(".node-actions button")].find((button) => button.textContent?.includes("endpoint A"))!;
    act(() => traceButton.click());
    expect(container.querySelector(".trace-state")?.textContent).toContain("choose endpoint B");

    const secondEndpoint = [...container.querySelectorAll<SVGGElement>("g.node")].find((node) => node !== endpoint)!;
    act(() => secondEndpoint.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const endpointB = [...container.querySelectorAll<HTMLButtonElement>(".node-actions button")].find((button) => button.textContent?.includes("endpoint B"))!;
    act(() => endpointB.click());
    expect(container.querySelector(".trace-state")?.textContent).toContain("hops");
    expect(container.querySelectorAll("path.edge.traced").length).toBeGreaterThan(0);

    const wheel = new WheelEvent("wheel", { deltaY: -1, cancelable: true });
    act(() => container.querySelector(".viewport svg")!.dispatchEvent(wheel));
    expect(wheel.defaultPrevented).toBe(true);
    act(() => root.unmount());
    container.remove();
  });

  it("keeps an immutable drag origin when pointerup is batched with pointermove", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } })));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(App)));
    act(() => container.querySelector<HTMLButtonElement>(".question-card")!.click());
    const svg = container.querySelector<SVGSVGElement>(".viewport svg")!;
    Object.defineProperty(svg, "setPointerCapture", { value: vi.fn() });
    const pointer = (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
      Object.defineProperty(event, "pointerId", { value: 1 });
      return event;
    };

    expect(() => act(() => {
      svg.dispatchEvent(pointer("pointerdown", 20, 30));
      svg.dispatchEvent(pointer("pointermove", 45, 55));
      svg.dispatchEvent(pointer("pointerup", 45, 55));
    })).not.toThrow();
    expect(svg.querySelector("g")?.getAttribute("transform")).toContain("translate(25 89)");
    act(() => root.unmount());
    container.remove();
  });

  it("does not let canvas panning capture a node click", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } })));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(App)));
    act(() => container.querySelector<HTMLButtonElement>(".question-card")!.click());

    const svg = container.querySelector<SVGSVGElement>(".viewport svg")!;
    const nodeRect = container.querySelector<SVGRectElement>("g.node > rect")!;
    const setPointerCapture = vi.fn();
    Object.defineProperty(svg, "setPointerCapture", { value: setPointerCapture });
    const pointerDown = new MouseEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100 });
    Object.defineProperty(pointerDown, "pointerId", { value: 1 });

    act(() => nodeRect.dispatchEvent(pointerDown));

    expect(setPointerCapture).not.toHaveBeenCalled();
    act(() => root.unmount());
    container.remove();
  });

  it("suggests matching hardware and selects an exact suggestion", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } })));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(App)));
    act(() => container.querySelectorAll<HTMLButtonElement>(".question-card")[0]!.click());

    const input = container.querySelector<HTMLInputElement>(".search")!;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      valueSetter.call(input, "GPU");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const suggestions = container.querySelectorAll<HTMLButtonElement>(".search-option");
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].textContent).toContain("gpu");
    act(() => suggestions[0].click());
    expect(container.querySelector("g.node.selected")).not.toBeNull();
    expect(container.querySelector(".details-heading h2")?.textContent).toBeTruthy();
    expect(container.querySelector(".search-options")).toBeNull();

    act(() => root.unmount());
    container.remove();
  });
});
