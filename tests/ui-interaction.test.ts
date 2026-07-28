// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/ui/App";
import { normalizeArgusJsonLines } from "../src/runtime/argus";
import { runtimeBrowserWindow } from "../src/runtime/transport";

const styles = readFileSync("src/ui/styles.css", "utf8");
const runtimeWorkspaceSource = readFileSync("src/ui/RuntimeWorkspace.tsx", "utf8");

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("progressive topology interaction", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("gives the workspace all remaining viewport height", () => {
    expect(cssRule(".shell")).toMatch(/display:\s*flex/);
    expect(cssRule(".shell")).toMatch(/flex-direction:\s*column/);
    expect(cssRule("main")).toMatch(/flex:\s*1/);
  });

  it("keeps physical-link fact labels separate from their values", () => {
    expect(cssRule(".link-evidence .link-fact")).toMatch(/display:\s*grid/);
    expect(cssRule(".link-evidence .link-fact")).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+max-content/);
  });

  it("keeps overview routes comfortably inset from the browser edges", () => {
    expect(cssRule(".overview-panel")).toMatch(/calc\(100%\s*-\s*144px\)/);
    expect(cssRule(".question-card")).toMatch(/padding:\s*22px\s+12px/);
  });

  it("uses a vertically centered product mark and hostname", () => {
    expect(cssRule(".brand")).toMatch(/align-items:\s*center/);
    expect(cssRule(".brand")).toMatch(/height:\s*100%/);
    expect(cssRule(".brand-mark")).toMatch(/width:\s*20px/);
    expect(cssRule(".brand-mark")).toMatch(/height:\s*20px/);
    expect(cssRule(".host-label")).toMatch(/height:\s*20px/);
    expect(cssRule(".host-label")).toMatch(/font:\s*10px\/20px/);
  });

  it("keeps primary runtime evidence above the microtype floor", () => {
    expect(cssRule(".runtime-process-picker > summary b")).toMatch(/font:\s*12px/);
    expect(cssRule(".runtime-map-nodes text")).toMatch(/font:\s*11px/);
    expect(cssRule(".runtime-dossier dl div")).toMatch(/font:\s*9px/);
    expect(cssRule(".runtime-sequence li b")).toMatch(/font:\s*9px/);
  });

  it("eases replay state changes without expensive active-state filters", () => {
    expect(cssRule(".runtime-map-edges path")).toMatch(/transition:.*200ms ease/);
    expect(cssRule(".runtime-map-nodes > g > rect:first-child")).toMatch(/transition:.*200ms ease/);
    expect(cssRule(".runtime-sequence li")).toMatch(/transition:.*200ms ease/);
    expect(cssRule(".runtime-map-edges path.active")).not.toMatch(/filter:/);
    expect(cssRule(".runtime-map-nodes > g.active > rect:first-child")).not.toMatch(/filter:/);
    expect(runtimeWorkspaceSource).toContain("}, 980)");
    expect(runtimeWorkspaceSource).toContain('dur="760ms"');
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
    expect(container.querySelector(".brand-mark")?.getAttribute("aria-label")).toBe("Contour");
    expect(container.querySelector(".brand strong")).toBeNull();
    expect(container.querySelector(".host-label")?.textContent).toBeTruthy();
    const importButton = [...container.querySelectorAll<HTMLButtonElement>(".header-actions button")]
      .find((button) => button.textContent === "Import")!;
    act(() => importButton.click());
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("lstopo XML");
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("contour.topology/v2");
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Close topology snapshot guide"]')!.click());
    act(() => container.querySelector<HTMLButtonElement>(".action-button")!.click());
    expect(container.querySelector("#action-guide-title")?.textContent).toContain("Open an example");
    expect(container.querySelector(".action-guide")?.textContent).toContain("Export current evidence");
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector(".action-guide")).toBeNull();

    act(() => root.unmount());
    container.remove();
  });

  it("returns to the overview from the product mark", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } })));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(App)));

    act(() => container.querySelectorAll<HTMLButtonElement>(".question-card")[0]!.click());
    expect(container.querySelector("main")?.classList.contains("inspect-mode")).toBe(true);

    const home = container.querySelector<HTMLButtonElement>("button.brand")!;
    expect(home?.getAttribute("aria-label")).toBe("Return to topology overview");
    act(() => home.click());
    expect(container.querySelector("main")?.classList.contains("overview-mode")).toBe(true);
    expect(container.querySelectorAll(".question-card")).toHaveLength(2);

    act(() => root.unmount());
    container.remove();
  });

  it("replays the synthetic runtime fixture without physical topology controls", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } })));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(App)));

    const runtimeButton = [...container.querySelectorAll<HTMLButtonElement>(".primary-nav button")]
      .find((button) => button.textContent === "Runtime")!;
    act(() => runtimeButton.click());

    expect(container.querySelector(".runtime-workspace")).not.toBeNull();
    expect(container.querySelector(".runtime-heading")?.textContent).toContain("SYNTHETIC REPLAY");
    expect(container.querySelector(".runtime-investigation-bar")?.textContent).toContain("python3");
    expect(container.querySelector(".runtime-process-picker > summary label")?.textContent)
      .toBe("FOCUSED EXECUTION");
    expect(container.querySelectorAll(".runtime-investigation-bar summary > span > label"))
      .toHaveLength(2);
    expect(container.querySelector(".runtime-heading h1")?.textContent).toBe("Observed software paths");
    expect(container.querySelector(".runtime-map")?.textContent).toContain("TCP flow");
    expect(container.querySelector(".runtime-dossier")?.textContent).toContain("EXECUTION SUMMARY");
    expect(container.querySelector(".runtime-sequence")?.textContent).toContain("tcp connection created");
    expect(container.querySelector(".runtime-sequence li i")).toBeNull();
    expect(container.querySelector(".runtime-playback i")).toBeNull();
    expect(container.querySelector(".runtime-map .runtime-now")).toBeNull();
    expect(container.querySelector(".runtime-sequence > header .runtime-active-event")).not.toBeNull();
    expect(container.querySelector(".runtime-playback")?.textContent).toContain("Pause replay");
    expect(container.querySelectorAll(".runtime-map-edges path.active").length).toBeGreaterThan(0);
    act(() => container.querySelectorAll<HTMLButtonElement>(".runtime-sequence li button")[1]!.click());
    expect(container.querySelector(".runtime-data-pulse")).not.toBeNull();
    expect(container.querySelectorAll(".runtime-data-pulse").length).toBeLessThanOrEqual(2);
    expect(container.querySelector(".controls")).toBeNull();
    expect(container.querySelector(".details")).toBeNull();
    act(() => container.querySelector<HTMLButtonElement>(".runtime-evidence button")!.click());
    expect(container.querySelector("#runtime-ledger-title")?.textContent).toBe("Evidence ledger");
    expect(container.querySelectorAll(".runtime-ledger-list > button")).toHaveLength(5);
    act(() => container.querySelector<HTMLButtonElement>(".runtime-ledger-list > button")!.click());
    expect(container.querySelector(".runtime-ledger")).toBeNull();

    act(() => root.unmount());
    container.remove();
  });

  it("explains runtime evidence before import and exposes live window controls", async () => {
    const capture = normalizeArgusJsonLines(
      readFileSync("fixtures/argus/process-network-sequence.jsonl", "utf8"),
      { synthetic: false, source: "clickhouse:otel.otel_logs" },
    );
    const payload = JSON.stringify(runtimeBrowserWindow(capture, {
      earlierCursor: "opaque-cursor",
      hasEarlier: true,
      live: true,
    }));
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(payload, {
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(App)));

    const importButton = [...container.querySelectorAll<HTMLButtonElement>(".header-actions button")]
      .find((button) => button.textContent === "Import")!;
    act(() => importButton.click());
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("One emitted Argus JSON object per line");
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("contour.runtime/v1");
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Close runtime evidence guide"]')!.click());

    act(() => container.querySelector<HTMLElement>(".runtime-window-summary > summary")!.click());
    expect(container.querySelector(".runtime-window-menu")?.textContent).toContain("Earlier");
    expect(container.querySelector(".runtime-window-menu")?.textContent).toContain("Newer");
    expect(container.querySelector<HTMLInputElement>("#runtime-jump-time")?.type).toBe("datetime-local");
    expect(container.querySelector(".runtime-heading")?.textContent).toContain("LIVE");
    act(() => document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(container.querySelector<HTMLDetailsElement>(".runtime-window-summary")?.open).toBe(false);
    act(() => container.querySelector<HTMLElement>(".runtime-window-summary > summary")!.click());
    const earlier = [...container.querySelectorAll<HTMLButtonElement>(".runtime-window-menu button")]
      .find((button) => button.textContent?.includes("Earlier"))!;
    await act(async () => earlier.click());
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("cursor=opaque-cursor");
    const newer = [...container.querySelectorAll<HTMLButtonElement>(".runtime-window-menu button")]
      .find((button) => button.textContent?.includes("Newer"))!;
    expect(newer.disabled).toBe(false);
    const requestsBeforeNewer = fetchMock.mock.calls.length;
    act(() => newer.click());
    expect(fetchMock.mock.calls).toHaveLength(requestsBeforeNewer);
    const go = [...container.querySelectorAll<HTMLButtonElement>(".runtime-window-menu button")]
      .find((button) => button.textContent === "Go")!;
    await act(async () => go.click());
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("before=");

    act(() => root.unmount());
    container.remove();
  });

  it("keeps pre-window-envelope ClickHouse servers live during rolling upgrades", async () => {
    const capture = normalizeArgusJsonLines(
      readFileSync("fixtures/argus/process-network-sequence.jsonl", "utf8"),
      { synthetic: false, source: "clickhouse:otel.otel_logs" },
    );
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(capture), {
      headers: { "content-type": "application/json" },
    })));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(App)));

    expect(container.querySelector(".runtime-heading")?.textContent).toContain("LIVE · 2S REFRESH");

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
    expect(container.querySelector(".path-dossier")?.textContent).toContain("PATH DOSSIER");
    expect(container.querySelector(".dossier-route")?.textContent).toContain("Known containment route");
    expect(container.querySelector(".finding-heading")?.textContent).toContain("FINDINGS");

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
