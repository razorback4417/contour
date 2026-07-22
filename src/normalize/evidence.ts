import type { EvidenceObservation, PhysicalEvidence } from "../adapters/evidence";
import { stableHash, stableStringify } from "../model/stable";
import type { ProvenanceRecord, TopologyEdge, TopologyFact, TopologyNode, TopologySnapshot } from "../model/types";

export function enrichPhysicalEvidence(input: TopologySnapshot, evidence: PhysicalEvidence): TopologySnapshot {
  const snapshot = structuredClone(input);
  for (const observation of [...evidence.observations].sort(observationOrder)) {
    const node = resolveNode(snapshot, observation);
    if (!node) continue;
    const owner = observation.placement === "upstream_edge" ? upstreamEdge(snapshot, node) : node;
    if (!owner) continue;
    for (const item of observation.facts) owner.facts[item.key] = fact(item.value, item.rawValue ?? item.value, item.sourceField, observation);
    owner.facts = sortRecord(owner.facts);
  }
  for (const result of evidence.collectors) {
    const index = snapshot.collectors.findIndex((candidate) => candidate.collector === result.collector);
    if (index >= 0) snapshot.collectors[index] = result;
    else snapshot.collectors.push(result);
  }
  snapshot.collectors.sort((a, b) => a.collector.localeCompare(b.collector));
  snapshot.nodes.sort((a, b) => `${a.kind}\0${a.id}`.localeCompare(`${b.kind}\0${b.id}`));
  snapshot.edges.sort((a, b) => `${a.kind}\0${a.source}\0${a.target}`.localeCompare(`${b.kind}\0${b.source}\0${b.target}`));
  const identity = stableStringify({ nodes: snapshot.nodes, edges: snapshot.edges, collectors: snapshot.collectors.map(({ startedAt: _s, completedAt: _c, ...collector }) => collector) }, 0);
  snapshot.snapshotId = `snapshot:${stableHash(identity)}`;
  return snapshot;
}

function resolveNode(snapshot: TopologySnapshot, observation: EvidenceObservation): TopologyNode | undefined {
  const { pciBdf, ifname, rdmaDevice, port } = observation.target;
  if (pciBdf) return snapshot.nodes.find((node) => node.facts.pci_bdf?.value === pciBdf.toLowerCase());
  if (ifname) return snapshot.nodes.find((node) => node.facts["linux.ifname"]?.value === ifname || node.facts["hwloc.name"]?.value === ifname);
  if (rdmaDevice) {
    const device = snapshot.nodes.find((node) => node.kind === "rdma_device" && (node.facts["linux.rdma_name"]?.value === rdmaDevice || node.label === rdmaDevice));
    if (device && port !== undefined) return snapshot.nodes.find((node) => node.kind === "network_port" && node.parentId === device.id && node.facts.port?.value === port);
    return device;
  }
  return undefined;
}

function upstreamEdge(snapshot: TopologySnapshot, node: TopologyNode): TopologyEdge | undefined {
  return snapshot.edges.find((edge) => edge.kind === "contains" && edge.target === node.id)
    ?? snapshot.edges.find((edge) => edge.kind === "attached_to" && edge.target === node.id);
}

function fact(value: TopologyFact["value"], rawValue: TopologyFact["value"], sourceField: string, observation: EvidenceObservation): TopologyFact {
  const provenance: ProvenanceRecord = { collector: observation.collector, source: observation.source, sourceField, rawValue, normalizedValue: value, method: "observed" };
  return { value, state: "observed", provenance: [provenance] };
}

function observationOrder(a: EvidenceObservation, b: EvidenceObservation): number { return stableStringify(a, 0).localeCompare(stableStringify(b, 0)); }
function sortRecord<T>(record: Record<string, T>): Record<string, T> { return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b))); }
