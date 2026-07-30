// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/ui/App";
import { normalizeArgusJsonLines } from "../src/runtime/argus";
import { buildRuntimeGraph } from "../src/runtime/graph";
import { runtimeBrowserWindow } from "../src/runtime/transport";
import { RuntimeDossier } from "../src/ui/RuntimeDossier";
import { RuntimeWorkspace } from "../src/ui/RuntimeWorkspace";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("progressive topology interaction", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("presents physical topology and runtime evidence as separate peer workspaces", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } })));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(App)));

    expect(container.querySelector("main")?.classList.contains("overview-mode")).toBe(true);
    expect(container.querySelector(".overview-title h1")?.textContent)
      .toBe("Choose an evidence workspace");
    expect(container.querySelectorAll(".workspace-card")).toHaveLength(2);
    expect(container.querySelector(".physical-workspace")?.textContent)
      .toContain("Physical topology");
    expect(container.querySelector(".physical-workspace")?.textContent)
      .toContain("Bundled example");
    expect(container.querySelector(".runtime-workspace-card")?.textContent)
      .toContain("Runtime evidence");
    expect(container.querySelector(".runtime-workspace-card")?.textContent)
      .toContain("Synthetic replay");
    expect(container.querySelector(".brand-mark")?.getAttribute("aria-label")).toBe("Contour");
    expect(container.querySelector(".host-label")?.textContent).toBe("Contour");
    expect(container.querySelector(".primary-nav")?.getAttribute("aria-label"))
      .toBe("Contour workspaces");
    expect(container.querySelector(".primary-nav")?.textContent)
      .toContain("Runtime evidence");
    const importButton = [...container.querySelectorAll<HTMLButtonElement>(".header-actions button")]
      .find((button) => button.textContent === "Import")!;
    act(() => importButton.click());
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("lstopo XML");
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Argus JSONL");
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Close evidence import guide"]')!.click());
    act(() => container.querySelector<HTMLButtonElement>(".action-button")!.click());
    expect(container.querySelector("#action-guide-title")?.textContent).toContain("Open an example");
    expect(container.querySelector(".action-guide")?.textContent)
      .toContain("Open a workspace before exporting");
    expect(container.querySelector(".action-guide")?.textContent)
      .not.toContain("Export current evidence");
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector(".action-guide")).toBeNull();

    act(() => [...container.querySelectorAll<HTMLButtonElement>(".workspace-actions button")]
      .find((button) => button.textContent === "Open I/O topology")!.click());
    expect(container.querySelector("main")?.classList.contains("inspect-mode")).toBe(true);

    const home = container.querySelector<HTMLButtonElement>("button.brand")!;
    expect(home?.getAttribute("aria-label")).toBe("Return to Contour overview");
    act(() => home.click());
    expect(container.querySelector("main")?.classList.contains("overview-mode")).toBe(true);
    expect(container.querySelectorAll(".workspace-card")).toHaveLength(2);

    act(() => root.unmount());
    container.remove();
  });

  it("replays a synthetic runtime window and highlights selected activity", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } })));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(App)));

    const runtimeButton = [...container.querySelectorAll<HTMLButtonElement>(".primary-nav button")]
      .find((button) => button.textContent === "Runtime evidence")!;
    act(() => runtimeButton.click());

    expect(container.querySelector(".runtime-workspace")).not.toBeNull();
    expect(container.querySelector(".runtime-heading")?.textContent).toContain("SYNTHETIC REPLAY");
    expect(container.querySelector(".runtime-investigation-bar")?.textContent).toContain("python3");
    expect(container.querySelector(".runtime-process-picker > summary label")?.textContent)
      .toBe("FOCUSED EXECUTION");
    expect(container.querySelector(".runtime-heading h1")?.textContent).toBe("Observed software paths");
    expect(container.querySelector(".runtime-map")?.textContent).toContain("TCP flow");
    expect(container.querySelector(".runtime-dossier")?.textContent).toContain("EXECUTION SUMMARY");
    expect(container.querySelector(".runtime-sequence")?.textContent).toContain("tcp connection created");
    expect(container.querySelector(".runtime-sequence > header .runtime-active-event")).not.toBeNull();
    expect(container.querySelector(".runtime-playback-state")?.textContent)
      .toContain("Replay playing");
    const initialClock = container.querySelector(".runtime-replay-clock")?.textContent;
    expect(initialClock).toMatch(/00:00\.000\s*\/\s*00:04\.000/);
    expect(container.querySelector(".runtime-replay-position")?.textContent)
      .toContain("events");
    expect(container.querySelector(".runtime-replay-transport")?.textContent)
      .toContain("Pulses appear when an event has a mapped data path");
    act(() => vi.advanceTimersByTime(250));
    expect(container.querySelector(".runtime-replay-clock")?.textContent)
      .not.toBe(initialClock);
    expect(container.querySelector(".runtime-playback")?.textContent).toContain("Pause replay");
    expect(container.querySelector(".runtime-playback")?.textContent).toContain("Restart replay");
    act(() => [...container.querySelectorAll<HTMLButtonElement>(".runtime-playback button")]
      .find((button) => button.textContent === "Pause replay")!.click());
    expect(container.querySelector(".runtime-playback-state")?.textContent)
      .toContain("Replay paused");
    expect(container.querySelector(".runtime-playback")?.textContent).toContain("Play replay");
    act(() => [...container.querySelectorAll<HTMLButtonElement>(".runtime-playback button")]
      .find((button) => button.textContent === "Play replay")!.click());
    expect(container.querySelector(".runtime-playback-state")?.textContent)
      .toContain("Replay playing");
    const scrubber = container.querySelector<HTMLInputElement>(
      '[aria-label="Scrub replay timeline"]',
    )!;
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      valueSetter.call(scrubber, "3000");
      scrubber.dispatchEvent(new Event("input", { bubbles: true }));
      scrubber.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelector(".runtime-replay-clock")?.textContent)
      .toMatch(/00:03\.000\s*\/\s*00:04\.000/);
    expect(container.querySelector(".runtime-playback-state")?.textContent)
      .toContain("Replay paused");
    expect(container.querySelectorAll(".runtime-map-edges path.active").length).toBeGreaterThan(0);
    act(() => container.querySelectorAll<HTMLButtonElement>(".runtime-sequence li button")[1]!.click());
    expect(container.querySelector(".runtime-data-pulse")).not.toBeNull();
    act(() => [...container.querySelectorAll<HTMLButtonElement>(".runtime-playback button")]
      .find((button) => button.textContent === "Restart replay")!.click());
    expect(container.querySelector(".runtime-replay-clock")?.textContent)
      .toMatch(/00:00\.000\s*\/\s*00:04\.000/);
    expect(container.querySelector(".runtime-replay-position")?.textContent)
      .toContain("events ahead");

    act(() => root.unmount());
    container.remove();
  });

  it("keeps a one-event replay visibly moving through its evidence window", async () => {
    vi.useFakeTimers();
    const source = normalizeArgusJsonLines(
      readFileSync("fixtures/argus/process-network-sequence.jsonl", "utf8"),
      { synthetic: true },
    );
    const observation = source.observations.find((item) =>
      item.kind === "process_started")!;
    const capture = {
      ...source,
      captureId: `${source.captureId}-single-event`,
      observations: [observation],
      startedAt: observation.observedAt,
      endedAt: new Date(Date.parse(observation.observedAt) + 2_000).toISOString(),
    };
    const graph = buildRuntimeGraph(capture);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(RuntimeWorkspace, {
      capture,
      graph,
    })));

    expect(container.querySelector(".runtime-replay-position")?.textContent)
      .toContain("Event 1 of 1");
    const initialClock = container.querySelector(".runtime-replay-clock")?.textContent;
    act(() => vi.advanceTimersByTime(500));
    expect(container.querySelector(".runtime-replay-clock")?.textContent)
      .not.toBe(initialClock);

    act(() => root.unmount());
    container.remove();
  });

  it("opens and copies the normalized JSON for selected runtime evidence", async () => {
    const capture = normalizeArgusJsonLines(
      readFileSync("fixtures/argus/process-network-sequence.jsonl", "utf8"),
      { synthetic: true },
    );
    const graph = buildRuntimeGraph(capture);
    const process = graph.nodes.find((node) => node.kind === "process_execution")!;
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(RuntimeDossier, { graph, node: process })));

    act(() => [...container.querySelectorAll<HTMLButtonElement>(".runtime-dossier button")]
      .find((button) => button.textContent === "View JSON")!.click());
    const executionJson = container.querySelector(".runtime-json-dialog pre")?.textContent ?? "";
    expect(container.querySelector(".runtime-json-dialog")?.getAttribute("aria-modal")).toBe("true");
    expect(executionJson).toContain('"kind": "process_execution"');
    expect(executionJson).toContain('"relationships"');
    await act(async () => container.querySelector<HTMLButtonElement>(".runtime-json-copy")!.click());
    expect(writeText).toHaveBeenCalledWith(executionJson);
    act(() => container.querySelector<HTMLButtonElement>(
      '[aria-label="Close evidence JSON"]',
    )!.click());
    expect(container.querySelector(".runtime-json-dialog")).toBeNull();

    act(() => root.unmount());
    container.remove();
  });

  it("exposes runtime compatibility and the normalized evidence ledger", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not found", {
      status: 404,
      headers: { "content-type": "text/plain" },
    })));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(App)));
    act(() => [...container.querySelectorAll<HTMLButtonElement>(".primary-nav button")]
      .find((button) => button.textContent === "Runtime evidence")!.click());

    expect(container.querySelector(".runtime-compatibility > summary")?.textContent)
      .toContain("5 normalized · 0 diagnostics");
    act(() => container.querySelector<HTMLElement>(".runtime-compatibility > summary")!.click());
    expect(container.querySelector(".runtime-compatibility")?.textContent).toContain("DOCA_ARGUS");
    expect(container.querySelector(".runtime-compatibility")?.textContent).toContain("product 1.4.0");
    act(() => container.querySelector<HTMLButtonElement>(".runtime-evidence button")!.click());
    expect(container.querySelector("#runtime-ledger-title")?.textContent).toBe("Evidence ledger");
    expect(container.querySelectorAll(".runtime-ledger-list > button")).toHaveLength(5);
    act(() => container.querySelector<HTMLButtonElement>(".runtime-ledger-list > button")!.click());
    expect(container.querySelector(".runtime-ledger")).toBeNull();

    act(() => root.unmount());
    container.remove();
  });

  it("presents the observed working directory as primary process evidence", async () => {
    const capture = normalizeArgusJsonLines(
      readFileSync("fixtures/argus/process-network-sequence.jsonl", "utf8"),
      { synthetic: true },
    );
    capture.observations[1]!.process!.currentWorkingDirectory = "/sys/fs/cgroup";
    const graph = buildRuntimeGraph(capture);
    const process = graph.nodes.find((node) => node.kind === "process_execution")!;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(createElement(RuntimeDossier, { graph, node: process })));

    expect(container.querySelector(".runtime-dossier")?.textContent)
      .toContain("current working directory");
    expect(container.querySelector(".runtime-dossier")?.textContent).toContain("/sys/fs/cgroup");

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
    expect(container.querySelector(".runtime-window-summary > summary")?.textContent)
      .toContain("2026-07-27 · 11:00:00–11:00:04 PDT");
    expect(container.querySelector(".runtime-window-menu")?.textContent)
      .toContain("Pacific Time");
    const jumpInput = container.querySelector<HTMLInputElement>("#runtime-jump-time")!;
    expect(jumpInput.type).toBe("datetime-local");
    expect(jumpInput.value).toBe("2026-07-27T11:00:04.000");
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
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      valueSetter.call(jumpInput, "2026-01-15T10:30:00");
      jumpInput.dispatchEvent(new Event("input", { bubbles: true }));
      jumpInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const go = [...container.querySelectorAll<HTMLButtonElement>(".runtime-window-menu button")]
      .find((button) => button.textContent === "Go")!;
    await act(async () => go.click());
    const jumpRequest = new URL(
      String(fetchMock.mock.calls.at(-1)?.[0]),
      "http://contour.test",
    );
    expect(jumpRequest.searchParams.get("before")).toBe("2026-01-15T18:30:00.000Z");

    act(() => root.unmount());
    container.remove();
  });

  it("keeps pre-window-envelope ClickHouse servers live during rolling upgrades", async () => {
    const capture = normalizeArgusJsonLines(
      readFileSync("fixtures/argus/process-network-sequence.jsonl", "utf8"),
      { synthetic: false, source: "clickhouse:otel.otel_logs" },
    );
    let holdNextRequest = false;
    let resolveHeldRequest!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => {
      if (holdNextRequest) {
        holdNextRequest = false;
        return new Promise<Response>((resolve) => { resolveHeldRequest = resolve; });
      }
      return Promise.resolve(new Response(JSON.stringify(capture), {
        headers: { "content-type": "application/json" },
      }));
    }));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(App)));

    expect(container.querySelector(".runtime-feed-status")?.textContent)
      .toContain("LIVE · FOLLOWING");
    expect(container.querySelector(".runtime-live-beacon")).not.toBeNull();
    expect(container.querySelector(".runtime-playback-state")?.textContent)
      .toContain("Following live");
    act(() => [...container.querySelectorAll<HTMLButtonElement>(".runtime-playback button")]
      .find((button) => button.textContent === "Pause live view")!.click());
    expect(container.querySelector(".runtime-heading")?.textContent)
      .toContain("LIVE FEED · VIEW PAUSED");
    expect(container.querySelector(".runtime-live-beacon")).toBeNull();
    expect(container.querySelector(".runtime-playback-state")?.textContent)
      .toContain("Live view paused");
    expect(container.querySelector(".runtime-playback")?.textContent)
      .toContain("Resume live view");

    holdNextRequest = true;
    act(() => [...container.querySelectorAll<HTMLButtonElement>(".runtime-playback button")]
      .find((button) => button.textContent === "Resume live view")!.click());
    await act(async () => Promise.resolve());
    expect(container.querySelector(".runtime-playback")?.getAttribute("aria-busy"))
      .toBe("true");
    expect(container.querySelector(".runtime-playback")?.textContent)
      .toContain("Returning to live…");
    expect([...container.querySelectorAll<HTMLButtonElement>(".runtime-playback button")]
      .every((button) => button.disabled)).toBe(true);
    expect(container.querySelector(".runtime-control-spinner")).not.toBeNull();

    const updatedCapture = {
      ...capture,
      captureId: `${capture.captureId}-updated`,
      endedAt: new Date(Date.parse(capture.endedAt) + 1_000).toISOString(),
    };
    await act(async () => {
      resolveHeldRequest(new Response(JSON.stringify(updatedCapture), {
        headers: { "content-type": "application/json" },
      }));
      await Promise.resolve();
    });
    expect(container.querySelector(".runtime-playback")?.getAttribute("aria-busy"))
      .toBe("false");
    expect(container.querySelector(".runtime-playback-state")?.textContent)
      .toContain("Following live");
    expect(container.querySelector(".runtime-feed-status")?.textContent)
      .toContain("Evidence window updated");
    expect(container.querySelector(".runtime-feed-status")?.classList)
      .toContain("evidence-updated");
    expect(container.querySelector(".runtime-window-metrics")?.classList)
      .toContain("evidence-updated");

    act(() => root.unmount());
    container.remove();
  });

  it("keeps the live header and playback controls in the same externally paused state", async () => {
    const capture = normalizeArgusJsonLines(
      readFileSync("fixtures/argus/process-network-sequence.jsonl", "utf8"),
      { synthetic: false, source: "clickhouse:otel.otel_logs" },
    );
    const graph = buildRuntimeGraph(capture);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(createElement(RuntimeWorkspace, {
      capture,
      graph,
      live: true,
      following: true,
    })));
    expect(container.querySelector(".runtime-feed-status")?.textContent)
      .toContain("LIVE · FOLLOWING");
    expect(container.querySelector(".runtime-playback-state")?.textContent)
      .toContain("Following live");

    await act(async () => root.render(createElement(RuntimeWorkspace, {
      capture,
      graph,
      live: true,
      following: false,
    })));
    expect(container.querySelector(".runtime-feed-status")?.textContent)
      .toContain("LIVE FEED · VIEW PAUSED");
    expect(container.querySelector(".runtime-playback-state")?.textContent)
      .toContain("Live view paused");
    expect(container.querySelector(".runtime-live-beacon")).toBeNull();

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
    expect(container.querySelector(".workspace-card")).toBeNull();

    await act(async () => {
      resolveFetch(new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } }));
      await Promise.resolve();
    });
    expect(container.querySelector(".workspace-card")).not.toBeNull();
    act(() => root.unmount());
    container.remove();
  });

  it("starts with questions, drills into one I/O group, and traces only by explicit action", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } })));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(App)));

    expect(container.querySelector(".overview-title")?.textContent)
      .toContain("EVIDENCE WORKSPACES");
    expect(container.querySelectorAll("g.node")).toHaveLength(0);

    act(() => [...container.querySelectorAll<HTMLButtonElement>(".workspace-actions button")]
      .find((button) => button.textContent === "Open I/O topology")!.click());
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
    act(() => [...container.querySelectorAll<HTMLButtonElement>(".workspace-actions button")]
      .find((button) => button.textContent === "Open I/O topology")!.click());
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
    act(() => [...container.querySelectorAll<HTMLButtonElement>(".workspace-actions button")]
      .find((button) => button.textContent === "Open I/O topology")!.click());

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
    act(() => [...container.querySelectorAll<HTMLButtonElement>(".workspace-actions button")]
      .find((button) => button.textContent === "Open I/O topology")!.click());

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
