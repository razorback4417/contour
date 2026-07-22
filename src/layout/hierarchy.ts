import type { NodeKind, TopologySnapshot } from "../model/types";

export interface LayoutNode { id: string; x: number; y: number; width: number; height: number; depth: number; }
export interface LayoutEdge { id: string; path: string; }
export interface TopologyLayout { width: number; height: number; nodes: LayoutNode[]; edges: LayoutEdge[]; }

const WIDTH = 224;
const HEIGHT = 52;
const X_GAP = 54;
const Y_GAP = 16;
const MARGIN = 36;
const kindRank: Record<NodeKind, number> = {
  host: 0, numa_node: 1, cpu_package: 2, memory_region: 3, cache: 4, cpu_core: 5,
  pci_domain: 6, pci_bus: 7, pci_bridge: 8, pci_endpoint: 9, gpu: 10, nic: 11,
  rdma_device: 12, network_port: 13, network_interface: 14, storage_device: 15
};

export function layoutTopology(snapshot: TopologySnapshot, visibleNodeIds?: ReadonlySet<string>): TopologyLayout {
  const includedNodes = visibleNodeIds ? snapshot.nodes.filter((node) => visibleNodeIds.has(node.id)) : snapshot.nodes;
  const nodeById = new Map(includedNodes.map((node) => [node.id, node]));
  const children = new Map<string, string[]>();
  for (const node of includedNodes) {
    if (node.parentId && nodeById.has(node.parentId)) {
      const list = children.get(node.parentId) ?? [];
      list.push(node.id);
      children.set(node.parentId, list);
    }
  }
  for (const list of children.values()) {
    list.sort((a, b) => {
      const left = nodeById.get(a)!;
      const right = nodeById.get(b)!;
      return (kindRank[left.kind] - kindRank[right.kind]) || physicalSortKey(left).localeCompare(physicalSortKey(right)) || a.localeCompare(b);
    });
  }

  const placed: LayoutNode[] = [];
  let row = 0;
  function visit(id: string, depth: number): void {
    placed.push({ id, x: MARGIN + depth * (WIDTH + X_GAP), y: MARGIN + row * (HEIGHT + Y_GAP), width: WIDTH, height: HEIGHT, depth });
    row += 1;
    for (const child of children.get(id) ?? []) visit(child, depth + 1);
  }
  if (nodeById.has(snapshot.hostId)) visit(snapshot.hostId, 0);
  for (const node of includedNodes.filter((node) => !placed.some((item) => item.id === node.id))) visit(node.id, 0);
  const placedById = new Map(placed.map((node) => [node.id, node]));
  const layoutEdges = snapshot.edges.filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target)).map((edge) => {
    const source = placedById.get(edge.source);
    const target = placedById.get(edge.target);
    if (!source || !target) return { id: edge.id, path: "" };
    const sx = source.x + source.width;
    const sy = source.y + source.height / 2;
    const tx = target.x;
    const ty = target.y + target.height / 2;
    const mid = sx + (tx - sx) / 2;
    return { id: edge.id, path: `M ${sx} ${sy} H ${mid} V ${ty} H ${tx}` };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const maxDepth = Math.max(0, ...placed.map((node) => node.depth));
  return {
    width: MARGIN * 2 + (maxDepth + 1) * WIDTH + maxDepth * X_GAP,
    height: MARGIN * 2 + Math.max(1, placed.length) * HEIGHT + Math.max(0, placed.length - 1) * Y_GAP,
    nodes: placed,
    edges: layoutEdges
  };
}

function physicalSortKey(node: TopologySnapshot["nodes"][number]): string {
  const index = node.facts.logical_index?.value;
  if (typeof index === "number") return `index:${String(index).padStart(8, "0")}`;
  const bdf = node.facts.pci_bdf?.value;
  if (typeof bdf === "string") return `pci:${bdf}`;
  return `label:${node.label.toLowerCase()}`;
}
