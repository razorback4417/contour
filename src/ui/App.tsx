import { useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from "react";
import { fixtures } from "../fixtures";
import { parseHwlocXml, HwlocParseError } from "../adapters/hwloc";
import { parseSnapshotJson, SnapshotParseError } from "../adapters/snapshot-json";
import { normalizeHwloc } from "../normalize/hwloc";
import { layoutTopology } from "../layout/hierarchy";
import { renderTopologySvg } from "../render/svg";
import type { NodeKind, TopologyNode, TopologySnapshot } from "../model/types";
import { stableStringify } from "../model/stable";
import { panFromDrag, zoomFromWheel, type DragOrigin } from "./viewport";
import { investigationCommands } from "./investigate";
import { pathContainsEdge, traceTopologyPath } from "./trace";
import { assessLinkEvidence, findLinkEvidence } from "./evidence";
import { projectTopologyView, searchTopologyNodes, topologyOverview, type TopologyProjection, type TopologyViewMode } from "./projection";

type WorkspaceMode = "overview" | TopologyViewMode;
const colors: Partial<Record<NodeKind, string>> = { host: "#9aa5b1", numa_node: "#d7a84b", cpu_package: "#7ea2c9", cpu_core: "#66809b", cache: "#879db2", memory_region: "#b18b55", pci_bridge: "#806fa6", pci_endpoint: "#77808b", gpu: "#68a982", nic: "#53a7ad", rdma_device: "#4f98a5", network_interface: "#5c9298", storage_device: "#b37f67" };

function load(content: string, source: string): TopologySnapshot {
  return source.toLowerCase().endsWith(".json") ? parseSnapshotJson(content) : normalizeHwloc(parseHwlocXml(content, source));
}

export function App() {
  const [snapshot, setSnapshot] = useState(() => load(fixtures.accelerator, "fixture:accelerator-server.xml"));
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
  const topologySvg = useRef<SVGSVGElement | null>(null);
  const nodeById = useMemo(() => new Map(snapshot.nodes.map((node) => [node.id, node])), [snapshot]);
  const overview = useMemo(() => topologyOverview(snapshot), [snapshot]);
  const searchSuggestions = useMemo(() => searchTopologyNodes(snapshot, query), [snapshot, query]);
  const projection = useMemo<TopologyProjection | undefined>(() => mode === "overview" ? undefined : projectTopologyView(snapshot, { mode, focusRootId, query }), [snapshot, mode, focusRootId, query]);
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
  const numaNodes = snapshot.nodes.filter((node) => node.kind === "numa_node");
  const hostLabel = nodeById.get(snapshot.hostId)?.label ?? "Linux host";
  const successfulCollectors = snapshot.collectors.filter((collector) => collector.status === "success").length;

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
    fetch("/api/snapshot", { headers: { accept: "application/json" } }).then(async (response) => {
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return;
      const next = parseSnapshotJson(await response.text());
      if (!cancelled && !explicitSnapshot.current) resetSnapshot(next);
    }).catch((reason) => {
      if (!cancelled && reason instanceof SnapshotParseError) setError(reason.message);
    }).finally(() => {
      if (!cancelled) setLoadingInitialSnapshot(false);
    });
    return () => { cancelled = true; };
  }, []);

  function resetSnapshot(next: TopologySnapshot) {
    setSnapshot(next); setMode("overview"); setFocusRootId(undefined); setActiveNodeId(undefined); setTraceEndpoints([]); setQuery(""); setSearchOpen(false); setActiveSuggestion(0); setNuma("all"); setError(undefined); setView({ x: 0, y: 0, scale: 1 });
  }
  function chooseSnapshot(next: TopologySnapshot) {
    explicitSnapshot.current = true;
    setLoadingInitialSnapshot(false);
    resetSnapshot(next);
  }
  async function openFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try { chooseSnapshot(load(await file.text(), file.name)); }
    catch (reason) { setError(reason instanceof HwlocParseError || reason instanceof SnapshotParseError ? reason.message : String(reason)); }
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
      <div className="brand"><strong>Contour</strong><span>{hostLabel}</span></div>
      <nav className="primary-nav" aria-label="Topology views"><button className={mode === "overview" ? "active" : ""} onClick={() => { setMode("overview"); setActiveNodeId(undefined); }}>Overview</button><button className={mode === "io" ? "active" : ""} onClick={() => openMode("io")}>I/O</button><button className={mode === "compute" ? "active" : ""} onClick={() => openMode("compute")}>CPU &amp; NUMA</button></nav>
      <div className="header-actions">
        <label className="button open-button">Open snapshot<input type="file" accept=".xml,.json,text/xml,application/json" onChange={openFile}/></label>
        <details className="utility-menu"><summary aria-label="More actions">Actions</summary><div><span>Examples</span><button onClick={() => chooseSnapshot(load(fixtures.workstation, "fixture:workstation.xml"))}>Workstation</button><button onClick={() => chooseSnapshot(load(fixtures.accelerator, "fixture:accelerator-server.xml"))}>Accelerator server</button><hr/><span>Export</span><button onClick={exportSnapshot}>Snapshot JSON</button><button onClick={exportSvg}>Diagram SVG</button></div></details>
      </div>
    </header>
    {error && <div className="error">INPUT ERROR · {error}</div>}
    <main className={mode === "overview" ? "overview-mode" : "inspect-mode"}>
      {mode !== "overview" && <aside className="controls">
        <section><label className="section-label">FIND HARDWARE</label><div className="search-box" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setSearchOpen(false); }}><input className="search" role="combobox" aria-autocomplete="list" aria-expanded={searchOpen && searchSuggestions.length > 0} aria-controls="hardware-search-options" aria-activedescendant={searchOpen && searchSuggestions[activeSuggestion] ? `hardware-option-${activeSuggestion}` : undefined} value={query} onFocus={() => setSearchOpen(Boolean(query.trim()))} onChange={(event) => updateSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "ArrowDown" && searchSuggestions.length) { event.preventDefault(); setSearchOpen(true); setActiveSuggestion((current) => (current + 1) % searchSuggestions.length); } else if (event.key === "ArrowUp" && searchSuggestions.length) { event.preventDefault(); setSearchOpen(true); setActiveSuggestion((current) => (current - 1 + searchSuggestions.length) % searchSuggestions.length); } else if (event.key === "Enter" && searchOpen && searchSuggestions[activeSuggestion]) { event.preventDefault(); selectSearchNode(searchSuggestions[activeSuggestion]); } else if (event.key === "Escape") setSearchOpen(false); }} placeholder="Try GPU, mlx5, enp, 0000:…"/>{searchOpen && searchSuggestions.length > 0 && <div className="search-options" id="hardware-search-options" role="listbox">{searchSuggestions.map((node, index) => <button type="button" className={`search-option ${index === activeSuggestion ? "active" : ""}`} id={`hardware-option-${index}`} role="option" aria-selected={index === activeSuggestion} key={node.id} onMouseEnter={() => setActiveSuggestion(index)} onClick={() => selectSearchNode(node)}><span><b>{node.label}</b><small>{node.kind.replaceAll("_", " ")}</small></span><code>{searchIdentifier(node)}</code></button>)}</div>}</div><p className="control-note">Type a device, interface, model, or PCI BDF. Choose a result to reveal its path and inspect it.</p></section>
        <section><label className="section-label">NUMA EVIDENCE</label><select value={numa} onChange={(event) => setNuma(event.target.value)}><option value="all">No highlight</option>{numaNodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></section>
        <details className="panel-disclosure"><summary><span>Collection</span><b>{successfulCollectors}/{snapshot.collectors.length}</b></summary><section className="status">{snapshot.collectors.map((collector) => <div key={collector.collector}><i className={collector.status}/><span>{collector.collector}</span><b>{collector.status}</b></div>)}{snapshot.diagnostics.map((item) => <div key={item.id} title={item.message}><i className={item.severity}/><span>{item.code}</span><b>{item.severity}</b></div>)}</section></details>
        <details className="panel-disclosure legend"><summary><span>Edge key</span><b>5 types</b></summary><div><i className="contains"/><span><b>contains</b> source hierarchy</span></div><div><i className="backed"/><span><b>backed by</b> OS → PCI device</span></div><div><i className="exposes"/><span><b>exposes</b> device → port</span></div><div><i className="connected"/><span><b>connected to</b> RDMA port ↔ netdev</span></div><div><i className="local"/><span><b>local to</b> explicit NUMA evidence</span></div><p>Known topology facts, not measured traffic or bandwidth.</p></details>
      </aside>}
      <section className={`viewport ${mode === "overview" ? "overview-workspace" : ""}`}>
        {mode === "overview" ? loadingInitialSnapshot ? <LoadingWorkspace/> : <OverviewWorkspace snapshot={snapshot} overview={overview} onOpen={openMode}/> : <>
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
      {mode !== "overview" && <aside className="details">{selectedNode ? <Details node={selectedNode} snapshot={snapshot} traceEndpoints={traceEndpoints} hiddenDescendantCount={projection?.hiddenDescendantCounts.get(selectedNode.id)} onChooseTrace={() => chooseTraceEndpoint(selectedNode.id)} onExploreBranch={mode === "io" && projection?.hiddenDescendantCounts.has(selectedNode.id) ? () => { setFocusRootId(selectedNode.id); setActiveNodeId(undefined); setView({ x: 0, y: 0, scale: 1 }); } : undefined}/> : <EmptyInspector mode={mode}/>}</aside>}
    </main>
  </div>;
}

function LoadingWorkspace() {
  return <div className="loading-workspace"><label className="section-label">LOADING SNAPSHOT</label><h1>Inspecting this machine…</h1><p>Waiting for the canonical topology before enabling exploration.</p></div>;
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
