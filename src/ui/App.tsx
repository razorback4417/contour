import { useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";
import { fixtures } from "../fixtures";
import { parseHwlocXml, HwlocParseError } from "../adapters/hwloc";
import { normalizeHwloc } from "../normalize/hwloc";
import { layoutTopology } from "../layout/hierarchy";
import { renderTopologySvg } from "../render/svg";
import type { NodeKind, TopologyNode, TopologySnapshot } from "../model/types";
import { panFromDrag, type DragOrigin } from "./viewport";

const filterKinds: NodeKind[] = ["cpu_package", "cpu_core", "cache", "numa_node", "memory_region", "pci_bridge", "pci_endpoint", "gpu", "nic", "rdma_device", "network_interface", "storage_device"];
const colors: Partial<Record<NodeKind, string>> = { host: "#9aa5b1", numa_node: "#d7a84b", cpu_package: "#7ea2c9", cpu_core: "#66809b", cache: "#879db2", memory_region: "#b18b55", pci_bridge: "#806fa6", pci_endpoint: "#77808b", gpu: "#68a982", nic: "#53a7ad", rdma_device: "#4f98a5", network_interface: "#5c9298", storage_device: "#b37f67" };

function load(xml: string, source: string): TopologySnapshot { return normalizeHwloc(parseHwlocXml(xml, source)); }

export function App() {
  const [snapshot, setSnapshot] = useState(() => load(fixtures.accelerator, "fixture:accelerator-server.xml"));
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const [enabledKinds, setEnabledKinds] = useState<Set<NodeKind>>(() => new Set(filterKinds));
  const [numa, setNuma] = useState<string>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const drag = useRef<DragOrigin | undefined>(undefined);
  const layout = useMemo(() => layoutTopology(snapshot), [snapshot]);
  const nodeById = useMemo(() => new Map(snapshot.nodes.map((node) => [node.id, node])), [snapshot]);
  const childMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const node of snapshot.nodes) if (node.parentId) map.set(node.parentId, [...(map.get(node.parentId) ?? []), node.id]);
    return map;
  }, [snapshot]);
  const hiddenByCollapse = useMemo(() => {
    const hidden = new Set<string>();
    const hide = (id: string) => { for (const child of childMap.get(id) ?? []) { hidden.add(child); hide(child); } };
    for (const id of collapsed) hide(id);
    return hidden;
  }, [collapsed, childMap]);
  const visible = useMemo(() => new Set(snapshot.nodes.filter((node) => {
    if (hiddenByCollapse.has(node.id)) return false;
    if (node.kind !== "host" && !enabledKinds.has(node.kind)) return false;
    if (query && !searchText(node).includes(query.toLowerCase())) return false;
    return true;
  }).map((node) => node.id)), [snapshot, enabledKinds, query, hiddenByCollapse]);
  const highlighted = useMemo(() => {
    const ids = new Set(selected);
    if (numa !== "all") {
      ids.add(numa);
      for (const edge of snapshot.edges) if (edge.kind === "local_to" && edge.target === numa) ids.add(edge.source);
    }
    if (selected.length === 2) for (const id of tracePath(selected[0], selected[1], nodeById)) ids.add(id);
    return ids;
  }, [selected, numa, snapshot, nodeById]);
  const selectedNode = selected.length ? nodeById.get(selected[selected.length - 1]) : undefined;
  const numaNodes = snapshot.nodes.filter((node) => node.kind === "numa_node");

  function resetSnapshot(next: TopologySnapshot) {
    setSnapshot(next); setSelected([]); setCollapsed(new Set()); setQuery(""); setNuma("all"); setError(undefined); setView({ x: 0, y: 0, scale: 1 });
  }
  async function openFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try { resetSnapshot(load(await file.text(), file.name)); }
    catch (reason) { setError(reason instanceof HwlocParseError ? reason.message : String(reason)); }
    event.target.value = "";
  }
  function toggleKind(kind: NodeKind) {
    setEnabledKinds((current) => { const next = new Set(current); next.has(kind) ? next.delete(kind) : next.add(kind); return next; });
  }
  function selectNode(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current.slice(-1), id]);
  }
  function toggleCollapse(id: string) {
    setCollapsed((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }
  function exportSvg() {
    const svg = renderTopologySvg(snapshot, layout, { title: `Contour · ${nodeById.get(snapshot.hostId)?.label ?? "host"}`, visibleNodeIds: visible, highlightedNodeIds: highlighted });
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${nodeById.get(snapshot.hostId)?.label ?? "topology"}.svg`; anchor.click(); URL.revokeObjectURL(url);
  }
  function wheel(event: WheelEvent<SVGSVGElement>) { event.preventDefault(); setView((current) => ({ ...current, scale: Math.min(2.5, Math.max(0.3, current.scale * (event.deltaY > 0 ? 0.9 : 1.1))) })); }
  function pointerDown(event: ReactPointerEvent<SVGSVGElement>) { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { pointerX: event.clientX, pointerY: event.clientY, viewX: view.x, viewY: view.y }; }
  function pointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const origin = drag.current;
    if (!origin) return;
    const next = panFromDrag(origin, event.clientX, event.clientY);
    setView((current) => ({ ...current, ...next }));
  }
  function pointerUp() { drag.current = undefined; }

  return <div className="shell">
    <header><div><span className="wordmark">CONTOUR</span><span className="subtitle">SYSTEM TOPOLOGY EXPLORER</span></div><div className="header-actions">
      <button onClick={() => resetSnapshot(load(fixtures.workstation, "fixture:workstation.xml"))}>Workstation fixture</button>
      <button onClick={() => resetSnapshot(load(fixtures.accelerator, "fixture:accelerator-server.xml"))}>Accelerator fixture</button>
      <label className="button">Load XML<input type="file" accept=".xml,text/xml" onChange={openFile}/></label>
      <button className="primary" onClick={exportSvg}>Export SVG</button>
    </div></header>
    {error && <div className="error">INPUT ERROR · {error}</div>}
    <main>
      <aside className="controls">
        <section><label className="section-label">SEARCH</label><input className="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="BDF, interface, model…"/></section>
        <section><label className="section-label">NUMA LOCALITY</label><select value={numa} onChange={(event) => setNuma(event.target.value)}><option value="all">All nodes</option>{numaNodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></section>
        <section><label className="section-label">DEVICE CLASSES</label><div className="filters">{filterKinds.map((kind) => <label key={kind}><input type="checkbox" checked={enabledKinds.has(kind)} onChange={() => toggleKind(kind)}/><span style={{ background: colors[kind] }}/>{kind.replaceAll("_", " ")}</label>)}</div></section>
        <section className="status"><label className="section-label">COLLECTION</label>{snapshot.collectors.map((collector) => <div key={collector.collector}><i className={collector.status}/><span>{collector.collector}</span><b>{collector.status}</b></div>)}</section>
        <section className="status"><label className="section-label">DIAGNOSTICS · {snapshot.diagnostics.length}</label>{snapshot.diagnostics.map((item) => <div key={item.id} title={item.message}><i className={item.severity}/><span>{item.code}</span></div>)}</section>
      </aside>
      <section className="viewport">
        <div className="viewport-meta"><span>{snapshot.nodes.length} NODES · {snapshot.edges.length} EDGES</span><span>SCHEMA {snapshot.schemaVersion.split("/")[1]} · {Math.round(view.scale * 100)}%</span></div>
        <svg onWheel={wheel} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-label="Interactive system topology">
          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
            {layout.edges.map((item) => { const edge = snapshot.edges.find((candidate) => candidate.id === item.id); return edge && edge.kind !== "local_to" && visible.has(edge.source) && visible.has(edge.target) ? <path key={item.id} d={item.path} className={`edge ${edge.kind}`}/> : null; })}
            {layout.nodes.map((box) => { const node = nodeById.get(box.id)!; if (!visible.has(node.id)) return null; const hasChildren = (childMap.get(node.id)?.length ?? 0) > 0; return <g key={node.id} className={`node ${highlighted.has(node.id) ? "highlighted" : ""} ${selected.includes(node.id) ? "selected" : ""}`} transform={`translate(${box.x} ${box.y})`} onClick={(event) => { event.stopPropagation(); selectNode(node.id); }} onDoubleClick={(event) => { event.stopPropagation(); toggleCollapse(node.id); }}>
              <rect width={box.width} height={box.height} rx="3"/><rect className="kind-bar" width="4" height={box.height} fill={colors[node.kind]}/><text x="16" y="22">{truncate(node.label, 29)}</text><text className="secondary" x="16" y="39">{String(node.facts.pci_bdf?.value ?? node.facts.logical_index?.value ?? node.kind.replaceAll("_", " "))}</text>{hasChildren && <text className="collapse" x={box.width - 16} y="31">{collapsed.has(node.id) ? "+" : "−"}</text>}
            </g>; })}
          </g>
        </svg>
        <div className="hint">SCROLL TO ZOOM · DRAG TO PAN · DOUBLE-CLICK TO COLLAPSE · SELECT TWO NODES TO TRACE</div>
      </section>
      <aside className="details">{selectedNode ? <Details node={selectedNode} snapshot={snapshot}/> : <EmptyDetails snapshot={snapshot}/>}</aside>
    </main>
  </div>;
}

function Details({ node, snapshot }: { node: TopologyNode; snapshot: TopologySnapshot }) {
  const relationships = snapshot.edges.filter((edge) => edge.source === node.id || edge.target === node.id);
  return <><div className="details-heading"><span className="kind-dot" style={{ background: colors[node.kind] }}/><div><label>{node.kind.replaceAll("_", " ")}</label><h2>{node.label}</h2><code>{node.id}</code></div></div><section><label className="section-label">FACTS & PROVENANCE</label>{Object.entries(node.facts).map(([key, fact]) => <details key={key}><summary><span>{key}</span><b className={fact.state}>{fact.value === null ? "UNKNOWN" : String(fact.value)}</b></summary>{fact.provenance.map((provenance, index) => <dl key={index}><dt>state</dt><dd>{fact.state}</dd><dt>collector</dt><dd>{provenance.collector}</dd><dt>source field</dt><dd>{provenance.sourceField}</dd><dt>raw</dt><dd>{String(provenance.rawValue)}</dd>{provenance.derivationRule && <><dt>rule</dt><dd>{provenance.derivationRule}</dd></>}</dl>)}</details>)}</section><section><label className="section-label">RELATIONSHIPS · {relationships.length}</label>{relationships.map((edge) => <div className="relationship" key={edge.id}><b>{edge.kind}</b><code>{edge.source === node.id ? `→ ${edge.target}` : `← ${edge.source}`}</code></div>)}</section></>;
}
function EmptyDetails({ snapshot }: { snapshot: TopologySnapshot }) { const count = (kind: NodeKind) => snapshot.nodes.filter((node) => node.kind === kind).length; const memory = snapshot.nodes.filter((node) => node.kind === "memory_region").reduce((sum, node) => sum + Number(node.facts.capacity_bytes?.value ?? 0), 0); return <div className="empty-details"><label className="section-label">SNAPSHOT SUMMARY</label><h2>{snapshot.nodes.find((node) => node.id === snapshot.hostId)?.label}</h2><div className="summary-grid"><span><b>{count("cpu_package")}</b>CPU packages</span><span><b>{count("numa_node")}</b>NUMA nodes</span><span><b>{count("gpu")}</b>GPU nodes</span><span><b>{count("nic")}</b>NIC nodes</span><span><b>{formatBytes(memory)}</b>memory</span><span><b>{snapshot.diagnostics.length}</b>diagnostics</span></div><p>Select a node for exact facts and provenance. Select two nodes to highlight their known containment path.</p></div>; }
function searchText(node: TopologyNode): string { return `${node.label} ${node.kind} ${Object.values(node.facts).map((fact) => fact.value).join(" ")}`.toLowerCase(); }
function tracePath(a: string, b: string, nodes: Map<string, TopologyNode>): string[] { const chain = (id: string) => { const result: string[] = []; let current: TopologyNode | undefined = nodes.get(id); while (current) { result.push(current.id); current = current.parentId ? nodes.get(current.parentId) : undefined; } return result; }; const left = chain(a); const right = chain(b); const common = left.find((id) => right.includes(id)); return common ? [...left.slice(0, left.indexOf(common) + 1), ...right.slice(0, right.indexOf(common)).reverse()] : [a, b]; }
function truncate(value: string, max: number): string { return value.length <= max ? value : `${value.slice(0, max - 1)}…`; }
function formatBytes(bytes: number): string { if (!bytes) return "unknown"; const gib = bytes / 1024 ** 3; return `${Number.isInteger(gib) ? gib : gib.toFixed(1)} GiB`; }
