import { describe, expect, it } from "vitest";
import { buildPathDossier, topologyFindings } from "../src/analysis/troubleshooting";
import type { EdgeKind, FactValue, TopologyEdge, TopologyFact, TopologyNode, TopologySnapshot } from "../src/model/types";

describe("deterministic troubleshooting analysis", () => {
  it("builds an evidence-backed path dossier and prioritizes actionable findings", () => {
    const snapshot = fixture();
    const dossier = buildPathDossier(snapshot, "gpu", "netdev");

    expect(dossier.pathIds).toEqual(["gpu", "bridge-a", "host", "bridge-b", "nic", "netdev"]);
    expect(dossier.numaStatus).toBe("crosses");
    expect(dossier.hops.find((hop) => hop.nodeId === "gpu")?.linkFacts).toEqual(expect.arrayContaining([expect.objectContaining({ key: "pcie.current_width", value: 8 })]));
    expect(dossier.findings.map((finding) => finding.id)).toEqual(expect.arrayContaining([
      "numa-crossing:gpu:netdev",
      "link-below-capability:contains:bridge-a:gpu",
      "counter-evidence:contains:bridge-a:gpu",
      "rdma-netdev-state:port:netdev",
      "devlink-health:nic"
    ]));
    expect(dossier.findings[0].severity).toBe("attention");
    expect(dossier.findings.every((finding) => finding.evidence.length > 0 && finding.verificationCommand)).toBe(true);
  });

  it("keeps unavailable evidence distinct from a healthy result and produces stable ordering", () => {
    const snapshot = fixture();
    snapshot.edges = [...snapshot.edges].reverse();
    snapshot.nodes = [...snapshot.nodes].reverse();
    const first = topologyFindings(snapshot);
    const second = topologyFindings(structuredClone(snapshot));
    expect(first).toEqual(second);
    expect(first.find((finding) => finding.id === "collection-incomplete")?.summary).toContain("mlxlink");
  });
});

function fixture(): TopologySnapshot {
  const nodes: TopologyNode[] = [
    node("host", "host", "host"),
    node("numa0", "numa_node", "NUMA 0"), node("numa1", "numa_node", "NUMA 1"),
    node("bridge-a", "pci_bridge", "Bridge A", "host"), node("bridge-b", "pci_bridge", "Bridge B", "host"),
    node("gpu", "gpu", "GPU 0", "bridge-a", { pci_bdf: "0000:01:00.0" }),
    node("nic", "nic", "ConnectX", "bridge-b", { pci_bdf: "0000:02:00.0", "devlink.health.tx.state": "error" }),
    node("netdev", "network_interface", "eth0", "nic", { "linux.ifname": "eth0", operstate: "UP" }),
    node("rdma", "rdma_device", "mlx5_0", "nic", { "linux.rdma_name": "mlx5_0" }),
    node("port", "network_port", "mlx5_0 port 1", "rdma", { port: 1, state: "DOWN" })
  ];
  const edges = [
    edge("contains", "host", "bridge-a"), edge("contains", "bridge-a", "gpu", { "pcie.current_width": 8, "pcie.max_width": 16, "pcie.aer.correctable": 3 }),
    edge("contains", "host", "bridge-b"), edge("contains", "bridge-b", "nic"), edge("contains", "nic", "netdev"), edge("contains", "nic", "rdma"), edge("exposes", "rdma", "port"),
    edge("connected_to", "port", "netdev"), edge("local_to", "gpu", "numa0"), edge("local_to", "netdev", "numa1")
  ];
  return { schemaVersion: "contour.topology/v2", snapshotId: "snapshot:test", hostId: "host", collectedAt: "2026-07-22T00:00:00Z", nodes, edges, diagnostics: [], collectors: [
    { collector: "linux.pci_sysfs", status: "success", startedAt: "", completedAt: "", source: "/sys" },
    { collector: "nvidia.mlxlink", status: "failed", startedAt: "", completedAt: "", source: "mlxlink", message: "permission denied" }
  ] };
}

function node(id: string, kind: TopologyNode["kind"], label: string, parentId?: string, facts: Record<string, FactValue> = {}): TopologyNode {
  return { id, kind, label, ...(parentId ? { parentId } : {}), facts: Object.fromEntries(Object.entries(facts).map(([key, value]) => [key, fact(value)])) };
}
function edge(kind: EdgeKind, source: string, target: string, facts: Record<string, FactValue> = {}): TopologyEdge {
  return { id: `${kind}:${source}:${target}`, kind, source, target, facts: Object.fromEntries(Object.entries(facts).map(([key, value]) => [key, fact(value)])), provenance: [] };
}
function fact(value: FactValue): TopologyFact { return { value, state: "observed", provenance: [{ collector: "test", source: "test", sourceField: "test", rawValue: value, normalizedValue: value, method: "observed" }] }; }
