import type { NodeKind, TopologySnapshot } from "../model/types";
import type { TopologyLayout } from "../layout/hierarchy";

export interface SvgRenderOptions { title?: string; visibleNodeIds?: ReadonlySet<string>; highlightedNodeIds?: ReadonlySet<string>; }

const colors: Record<NodeKind, string> = {
  host: "#9aa5b1", numa_node: "#d7a84b", cpu_package: "#7ea2c9", cpu_core: "#66809b",
  cache: "#879db2", memory_region: "#b18b55", pci_domain: "#9a8dbd", pci_bus: "#9a8dbd",
  pci_bridge: "#806fa6", pci_endpoint: "#77808b", gpu: "#68a982", nic: "#53a7ad",
  rdma_device: "#4f98a5", network_port: "#4f98a5", network_interface: "#5c9298", storage_device: "#b37f67"
};

export function renderTopologySvg(snapshot: TopologySnapshot, layout: TopologyLayout, options: SvgRenderOptions = {}): string {
  const visible = options.visibleNodeIds ?? new Set(snapshot.nodes.map((node) => node.id));
  const highlighted = options.highlightedNodeIds ?? new Set<string>();
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const layoutById = new Map(layout.nodes.map((node) => [node.id, node]));
  const edgeById = new Map(snapshot.edges.map((edge) => [edge.id, edge]));
  const edges = layout.edges.filter((item) => {
    const edge = edgeById.get(item.id);
    return edge && edge.kind !== "local_to" && visible.has(edge.source) && visible.has(edge.target) && item.path;
  }).map((item) => `    <path d="${item.path}" fill="none" stroke="#39414a" stroke-width="1.25" vector-effect="non-scaling-stroke"/>`).join("\n");
  const nodes = [...visible].filter((id) => byId.has(id) && layoutById.has(id)).sort().map((id) => {
    const node = byId.get(id)!;
    const box = layoutById.get(id)!;
    const fact = node.facts.pci_bdf?.value ?? node.facts.logical_index?.value ?? node.kind.replaceAll("_", " ");
    const stroke = highlighted.has(id) ? "#f0c66b" : colors[node.kind];
    return [
      `    <g data-node-id="${escapeXml(id)}" transform="translate(${box.x} ${box.y})">`,
      `      <rect width="${box.width}" height="${box.height}" rx="3" fill="#171b20" stroke="${stroke}" stroke-width="${highlighted.has(id) ? 2 : 1}"/>`,
      `      <rect width="4" height="${box.height}" fill="${colors[node.kind]}"/>`,
      `      <text x="16" y="22" fill="#edf0f2" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12">${escapeXml(truncate(node.label, 29))}</text>`,
      `      <text x="16" y="39" fill="#8f9aa5" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10">${escapeXml(String(fact))}</text>`,
      "    </g>"
    ].join("\n");
  }).join("\n");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-label="${escapeXml(options.title ?? "Contour topology")}">`,
    `  <title>${escapeXml(options.title ?? "Contour topology")}</title>`,
    '  <rect width="100%" height="100%" fill="#101317"/>',
    '  <g data-layer="edges">', edges, "  </g>",
    '  <g data-layer="nodes">', nodes, "  </g>",
    "</svg>"
  ].join("\n") + "\n";
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
function truncate(value: string, max: number): string { return value.length <= max ? value : `${value.slice(0, max - 1)}…`; }
