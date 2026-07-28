import { useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from "react";
import { fixtures } from "../fixtures";
import { parseHwlocXml, HwlocParseError } from "../adapters/hwloc";
import { parseSnapshotJson, SnapshotParseError } from "../adapters/snapshot-json";
import { normalizeArgusJsonLines } from "../runtime/argus";
import { parseRuntimeCaptureJson, RuntimeCaptureParseError } from "../runtime/capture-json";
import { buildRuntimeGraph } from "../runtime/graph";
import type { RuntimeCapture } from "../runtime/types";
import type { RuntimeWindow } from "../runtime/transport";
import { normalizeHwloc } from "../normalize/hwloc";
import { layoutTopology } from "../layout/hierarchy";
import { renderTopologySvg } from "../render/svg";
import type { NodeKind, TopologyNode, TopologySnapshot } from "../model/types";
import { stableStringify } from "../model/stable";
import { buildPathDossier, type PathDossier } from "../analysis/troubleshooting";
import { panFromDrag, zoomFromWheel, type DragOrigin } from "./viewport";
import { investigationCommands } from "./investigate";
import { pathContainsEdge, traceTopologyPath } from "./trace";
import { assessLinkEvidence, findLinkEvidence } from "./evidence";
import { projectTopologyView, searchTopologyNodes, topologyOverview, type TopologyProjection, type TopologyViewMode } from "./projection";
import { RuntimeWorkspace } from "./RuntimeWorkspace";
import argusFixture from "../../fixtures/argus/process-network-sequence.jsonl?raw";

type WorkspaceMode = "overview" | TopologyViewMode | "runtime";
type LoadedWorkspace =
  | { kind: "topology"; snapshot: TopologySnapshot }
  | { kind: "runtime"; capture: RuntimeCapture; navigation?: RuntimeWindow["navigation"] };
interface SavedRuntimeWindow {
  capture: RuntimeCapture;
  navigation?: RuntimeWindow["navigation"];
}
const colors: Partial<Record<NodeKind, string>> = { host: "#9aa5b1", numa_node: "#d7a84b", cpu_package: "#7ea2c9", cpu_core: "#66809b", cache: "#879db2", memory_region: "#b18b55", pci_bridge: "#806fa6", pci_endpoint: "#77808b", gpu: "#68a982", nic: "#53a7ad", rdma_device: "#4f98a5", network_interface: "#5c9298", storage_device: "#b37f67" };
const nodeColorKey = [
  ["System host", colors.host], ["CPU & cache", colors.cpu_package], ["Memory & NUMA", colors.numa_node],
  ["PCI hierarchy", colors.pci_bridge], ["GPU", colors.gpu], ["Network & RDMA", colors.nic], ["Storage", colors.storage_device],
] as const;

function load(content: string, source: string): TopologySnapshot {
  return source.toLowerCase().endsWith(".json") ? parseSnapshotJson(content) : normalizeHwloc(parseHwlocXml(content, source));
}

function loadWorkspace(content: string, source: string): LoadedWorkspace {
  if (source.toLowerCase().endsWith(".jsonl")) {
    return {
      kind: "runtime",
      capture: normalizeArgusJsonLines(content, { synthetic: false, source }),
    };
  }
  if (source.toLowerCase().endsWith(".json")) {
    const value: unknown = JSON.parse(content);
    if (isRuntimeWindow(value)) {
      return {
        kind: "runtime",
        capture: parseRuntimeCaptureJson(JSON.stringify(value.capture)),
        navigation: value.navigation,
      };
    }
    if (isRecord(value) && value.schemaVersion === "contour.runtime/v1") {
      return { kind: "runtime", capture: parseRuntimeCaptureJson(content) };
    }
  }
  return { kind: "topology", snapshot: load(content, source) };
}

export function App() {
  const [snapshot, setSnapshot] = useState(() => load(fixtures.accelerator, "fixture:accelerator-server.xml"));
  const [runtimeCapture, setRuntimeCapture] = useState(() =>
    normalizeArgusJsonLines(argusFixture, { synthetic: true, source: "fixture:argus/process-network-sequence.jsonl" }));
  const [runtimeLive, setRuntimeLive] = useState(false);
  const [runtimeFollowing, setRuntimeFollowing] = useState(false);
  const [runtimeFocusId, setRuntimeFocusId] = useState<string>();
  const [runtimeRefreshFailed, setRuntimeRefreshFailed] = useState(false);
  const [runtimeNavigation, setRuntimeNavigation] = useState<RuntimeWindow["navigation"]>();
  const [runtimeHistoryAction, setRuntimeHistoryAction] = useState<"earlier" | "jump" | "live">();
  const [runtimeHistoryError, setRuntimeHistoryError] = useState<string>();
  const [runtimeNewerWindows, setRuntimeNewerWindows] = useState<SavedRuntimeWindow[]>([]);
  const [importGuideOpen, setImportGuideOpen] = useState(false);
  const [actionGuideOpen, setActionGuideOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [mode, setMode] = useState<WorkspaceMode>("overview");
  const [focusRootId, setFocusRootId] = useState<string>();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [numa, setNuma] = useState<string>("all");
  const [activeNodeId, setActiveNodeId] = useState<string>();
  const [traceEndpoints, setTraceEndpoints] = useState<string[]>([]);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [loadingInitialSnapshot, setLoadingInitialSnapshot] = useState(true);
  const drag = useRef<DragOrigin | undefined>(undefined);
  const explicitSnapshot = useRef(false);
  const runtimeRefreshAbort = useRef<AbortController | undefined>(undefined);
  const topologySvg = useRef<SVGSVGElement | null>(null);
  const nodeById = useMemo(() => new Map(snapshot.nodes.map((node) => [node.id, node])), [snapshot]);
  const overview = useMemo(() => topologyOverview(snapshot), [snapshot]);
  const searchSuggestions = useMemo(() => searchTopologyNodes(snapshot, query), [snapshot, query]);
  const topologyMode = mode === "io" || mode === "compute" ? mode : undefined;
  const projection = useMemo<TopologyProjection | undefined>(() => topologyMode === undefined ? undefined : projectTopologyView(snapshot, { mode: topologyMode, focusRootId, query }), [snapshot, topologyMode, focusRootId, query]);
  const runtimeGraph = useMemo(() => buildRuntimeGraph(runtimeCapture), [runtimeCapture]);
  const tracedPath = useMemo(() => traceEndpoints.length === 2 ? traceTopologyPath(traceEndpoints[0], traceEndpoints[1], nodeById) : [], [traceEndpoints, nodeById]);
  const visible = useMemo(() => {
    const ids = new Set(projection?.visibleNodeIds ?? []);
    for (const id of tracedPath) ids.add(id);
    return ids;
  }, [projection, tracedPath]);
  const layout = useMemo(() => layoutTopology(snapshot, visible), [snapshot, visible]);
  const highlighted = useMemo(() => {
    const ids = new Set(traceEndpoints);
    if (numa !== "all") {
      ids.add(numa);
      for (const edge of snapshot.edges) if (edge.kind === "local_to" && edge.target === numa) ids.add(edge.source);
    }
    for (const id of tracedPath) ids.add(id);
    return ids;
  }, [traceEndpoints, numa, snapshot, tracedPath]);
  const selectedNode = activeNodeId ? nodeById.get(activeNodeId) : undefined;
  const dossier = useMemo(() => traceEndpoints.length === 2 ? buildPathDossier(snapshot, traceEndpoints[0], traceEndpoints[1]) : activeNodeId ? buildPathDossier(snapshot, activeNodeId) : undefined, [snapshot, traceEndpoints, activeNodeId]);
  const numaNodes = snapshot.nodes.filter((node) => node.kind === "numa_node");
  const hostLabel = mode === "runtime"
    ? runtimeCapture.host.hostname ?? runtimeCapture.host.id
    : nodeById.get(snapshot.hostId)?.label ?? "Linux host";
  const successfulCollectors = snapshot.collectors.filter((collector) => collector.status === "success").length;

  useEffect(() => {
    if (!importGuideOpen && !actionGuideOpen) return;
    const closeOverlay = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setImportGuideOpen(false);
        setActionGuideOpen(false);
      }
    };
    document.addEventListener("keydown", closeOverlay);
    return () => document.removeEventListener("keydown", closeOverlay);
  }, [actionGuideOpen, importGuideOpen]);

  useEffect(() => {
    const svg = topologySvg.current;
    if (!svg) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      setView((current) => ({ ...current, scale: zoomFromWheel(current.scale, event.deltaY) }));
    };
    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
  }, [mode]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/snapshot?initial=1", { headers: { accept: "application/json" } }).then(async (response) => {
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return;
      const next = loadWorkspace(await response.text(), "server.json");
      if (!cancelled && !explicitSnapshot.current) {
        if (next.kind === "runtime") {
          // Plain runtime captures are the transport used by Contour servers
          // before contour.runtime-window/v1. Treat them as live here; current
          // replay servers explicitly send a live:false window envelope.
          resetRuntimeCapture(next.capture, next.navigation?.live ?? true, next.navigation);
        }
        else resetSnapshot(next.snapshot);
      }
    }).catch((reason) => {
      if (!cancelled && (reason instanceof SnapshotParseError || reason instanceof RuntimeCaptureParseError)) {
        setError(reason.message);
      }
    }).finally(() => {
      if (!cancelled) setLoadingInitialSnapshot(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (mode !== "runtime" || !runtimeLive || !runtimeFollowing || explicitSnapshot.current) return;
    let cancelled = false;
    let polling = false;
    const refresh = async () => {
      if (polling) return;
      polling = true;
      const controller = new AbortController();
      runtimeRefreshAbort.current = controller;
      try {
        const response = await fetch("/api/snapshot", {
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
          throw new Error(`Live refresh failed (${response.status}).`);
        }
        const next = loadWorkspace(await response.text(), "server.json");
        if (!cancelled && next.kind === "runtime" && next.capture.observations.length > 0) {
          if (runtimeFocusId) {
            const nextGraph = buildRuntimeGraph(next.capture);
            const focusStillVisible = nextGraph.nodes.some((node) =>
              node.id === runtimeFocusId && node.kind === "process_execution");
            if (!focusStillVisible) {
              setRuntimeFollowing(false);
              return;
            }
          }
          setRuntimeRefreshFailed(false);
          setRuntimeNavigation(next.navigation);
          setRuntimeCapture((current) =>
            current.captureId === next.capture.captureId ? current : next.capture);
        }
      } catch (reason) {
        // Keep the last valid capture visible while a live refresh is unavailable.
        if (!cancelled && !(reason instanceof DOMException && reason.name === "AbortError")) {
          setRuntimeRefreshFailed(true);
        }
      } finally {
        if (runtimeRefreshAbort.current === controller) runtimeRefreshAbort.current = undefined;
        polling = false;
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 2_000);
    return () => {
      cancelled = true;
      runtimeRefreshAbort.current?.abort();
      window.clearInterval(timer);
    };
  }, [mode, runtimeFocusId, runtimeFollowing, runtimeLive]);

  function resetSnapshot(next: TopologySnapshot) {
    setSnapshot(next); setRuntimeLive(false); setRuntimeFollowing(false); setRuntimeFocusId(undefined); setRuntimeRefreshFailed(false); setMode("overview"); setFocusRootId(undefined); setActiveNodeId(undefined); setTraceEndpoints([]); setQuery(""); setSearchOpen(false); setActiveSuggestion(0); setNuma("all"); setError(undefined); setView({ x: 0, y: 0, scale: 1 });
  }
  function chooseSnapshot(next: TopologySnapshot) {
    explicitSnapshot.current = true;
    setLoadingInitialSnapshot(false);
    resetSnapshot(next);
  }
  function resetRuntimeCapture(
    next: RuntimeCapture,
    live = false,
    navigation?: RuntimeWindow["navigation"],
  ) {
    setRuntimeCapture(next); setRuntimeLive(live); setRuntimeFollowing(live); setRuntimeNavigation(navigation); setRuntimeNewerWindows([]); setRuntimeFocusId(undefined); setRuntimeRefreshFailed(false); setMode("runtime"); setFocusRootId(undefined); setActiveNodeId(undefined); setTraceEndpoints([]); setQuery(""); setSearchOpen(false); setActiveSuggestion(0); setError(undefined);
  }
  function chooseRuntimeCapture(next: RuntimeCapture) {
    explicitSnapshot.current = true;
    setLoadingInitialSnapshot(false);
    resetRuntimeCapture(next, false);
  }
  async function loadEarlierRuntimeWindow(): Promise<boolean> {
    const cursor = runtimeNavigation?.earlierCursor;
    if (!cursor || runtimeHistoryAction) return false;
    pauseLiveRefresh();
    setRuntimeHistoryAction("earlier");
    setRuntimeHistoryError(undefined);
    try {
      const next = await fetchRuntimeWindow(`/api/snapshot?cursor=${encodeURIComponent(cursor)}`);
      showHistoricalRuntimeWindow(next);
      return true;
    } catch (reason) {
      setRuntimeHistoryError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      setRuntimeHistoryAction(undefined);
    }
  }
  async function jumpToRuntimeTime(before: string): Promise<boolean> {
    if (runtimeHistoryAction) return false;
    pauseLiveRefresh();
    setRuntimeHistoryAction("jump");
    setRuntimeHistoryError(undefined);
    try {
      const next = await fetchRuntimeWindow(`/api/snapshot?before=${encodeURIComponent(before)}`);
      showHistoricalRuntimeWindow(next);
      return true;
    } catch (reason) {
      setRuntimeHistoryError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      setRuntimeHistoryAction(undefined);
    }
  }
  async function jumpToLiveRuntime(): Promise<boolean> {
    if (runtimeHistoryAction) return false;
    pauseLiveRefresh();
    setRuntimeHistoryAction("live");
    setRuntimeHistoryError(undefined);
    try {
      const next = await fetchRuntimeWindow("/api/snapshot");
      setRuntimeCapture(next.capture);
      setRuntimeNavigation(next.navigation);
      setRuntimeNewerWindows([]);
      setRuntimeFocusId(undefined);
      setRuntimeRefreshFailed(false);
      setRuntimeFollowing(true);
      return true;
    } catch (reason) {
      setRuntimeHistoryError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      setRuntimeHistoryAction(undefined);
    }
  }
  function pauseLiveRefresh() {
    setRuntimeFollowing(false);
    runtimeRefreshAbort.current?.abort();
  }
  async function fetchRuntimeWindow(url: string): Promise<Extract<LoadedWorkspace, { kind: "runtime" }>> {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
      const detail = (await response.text()).trim();
      throw new Error(detail || `Runtime window request failed (${response.status}).`);
    }
    const next = loadWorkspace(await response.text(), "server.json");
    if (next.kind !== "runtime") throw new Error("Runtime window request returned a topology snapshot.");
    return next;
  }
  function showHistoricalRuntimeWindow(next: Extract<LoadedWorkspace, { kind: "runtime" }>) {
    setRuntimeNewerWindows((current) => [...current, {
      capture: runtimeCapture,
      navigation: runtimeNavigation,
    }]);
    setRuntimeCapture(next.capture);
    setRuntimeNavigation(next.navigation);
    setRuntimeFollowing(false);
    setRuntimeFocusId(undefined);
    setRuntimeRefreshFailed(false);
  }
  function loadNewerRuntimeWindow() {
    const next = runtimeNewerWindows.at(-1);
    if (!next) return;
    setRuntimeNewerWindows((current) => current.slice(0, -1));
    setRuntimeCapture(next.capture);
    setRuntimeNavigation(next.navigation);
    setRuntimeFollowing(false);
    setRuntimeFocusId(undefined);
  }
  async function openFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const next = loadWorkspace(await file.text(), file.name);
      if (next.kind === "runtime") chooseRuntimeCapture(next.capture);
      else chooseSnapshot(next.snapshot);
    } catch (reason) {
      setError(reason instanceof HwlocParseError
        || reason instanceof SnapshotParseError
        || reason instanceof RuntimeCaptureParseError
        ? reason.message
        : String(reason));
    }
    event.target.value = "";
  }
  function openMode(next: TopologyViewMode) { setMode(next); setFocusRootId(undefined); setActiveNodeId(undefined); setQuery(""); setView({ x: 0, y: 0, scale: 1 }); }
  function updateSearch(value: string) { setQuery(value); setSearchOpen(Boolean(value.trim())); setActiveSuggestion(0); if (value.trim() && mode === "overview") setMode("io"); setFocusRootId(undefined); setActiveNodeId(undefined); setView({ x: 0, y: 0, scale: 1 }); }
  function selectSearchNode(node: TopologyNode) {
    const computeKind = ["cpu_package", "cpu_core", "cache", "numa_node", "memory_region"].includes(node.kind);
    setQuery(node.label); setSearchOpen(false); setActiveSuggestion(0); setMode(computeKind ? "compute" : "io"); setFocusRootId(undefined); setActiveNodeId(node.id); setView({ x: 0, y: 0, scale: 1 });
  }
  function chooseTraceEndpoint(id: string) {
    setTraceEndpoints((current) => current.length === 0 ? [id] : current.length === 1 && current[0] !== id ? [current[0], id] : [id]);
  }
  function exportSvg() {
    const ids = mode === "overview" ? projectTopologyView(snapshot, { mode: "io" }).visibleNodeIds : visible;
    const exportLayout = layoutTopology(snapshot, ids);
    download(renderTopologySvg(snapshot, exportLayout, { title: `Contour · ${nodeById.get(snapshot.hostId)?.label ?? "host"}`, visibleNodeIds: ids, highlightedNodeIds: highlighted }), "image/svg+xml", `${nodeById.get(snapshot.hostId)?.label ?? "topology"}.svg`);
  }
  function exportSnapshot() { download(`${stableStringify(snapshot)}\n`, "application/json", `${nodeById.get(snapshot.hostId)?.label ?? "topology"}.contour.json`); }
  function exportRuntimeCapture() { download(`${stableStringify(runtimeCapture)}\n`, "application/json", `${runtimeCapture.host.hostname ?? "runtime"}.contour-runtime.json`); }
  function pointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.target !== event.currentTarget) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerX: event.clientX, pointerY: event.clientY, viewX: view.x, viewY: view.y };
  }
  function pointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const origin = drag.current;
    if (!origin) return;
    const next = panFromDrag(origin, event.clientX, event.clientY);
    setView((current) => ({ ...current, ...next }));
  }
  function pointerUp() { drag.current = undefined; }

  return <div className="shell">
    <header className="app-header">
      <button type="button" className="brand" aria-label="Return to topology overview" onClick={() => { setMode("overview"); setActiveNodeId(undefined); }}><ContourMark/><span className="host-label">{hostLabel}</span></button>
      <nav className="primary-nav" aria-label="Topology views"><button className={mode === "overview" ? "active" : ""} onClick={() => { setMode("overview"); setActiveNodeId(undefined); }}>Overview</button><button className={mode === "io" ? "active" : ""} onClick={() => openMode("io")}>I/O</button><button className={mode === "compute" ? "active" : ""} onClick={() => openMode("compute")}>CPU &amp; NUMA</button><button className={mode === "runtime" ? "active" : ""} onClick={() => { setMode("runtime"); setActiveNodeId(undefined); }}>Runtime</button></nav>
      <div className="header-actions">
        <button
          type="button"
          className="button open-button"
          onClick={() => setImportGuideOpen(true)}
        >Import</button>
        <button
          type="button"
          className="button action-button"
          aria-haspopup="dialog"
          onClick={() => setActionGuideOpen(true)}
        >Actions <span aria-hidden="true">⌄</span></button>
      </div>
    </header>
    {importGuideOpen && <ImportGuide
      kind={mode === "runtime" ? "runtime" : "topology"}
      onClose={() => setImportGuideOpen(false)}
      onOpenFile={openFile}
    />}
    {actionGuideOpen && <ActionGuide
      kind={mode === "runtime" ? "runtime" : "topology"}
      onClose={() => setActionGuideOpen(false)}
      onExample={(example) => {
        if (example === "workstation") chooseSnapshot(load(fixtures.workstation, "fixture:workstation.xml"));
        else if (example === "accelerator") chooseSnapshot(load(fixtures.accelerator, "fixture:accelerator-server.xml"));
        else chooseRuntimeCapture(normalizeArgusJsonLines(argusFixture, {
          synthetic: true,
          source: "fixture:argus/process-network-sequence.jsonl",
        }));
        setActionGuideOpen(false);
      }}
      onExport={(format) => {
        if (format === "runtime") exportRuntimeCapture();
        else if (format === "snapshot") exportSnapshot();
        else exportSvg();
        setActionGuideOpen(false);
      }}
    />}
    {error && <div className="error">INPUT ERROR · {error}</div>}
    <main className={topologyMode ? "inspect-mode" : "overview-mode"}>
      {topologyMode && <aside className="controls">
        <section><label className="section-label">FIND HARDWARE</label><div className="search-box" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setSearchOpen(false); }}><input className="search" role="combobox" aria-autocomplete="list" aria-expanded={searchOpen && searchSuggestions.length > 0} aria-controls="hardware-search-options" aria-activedescendant={searchOpen && searchSuggestions[activeSuggestion] ? `hardware-option-${activeSuggestion}` : undefined} value={query} onFocus={() => setSearchOpen(Boolean(query.trim()))} onChange={(event) => updateSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "ArrowDown" && searchSuggestions.length) { event.preventDefault(); setSearchOpen(true); setActiveSuggestion((current) => (current + 1) % searchSuggestions.length); } else if (event.key === "ArrowUp" && searchSuggestions.length) { event.preventDefault(); setSearchOpen(true); setActiveSuggestion((current) => (current - 1 + searchSuggestions.length) % searchSuggestions.length); } else if (event.key === "Enter" && searchOpen && searchSuggestions[activeSuggestion]) { event.preventDefault(); selectSearchNode(searchSuggestions[activeSuggestion]); } else if (event.key === "Escape") setSearchOpen(false); }} placeholder="Try GPU, mlx5, enp, 0000:…"/>{searchOpen && searchSuggestions.length > 0 && <div className="search-options" id="hardware-search-options" role="listbox">{searchSuggestions.map((node, index) => <button type="button" className={`search-option ${index === activeSuggestion ? "active" : ""}`} id={`hardware-option-${index}`} role="option" aria-selected={index === activeSuggestion} key={node.id} onMouseEnter={() => setActiveSuggestion(index)} onClick={() => selectSearchNode(node)}><span><b>{node.label}</b><small>{node.kind.replaceAll("_", " ")}</small></span><code>{searchIdentifier(node)}</code></button>)}</div>}</div><p className="control-note">Type a device, interface, model, or PCI BDF. Choose a result to reveal its path and inspect it.</p></section>
        <section><label className="section-label">NUMA EVIDENCE</label><select value={numa} onChange={(event) => setNuma(event.target.value)}><option value="all">No highlight</option>{numaNodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></section>
        <details className="panel-disclosure"><summary><span>Collection</span><b>{successfulCollectors}/{snapshot.collectors.length}</b></summary><section className="status">{snapshot.collectors.map((collector) => <div key={collector.collector}><i className={collector.status}/><span>{collector.collector}</span><b>{collector.status}</b></div>)}{snapshot.diagnostics.map((item) => <div key={item.id} title={item.message}><i className={item.severity}/><span>{item.code}</span><b>{item.severity}</b></div>)}</section></details>
        <details className="panel-disclosure legend"><summary><span>Visual key</span><b>roles + links</b></summary><span className="legend-label">NODE ROLE</span>{nodeColorKey.map(([label, color]) => <div key={label}><i className="role" style={{ background: color }}/><span>{label}</span></div>)}<span className="legend-label relationships">RELATIONSHIPS</span><div><i className="contains"/><span><b>contains</b> source hierarchy</span></div><div><i className="backed"/><span><b>backed by</b> OS → PCI device</span></div><div><i className="exposes"/><span><b>exposes</b> device → port</span></div><div><i className="connected"/><span><b>connected to</b> RDMA port ↔ netdev</span></div><div><i className="local"/><span><b>local to</b> explicit NUMA evidence</span></div><p>Color identifies hardware role; lines show known topology. Neither represents health or measured performance.</p></details>
      </aside>}
      <section className={`viewport ${topologyMode ? "" : "overview-workspace"}`}>
        {mode === "overview" ? loadingInitialSnapshot ? <LoadingWorkspace/> : <OverviewWorkspace snapshot={snapshot} overview={overview} onOpen={openMode}/> : mode === "runtime"
          ? <RuntimeWorkspace
            capture={runtimeCapture}
            graph={runtimeGraph}
            live={runtimeLive}
            following={runtimeFollowing}
            stale={runtimeRefreshFailed}
            hasEarlier={runtimeNavigation?.hasEarlier ?? false}
            historyAction={runtimeHistoryAction}
            historyError={runtimeHistoryError}
            onLoadEarlier={loadEarlierRuntimeWindow}
            hasNewer={runtimeNewerWindows.length > 0}
            onLoadNewer={loadNewerRuntimeWindow}
            onJumpToTime={jumpToRuntimeTime}
            onJumpLive={jumpToLiveRuntime}
            onFollowingChange={(next) => {
              if (next) {
                setRuntimeFocusId(undefined);
                setRuntimeNewerWindows([]);
              }
              setRuntimeFollowing(next);
            }}
            onFocusChange={setRuntimeFocusId}
          />
          : <>
          <div className="viewport-meta"><span>{visible.size} / {snapshot.nodes.length} nodes{query && projection ? ` · ${projection.matchingNodeCount} matches` : ""}</span><span>{Math.round(view.scale * 100)}%</span></div>
          {mode === "io" && focusRootId && <button className="back-to-groups" onClick={() => { setFocusRootId(undefined); setActiveNodeId(undefined); setView({ x: 0, y: 0, scale: 1 }); }}>← I/O groups</button>}
          <TraceState endpoints={traceEndpoints} path={tracedPath} nodes={nodeById} onClear={() => setTraceEndpoints([])}/>
          <svg ref={topologySvg} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} viewBox={`0 0 ${layout.width} ${layout.height + 64}`} aria-label="Interactive system topology">
            <g transform={`translate(${view.x} ${view.y + 64}) scale(${view.scale})`}>
              {layout.edges.map((item) => { const edge = snapshot.edges.find((candidate) => candidate.id === item.id); const show = edge && (edge.kind !== "local_to" || numa !== "all") && visible.has(edge.source) && visible.has(edge.target); const traced = edge?.kind === "contains" ? pathContainsEdge(tracedPath, edge.source, edge.target) : false; return show ? <path key={item.id} d={item.path} className={`edge ${edge!.kind} ${traced ? "traced" : ""}`}/> : null; })}
              {layout.nodes.map((box) => { const node = nodeById.get(box.id)!; const hidden = projection?.hiddenDescendantCounts.get(node.id); return <g key={node.id} className={`node ${highlighted.has(node.id) ? "highlighted" : ""} ${activeNodeId === node.id ? "selected" : ""}`} transform={`translate(${box.x} ${box.y})`} role="button" tabIndex={0} aria-label={`Inspect ${node.label}`} aria-pressed={activeNodeId === node.id} onClick={(event) => { event.stopPropagation(); setActiveNodeId(node.id); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActiveNodeId(node.id); } }}>
                <rect width={box.width} height={box.height} rx="3"/><rect className="kind-bar" width="4" height={box.height} fill={colors[node.kind]}/><text x="16" y="22">{truncate(nodeDisplayLabel(node, overview), 29)}</text><text className="secondary" x="16" y="39">{truncate(nodeSubtitle(node, hidden, overview), 34)}</text>
              </g>; })}
            </g>
          </svg>
        </>}
      </section>
      {topologyMode && <aside className="details">{dossier && <Dossier dossier={dossier} snapshot={snapshot}/>} {selectedNode ? <Details node={selectedNode} snapshot={snapshot} traceEndpoints={traceEndpoints} hiddenDescendantCount={projection?.hiddenDescendantCounts.get(selectedNode.id)} onChooseTrace={() => chooseTraceEndpoint(selectedNode.id)} onExploreBranch={mode === "io" && projection?.hiddenDescendantCounts.has(selectedNode.id) ? () => { setFocusRootId(selectedNode.id); setActiveNodeId(undefined); setView({ x: 0, y: 0, scale: 1 }); } : undefined}/> : <EmptyInspector mode={topologyMode}/>}</aside>}
    </main>
  </div>;
}

function LoadingWorkspace() {
  return <div className="loading-workspace"><label className="section-label">LOADING SNAPSHOT</label><h1>Inspecting this machine…</h1><p>Waiting for the canonical topology before enabling exploration.</p></div>;
}

function ImportGuide({
  kind,
  onClose,
  onOpenFile,
}: {
  kind: "runtime" | "topology";
  onClose: () => void;
  onOpenFile: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const runtime = kind === "runtime";
  return <div className="import-overlay" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="import-guide" role="dialog" aria-modal="true" aria-labelledby="runtime-import-title">
      <header>
        <div>
          <label className="section-label">{runtime ? "RUNTIME EVIDENCE" : "TOPOLOGY SNAPSHOT"}</label>
          <h2 id="runtime-import-title">
            {runtime ? "Open an Argus capture" : "Open a Linux topology"}
          </h2>
        </div>
        <button
          type="button"
          aria-label={`Close ${runtime ? "runtime evidence" : "topology snapshot"} guide`}
          onClick={onClose}
        >×</button>
      </header>
      <p>
        {runtime
          ? "Import a bounded capture for offline reconstruction. Contour normalizes the records, rebuilds execution identities, and projects their file and TCP relationships."
          : "Import a saved machine snapshot for offline exploration. Contour normalizes the hardware evidence and rebuilds its CPU, NUMA, PCIe, accelerator, network, and storage relationships."}
      </p>
      <div className="import-formats">
        <article>
          <code>{runtime ? ".jsonl" : ".xml"}</code>
          <b>{runtime ? "Argus activity records" : "lstopo XML"}</b>
          <span>{runtime
            ? "One emitted Argus JSON object per line. Supported v0 evidence includes process, container, file-descriptor, and TCP activity."
            : "Whole-system hwloc output, typically captured with lstopo --whole-system --of xml -."}</span>
        </article>
        <article>
          <code>.json</code>
          <b>{runtime ? "Contour runtime capture" : "Contour topology snapshot"}</b>
          <span>A previously exported <code>
            {runtime ? "contour.runtime/v1" : "contour.topology/v2"}
          </code> {runtime ? "capture with normalized observations and diagnostics." : "snapshot with canonical facts, relationships, provenance, and diagnostics."}</span>
        </article>
      </div>
      <aside>
        {runtime ? <>
          For a live feed, start <code>contour runtime --clickhouse</code>. OTLP request
          envelopes and arbitrary ClickHouse exports are not file-import formats.
        </> : <>
          For live collection, run <code>contour</code> on the Linux host. Screenshots,
          PDFs, and hand-authored diagrams are not evidence snapshot formats.
        </>}
      </aside>
      <footer>
        <button type="button" onClick={onClose}>Cancel</button>
        <label className="button">
          Choose evidence file
          <input
            type="file"
            accept={runtime
              ? ".json,.jsonl,application/json,application/x-ndjson"
              : ".xml,.json,text/xml,application/json"}
            onChange={(event) => {
              onOpenFile(event);
              onClose();
            }}
          />
        </label>
      </footer>
    </section>
  </div>;
}

function ActionGuide({
  kind,
  onClose,
  onExample,
  onExport,
}: {
  kind: "runtime" | "topology";
  onClose: () => void;
  onExample: (example: "workstation" | "accelerator" | "runtime") => void;
  onExport: (format: "runtime" | "snapshot" | "svg") => void;
}) {
  const runtime = kind === "runtime";
  return <div className="import-overlay" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="action-guide" role="dialog" aria-modal="true" aria-labelledby="action-guide-title">
      <header>
        <div>
          <label className="section-label">WORKSPACE ACTIONS</label>
          <h2 id="action-guide-title">Open an example or save this view</h2>
        </div>
        <button type="button" aria-label="Close workspace actions" onClick={onClose}>×</button>
      </header>
      <section>
        <header>
          <b>Examples</b>
          <span>Replace the current workspace with bundled, clearly labeled evidence.</span>
        </header>
        <div className="action-options">
          <button type="button" onClick={() => onExample("runtime")}>
            <span><b>Argus workflow replay</b><small>Synthetic process, file, and TCP evidence</small></span><i>Open →</i>
          </button>
          <button type="button" onClick={() => onExample("accelerator")}>
            <span><b>Accelerator server</b><small>CPU, NUMA, PCIe, GPU, NIC, and storage</small></span><i>Open →</i>
          </button>
          <button type="button" onClick={() => onExample("workstation")}>
            <span><b>Linux workstation</b><small>Compact hardware topology snapshot</small></span><i>Open →</i>
          </button>
        </div>
      </section>
      <section>
        <header>
          <b>Export current evidence</b>
          <span>Save the normalized data behind the current workspace.</span>
        </header>
        <div className="action-options export-options">
          {runtime ? <button type="button" onClick={() => onExport("runtime")}>
            <span><b>Runtime capture JSON</b><small>Normalized observations, provenance, and diagnostics</small></span><i>Save ↓</i>
          </button> : <>
            <button type="button" onClick={() => onExport("snapshot")}>
              <span><b>Topology snapshot JSON</b><small>Canonical facts, relationships, and provenance</small></span><i>Save ↓</i>
            </button>
            <button type="button" onClick={() => onExport("svg")}>
              <span><b>Diagram SVG</b><small>Portable rendering of the current topology view</small></span><i>Save ↓</i>
            </button>
          </>}
        </div>
      </section>
    </section>
  </div>;
}

function ContourMark() {
  return <svg className="brand-mark" viewBox="0 0 24 24" role="img" aria-label="Contour"><path d="M3.5 12c0-5 3.1-8 8-8 5.7 0 9 3 9 8 0 4.8-2.8 8-8 8-5.7 0-9-3-9-8Z"/><path d="M7 12c0-3.1 2-5 5.1-5 3.5 0 5.9 1.9 5.9 5 0 3-1.9 5-5.3 5C9.1 17 7 15 7 12Z"/><path d="M10 12c0-1.5 1-2.5 2.6-2.5 1.5 0 2.5 1 2.5 2.5s-.9 2.5-2.5 2.5S10 13.5 10 12Z"/></svg>;
}

function OverviewWorkspace({ snapshot, overview, onOpen }: { snapshot: TopologySnapshot; overview: ReturnType<typeof topologyOverview>; onOpen: (mode: TopologyViewMode) => void }) {
  const host = snapshot.nodes.find((node) => node.id === snapshot.hostId)?.label ?? "Linux host";
  const successful = snapshot.collectors.filter((collector) => collector.status === "success").length;
  return <div className="overview-panel"><div className="overview-title"><label className="section-label">SYSTEM</label><h1>{host}</h1><p className="system-line">{overview.cpuPackages} CPU {overview.cpuPackages === 1 ? "package" : "packages"} · {overview.numaNodes} NUMA · {formatBytes(overview.memoryBytes)} · {overview.gpus} GPU · {overview.rdmaDevices} RDMA · {overview.storageDevices} storage</p></div><div className="question-list">
    <button className="question-card" onClick={() => onOpen("io")}><span><small>EXPLORE</small><strong>I/O topology</strong><p>PCIe attachment, shared upstream paths, accelerators, NICs, RDMA mappings, and storage.</p></span><code>{overview.upstreamGroups} upstream groups</code><b>Open →</b></button>
    <button className="question-card" onClick={() => onOpen("compute")}><span><small>EXPLORE</small><strong>CPU &amp; NUMA</strong><p>Packages, memory domains, capacity, cores, caches, and explicit locality evidence.</p></span><code>{overview.cpuCores} cores · {overview.numaNodes} nodes</code><b>Open →</b></button>
  </div><p className="evidence-line">{successful}/{snapshot.collectors.length} collectors · {snapshot.diagnostics.length} diagnostics · {overview.totalNodes} canonical nodes · schema {snapshot.schemaVersion.split("/")[1]}</p></div>;
}

function TraceState({ endpoints, path, nodes, onClear }: { endpoints: string[]; path: string[]; nodes: ReadonlyMap<string, TopologyNode>; onClear: () => void }) {
  if (endpoints.length === 0) return null;
  return <div className="trace-state"><b>PATH</b>{endpoints.length === 1 && <span>A · {truncate(nodes.get(endpoints[0])?.label ?? endpoints[0], 24)} → choose endpoint B</span>}{endpoints.length === 2 && <span>A · {truncate(nodes.get(endpoints[0])?.label ?? endpoints[0], 16)} → B · {truncate(nodes.get(endpoints[1])?.label ?? endpoints[1], 16)} · {Math.max(0, path.length - 1)} hops</span>}<button onClick={onClear}>Clear</button></div>;
}

function Dossier({ dossier, snapshot }: { dossier: PathDossier; snapshot: TopologySnapshot }) {
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const pair = dossier.endpointIds.length === 2;
  const endpoints = dossier.endpointIds.map((id) => nodes.get(id)?.label ?? id);
  return <section className="path-dossier"><label className="section-label">{pair ? "PATH DOSSIER" : "OBJECT ASSESSMENT"}</label>{pair && <><div className="dossier-endpoints"><b>A · {endpoints[0]}</b><span>→</span><b>B · {endpoints[1]}</b></div><p className={`numa-status ${dossier.numaStatus}`}>{Math.max(0, dossier.pathIds.length - 1)} hops · NUMA {dossier.numaStatus}</p><details className="dossier-route"><summary>Known containment route</summary><ol>{dossier.hops.map((hop) => <li key={hop.nodeId}><span>{hop.kind.replaceAll("_", " ")}</span><b>{hop.label}</b>{hop.identifier && <code>{hop.identifier}</code>}{hop.numaLabels.length > 0 && <small>{hop.numaLabels.join(", ")}</small>}</li>)}</ol></details></>}
    <div className="finding-heading"><span>FINDINGS</span><b>{dossier.findings.length}</b></div>{dossier.findings.length === 0 ? <p className="no-findings">No suspicious evidence was identified in the available snapshot. This is not a health guarantee.</p> : <div className="finding-list">{dossier.findings.map((finding) => <details className={`finding ${finding.severity}`} key={finding.id}><summary><i/><span>{finding.title}</span></summary><p>{finding.summary}</p><ul>{finding.evidence.map((item) => <li key={item}>{item}</li>)}</ul><small>{finding.uncertainty}</small><div className="finding-command"><code>{finding.verificationCommand}</code><button title="Copy verification command" onClick={() => navigator.clipboard?.writeText(finding.verificationCommand)}>COPY</button></div></details>)}</div>}
  </section>;
}

function Details({ node, snapshot, traceEndpoints, hiddenDescendantCount, onChooseTrace, onExploreBranch }: { node: TopologyNode; snapshot: TopologySnapshot; traceEndpoints: string[]; hiddenDescendantCount?: number; onChooseTrace: () => void; onExploreBranch?: () => void }) {
  const relationships = snapshot.edges.filter((edge) => edge.source === node.id || edge.target === node.id);
  const linkEvidence = findLinkEvidence(snapshot, node.id);
  const commands = investigationCommands(node);
  const endpointLabel = traceEndpoints.length === 1 && traceEndpoints[0] !== node.id ? "Use as endpoint B" : "Use as endpoint A";
  return <><div className="details-heading"><span className="kind-dot" style={{ background: colors[node.kind] }}/><div><label>{node.kind.replaceAll("_", " ")}</label><h2>{node.label}</h2><code>{node.id}</code></div></div><div className="node-actions">{onExploreBranch && <button className="primary" onClick={onExploreBranch}>Open branch · show {hiddenDescendantCount} downstream nodes</button>}<button onClick={onChooseTrace}>{endpointLabel}</button></div>{linkEvidence.length > 0 && <section className="link-evidence"><label className="section-label">PHYSICAL LINK EVIDENCE</label>{linkEvidence.map((edge) => { const assessment = assessLinkEvidence(edge); const target = snapshot.nodes.find((candidate) => candidate.id === edge.target); return <article key={edge.id} className={assessment.state}><div><b>{assessment.label}</b><code>{target?.label ?? edge.target}</code></div><dl>{Object.entries(edge.facts).map(([key, fact]) => <div className="link-fact" key={key}><dt>{key}</dt><dd>{fact.value === null ? "UNKNOWN" : String(fact.value)}</dd></div>)}</dl><p>{assessment.note}</p><details className="link-provenance"><summary>Evidence sources</summary>{Object.entries(edge.facts).flatMap(([key, fact]) => fact.provenance.map((provenance, index) => <dl key={`${key}-${index}`}><dt>fact</dt><dd>{key}</dd><dt>collector</dt><dd>{provenance.collector}</dd><dt>source field</dt><dd>{provenance.sourceField}</dd><dt>raw</dt><dd>{String(provenance.rawValue)}</dd></dl>))}</details></article>; })}</section>}<section><label className="section-label">FACTS & PROVENANCE</label>{Object.entries(node.facts).map(([key, fact]) => <details key={key}><summary><span>{key}</span><b className={fact.state}>{fact.value === null ? "UNKNOWN" : String(fact.value)}</b></summary>{fact.provenance.map((provenance, index) => <dl key={index}><dt>state</dt><dd>{fact.state}</dd><dt>collector</dt><dd>{provenance.collector}</dd><dt>source field</dt><dd>{provenance.sourceField}</dd><dt>raw</dt><dd>{String(provenance.rawValue)}</dd>{provenance.derivationRule && <><dt>rule</dt><dd>{provenance.derivationRule}</dd></>}</dl>)}</details>)}</section>{commands.length > 0 && <section><label className="section-label">VERIFY THIS OBJECT</label>{commands.map((item) => <div className="investigate" key={item.command}><div><b>{item.label}</b><button title="Copy command" onClick={() => navigator.clipboard?.writeText(item.command)}>COPY</button></div><code>{item.command}</code><p>{item.reason}</p></div>)}</section>}<section><label className="section-label">RELATIONSHIPS · {relationships.length}</label>{relationships.map((edge) => <div className="relationship" key={edge.id}><b>{edge.kind}</b><code>{edge.source === node.id ? `→ ${edge.target}` : `← ${edge.source}`}</code></div>)}</section></>;
}

function EmptyInspector({ mode }: { mode: TopologyViewMode }) {
  return <div className="empty-details"><label className="section-label">INSPECTOR</label><p>Select a node to view its exact facts, provenance, relationships, and verification commands.</p><small>{mode === "io" ? "Open an upstream group to reveal its devices." : "Search when you need an exact core or cache object."}</small></div>;
}

function nodeSubtitle(node: TopologyNode, hiddenDescendants: number | undefined, overview: ReturnType<typeof topologyOverview>): string {
  if (hiddenDescendants) return `${node.facts.pci_bdf?.value ? `${node.facts.pci_bdf.value} · ` : ""}${hiddenDescendants} downstream`;
  if (node.kind === "cpu_package") return `${overview.cpuCores} cores · ${overview.caches} caches summarized`;
  return String(node.facts.pci_bdf?.value ?? node.facts.logical_index?.value ?? node.kind.replaceAll("_", " "));
}
function nodeDisplayLabel(node: TopologyNode, overview: ReturnType<typeof topologyOverview>): string { return node.kind === "cpu_package" && overview.cpuPackages === 1 ? "CPU package" : node.label; }
function searchIdentifier(node: TopologyNode): string { return String(node.facts.pci_bdf?.value ?? node.facts["linux.ifname"]?.value ?? node.facts["hwloc.name"]?.value ?? node.id); }
function truncate(value: string, max: number): string { return value.length <= max ? value : `${value.slice(0, max - 1)}…`; }
function formatBytes(bytes: number): string { if (!bytes) return "unknown"; const gib = bytes / 1024 ** 3; return `${Number.isInteger(gib) ? gib : gib.toFixed(1)} GiB`; }
function download(content: string, type: string, filename: string) { const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url); }
function isRuntimeWindow(value: unknown): value is RuntimeWindow {
  if (!isRecord(value)
    || value.schemaVersion !== "contour.runtime-window/v1"
    || !isRecord(value.capture)
    || !isRecord(value.navigation)) return false;
  return value.capture.schemaVersion === "contour.runtime/v1"
    && typeof value.navigation.hasEarlier === "boolean"
    && typeof value.navigation.live === "boolean"
    && (value.navigation.earlierCursor === undefined
      || typeof value.navigation.earlierCursor === "string");
}
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
