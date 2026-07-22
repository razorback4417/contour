import type { TopologySnapshot } from "../model/types";

export interface TopologyInsight {
  id: string;
  severity: "info" | "attention";
  title: string;
  finding: string;
  evidence: string;
  nodeIds: string[];
}

const pathDeviceKinds = new Set(["gpu", "nic", "rdma_device", "network_interface", "storage_device", "pci_endpoint"]);

export function topologyInsights(snapshot: TopologySnapshot): TopologyInsight[] {
  const insights: TopologyInsight[] = [];
  const localitySources = new Set(snapshot.edges.filter((edge) => edge.kind === "local_to").map((edge) => edge.source));
  const devicesWithoutLocality = snapshot.nodes.filter((node) => pathDeviceKinds.has(node.kind) && !localitySources.has(node.id));
  if (devicesWithoutLocality.length > 0) {
    insights.push({
      id: "device-locality-unknown",
      severity: "attention",
      title: "Device NUMA locality is incomplete",
      finding: `${devicesWithoutLocality.length} device nodes have no explicit local_to relationship. Contour will not infer affinity from drawing position.`,
      evidence: "No canonical local_to edge was produced by the available collectors.",
      nodeIds: devicesWithoutLocality.map((node) => node.id)
    });
  }

  const nodesByParent = new Map<string, string[]>();
  for (const node of snapshot.nodes) if (node.parentId && pathDeviceKinds.has(node.kind)) nodesByParent.set(node.parentId, [...(nodesByParent.get(node.parentId) ?? []), node.id]);
  for (const [parentId, deviceIds] of nodesByParent) {
    if (deviceIds.length < 2) continue;
    const parent = snapshot.nodes.find((node) => node.id === parentId);
    if (!parent || parent.kind !== "pci_bridge") continue;
    insights.push({
      id: `shared-bridge:${parentId}`,
      severity: "info",
      title: "Potential shared PCIe contention domain",
      finding: `${deviceIds.length} device nodes share the immediate upstream bridge ${parent.label}.`,
      evidence: "Observed containment proves a shared bridge; it does not prove congestion, bandwidth, or simultaneous traffic.",
      nodeIds: [parentId, ...deviceIds]
    });
  }

  const hasNetworkHardware = snapshot.nodes.some((node) => node.kind === "nic" || node.kind === "network_interface");
  const hasRdmaCollector = snapshot.collectors.some((collector) => collector.collector.includes("rdma") && (collector.status === "success" || collector.status === "partial"));
  if (hasNetworkHardware && !hasRdmaCollector) {
    insights.push({
      id: "rdma-correlation-not-collected",
      severity: "attention",
      title: "RDMA correlation was not collected",
      finding: "Network hardware is present, but no RDMA collector result records whether RDMA devices and ports map to these interfaces.",
      evidence: "Collector inventory has no rdma source. This means unknown, not absent.",
      nodeIds: snapshot.nodes.filter((node) => node.kind === "nic" || node.kind === "network_interface").map((node) => node.id)
    });
  }
  return insights.sort((a, b) => a.id.localeCompare(b.id));
}
