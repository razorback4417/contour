import type { NodeKind, TopologySnapshot } from "../model/types";

export type TopologyViewMode = "io" | "compute";
export interface TopologyViewOptions { mode: TopologyViewMode; focusRootId?: string; query?: string; }
export interface TopologyProjection {
  visibleNodeIds: Set<string>;
  hiddenDescendantCounts: Map<string, number>;
  matchingNodeCount: number;
}

export interface TopologyOverview {
  totalNodes: number;
  totalEdges: number;
  cpuPackages: number;
  cpuCores: number;
  caches: number;
  numaNodes: number;
  memoryBytes: number;
  ioDevices: number;
  gpus: number;
  nics: number;
  rdmaDevices: number;
  interfaces: number;
  storageDevices: number;
  upstreamGroups: number;
}

const computeKinds = new Set<NodeKind>(["host", "cpu_package", "numa_node", "memory_region"]);
const ioKinds = new Set<NodeKind>(["host", "pci_domain", "pci_bus", "pci_bridge", "pci_endpoint", "gpu", "nic", "rdma_device", "network_port", "network_interface", "storage_device"]);

export function topologyOverview(snapshot: TopologySnapshot): TopologyOverview {
  const count = (kind: NodeKind) => snapshot.nodes.filter((node) => node.kind === kind).length;
  const memoryBytes = snapshot.nodes.filter((node) => node.kind === "memory_region").reduce((sum, node) => sum + Number(node.facts.capacity_bytes?.value ?? 0), 0);
  return {
    totalNodes: snapshot.nodes.length,
    totalEdges: snapshot.edges.length,
    cpuPackages: count("cpu_package"),
    cpuCores: count("cpu_core"),
    caches: count("cache"),
    numaNodes: count("numa_node"),
    memoryBytes,
    ioDevices: snapshot.nodes.filter((node) => ["pci_endpoint", "gpu", "nic", "rdma_device", "storage_device"].includes(node.kind)).length,
    gpus: count("gpu"),
    nics: count("nic"),
    rdmaDevices: count("rdma_device"),
    interfaces: count("network_interface"),
    storageDevices: count("storage_device"),
    upstreamGroups: ioRoots(snapshot).length,
  };
}

export function projectTopologyView(snapshot: TopologySnapshot, options: TopologyViewOptions): TopologyProjection {
  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const children = childMap(snapshot);
  const visible = new Set<string>();
  const hiddenDescendantCounts = new Map<string, number>();
  const query = options.query?.trim().toLowerCase();

  if (query) {
    const matches = snapshot.nodes.filter((node) => searchText(node).includes(query)).sort((a, b) => a.id.localeCompare(b.id));
    for (const node of matches.slice(0, 24)) addWithAncestors(node.id, visible, nodeById);
    return { visibleNodeIds: visible, hiddenDescendantCounts, matchingNodeCount: matches.length };
  }

  if (options.mode === "compute") {
    for (const node of snapshot.nodes) if (computeKinds.has(node.kind)) visible.add(node.id);
    return { visibleNodeIds: visible, hiddenDescendantCounts, matchingNodeCount: visible.size };
  }

  const roots = ioRoots(snapshot);
  if (options.focusRootId && roots.some((node) => node.id === options.focusRootId)) {
    addWithAncestors(options.focusRootId, visible, nodeById);
    for (const id of descendants(options.focusRootId, children)) if (ioKinds.has(nodeById.get(id)!.kind)) visible.add(id);
  } else {
    for (const root of roots) {
      addWithAncestors(root.id, visible, nodeById);
      const hidden = descendants(root.id, children).filter((id) => ioKinds.has(nodeById.get(id)!.kind)).length;
      if (hidden > 0) hiddenDescendantCounts.set(root.id, hidden);
    }
    for (const node of snapshot.nodes) {
      if (!ioKinds.has(node.kind) || node.kind === "host" || hasPciAncestor(node.id, nodeById)) continue;
      if (["network_interface", "rdma_device", "network_port"].includes(node.kind)) addWithAncestors(node.id, visible, nodeById);
    }
  }
  return { visibleNodeIds: visible, hiddenDescendantCounts, matchingNodeCount: visible.size };
}

export function searchTopologyNodes(snapshot: TopologySnapshot, value: string, limit = 8): TopologySnapshot["nodes"] {
  const query = value.trim().toLowerCase();
  if (!query || limit <= 0) return [];
  return snapshot.nodes
    .filter((node) => searchText(node).includes(query))
    .sort((left, right) => searchScore(left, query) - searchScore(right, query) || left.label.localeCompare(right.label) || left.id.localeCompare(right.id))
    .slice(0, limit);
}

export function ioRoots(snapshot: TopologySnapshot) {
  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  return snapshot.nodes.filter((node) => ["pci_domain", "pci_bus", "pci_bridge"].includes(node.kind) && !hasPciAncestor(node.id, nodeById)).sort((a, b) => a.id.localeCompare(b.id));
}

function childMap(snapshot: TopologySnapshot): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const node of snapshot.nodes) if (node.parentId) result.set(node.parentId, [...(result.get(node.parentId) ?? []), node.id]);
  for (const ids of result.values()) ids.sort();
  return result;
}

function descendants(id: string, children: ReadonlyMap<string, string[]>): string[] {
  return (children.get(id) ?? []).flatMap((child) => [child, ...descendants(child, children)]);
}

function addWithAncestors(id: string, visible: Set<string>, nodes: ReadonlyMap<string, TopologySnapshot["nodes"][number]>): void {
  let current = nodes.get(id);
  while (current) {
    visible.add(current.id);
    current = current.parentId ? nodes.get(current.parentId) : undefined;
  }
}

function hasPciAncestor(id: string, nodes: ReadonlyMap<string, TopologySnapshot["nodes"][number]>): boolean {
  let current = nodes.get(id)?.parentId ? nodes.get(nodes.get(id)!.parentId!) : undefined;
  while (current) {
    if (["pci_domain", "pci_bus", "pci_bridge"].includes(current.kind)) return true;
    current = current.parentId ? nodes.get(current.parentId) : undefined;
  }
  return false;
}

function searchText(node: TopologySnapshot["nodes"][number]): string {
  return `${node.id} ${node.label} ${node.kind} ${Object.values(node.facts).map((fact) => fact.value).join(" ")}`.toLowerCase();
}

function searchScore(node: TopologySnapshot["nodes"][number], query: string): number {
  const label = node.label.toLowerCase();
  const identifiers = [node.id, ...Object.values(node.facts).map((fact) => String(fact.value ?? ""))].map((value) => value.toLowerCase());
  if (label === query) return 0;
  if (identifiers.some((value) => value === query)) return 1;
  if (label.startsWith(query)) return 2;
  if (identifiers.some((value) => value.startsWith(query))) return 3;
  if (node.kind.replaceAll("_", " ").startsWith(query)) return 4;
  return 5;
}
