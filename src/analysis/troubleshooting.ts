import type { FactValue, TopologyEdge, TopologyFact, TopologyNode, TopologySnapshot } from "../model/types";

export interface TroubleshootingFinding {
  id: string;
  severity: "attention" | "info";
  title: string;
  summary: string;
  evidence: string[];
  uncertainty: string;
  nodeIds: string[];
  edgeIds: string[];
  verificationCommand: string;
}

export interface PathHop {
  nodeId: string;
  label: string;
  kind: TopologyNode["kind"];
  identifier?: string;
  numaLabels: string[];
  linkFacts: Array<{ key: string; value: FactValue; state: TopologyFact["state"] }>;
}

export interface PathDossier {
  endpointIds: string[];
  pathIds: string[];
  hops: PathHop[];
  numaStatus: "same" | "crosses" | "unknown";
  findings: TroubleshootingFinding[];
}

export interface LinkAssessment {
  state: "within_capability" | "below_capability" | "observed";
  label: string;
  note: string;
}

const deviceKinds = new Set<TopologyNode["kind"]>(["gpu", "nic", "rdma_device", "network_port", "network_interface", "storage_device", "pci_endpoint"]);

export function buildPathDossier(snapshot: TopologySnapshot, endpointA: string, endpointB?: string): PathDossier {
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const endpointIds = endpointB ? [endpointA, endpointB] : [endpointA];
  const pathIds = endpointB ? traceTopologyPath(endpointA, endpointB, nodes) : [endpointA];
  const numaSets = endpointIds.map((id) => localityFor(snapshot, id));
  const numaStatus = numaSets.length < 2 || numaSets.some((set) => set.size === 0) ? "unknown" : [...numaSets[0]].some((id) => numaSets[1].has(id)) ? "same" : "crosses";
  const scopedIds = new Set(pathIds);
  for (const endpoint of endpointIds) for (const id of relatedNodes(snapshot, endpoint)) scopedIds.add(id);
  let findings = topologyFindings(snapshot).filter((finding) => finding.id === "collection-incomplete" || finding.nodeIds.some((id) => scopedIds.has(id)) || finding.edgeIds.some((id) => pathHasEdge(pathIds, snapshot.edges.find((edge) => edge.id === id))));
  if (endpointB && numaStatus === "crosses") {
    const left = labelsForIds(nodes, numaSets[0]);
    const right = labelsForIds(nodes, numaSets[1]);
    findings.push({
      id: `numa-crossing:${endpointA}:${endpointB}`, severity: "attention", title: "Path crosses NUMA locality", summary: `${nodes.get(endpointA)?.label ?? endpointA} is local to ${left.join(", ")}; ${nodes.get(endpointB)?.label ?? endpointB} is local to ${right.join(", ")}.`,
      evidence: ["Explicit local_to relationships place the endpoints in different NUMA domains."], uncertainty: "Topology establishes locality, not workload placement or measured transfer cost.", nodeIds: endpointIds, edgeIds: [], verificationCommand: "numactl --hardware"
    });
  }
  findings = sortFindings(findings);
  return { endpointIds, pathIds, numaStatus, findings, hops: pathIds.map((id) => hop(snapshot, nodes.get(id)!)) };
}

export function topologyFindings(snapshot: TopologySnapshot): TroubleshootingFinding[] {
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const findings: TroubleshootingFinding[] = [];

  for (const edge of snapshot.edges) {
    const currentWidth = numericBySuffix(edge.facts, ".current_width");
    const maxWidth = numericBySuffix(edge.facts, ".max_width");
    const currentSpeed = numericBySuffix(edge.facts, ".current_speed_gt_s", ".current_generation");
    const maxSpeed = numericBySuffix(edge.facts, ".max_speed_gt_s", ".max_generation");
    if (assessLinkEvidence(edge).state === "below_capability") {
      const target = nodes.get(edge.target);
      const observed = [currentSpeed !== undefined ? `speed ${currentSpeed}` : undefined, currentWidth !== undefined ? `width x${currentWidth}` : undefined].filter(Boolean).join(", ");
      const capable = [maxSpeed !== undefined ? `speed ${maxSpeed}` : undefined, maxWidth !== undefined ? `width x${maxWidth}` : undefined].filter(Boolean).join(", ");
      findings.push({ id: `link-below-capability:${edge.id}`, severity: "attention", title: "PCIe link below reported capability", summary: `${target?.label ?? edge.target} reports ${observed}; capability is ${capable}.`, evidence: factEvidence(edge.facts, ["current", "max"]), uncertainty: "PCIe speed may reduce while idle; confirm under representative load before treating this as degradation.", nodeIds: [edge.target], edgeIds: [edge.id], verificationCommand: pciCommand(target) });
    }
    const counters = positiveConcernCounters(edge.facts);
    if (counters.length) {
      const target = nodes.get(edge.target);
      findings.push({ id: `counter-evidence:${edge.id}`, severity: "attention", title: "Nonzero link error evidence", summary: `${target?.label ?? edge.target} has ${counterSummary(counters)}.`, evidence: factEvidence(edge.facts, counters.map(([key]) => key)), uncertainty: "These are point-in-time cumulative observations; collect another snapshot to determine whether they are increasing.", nodeIds: [edge.target], edgeIds: [edge.id], verificationCommand: pciCommand(target) });
    }
  }

  for (const node of snapshot.nodes) {
    const counters = positiveConcernCounters(node.facts);
    if (counters.length) findings.push({ id: `counter-evidence:${node.id}`, severity: "attention", title: "Nonzero device counter evidence", summary: `${node.label} has ${counterSummary(counters)}.`, evidence: factEvidence(node.facts, counters.map(([key]) => key)), uncertainty: "Counters are cumulative and do not identify when the event occurred without a second sample.", nodeIds: [node.id], edgeIds: [], verificationCommand: counterCommand(node) });
    const unhealthy = Object.entries(node.facts).filter(([key, fact]) => key.includes("devlink.health") && key.endsWith(".state") && typeof fact.value === "string" && !/^(healthy|ok|running)$/i.test(fact.value));
    if (unhealthy.length) findings.push({ id: `devlink-health:${node.id}`, severity: "attention", title: "Driver health reporter is not healthy", summary: `${node.label}: ${unhealthy.map(([key, fact]) => `${key}=${fact.value}`).join(", ")}.`, evidence: factEvidence(node.facts, unhealthy.map(([key]) => key)), uncertainty: "Reporter state is driver-provided and may require a driver-specific dump for root cause.", nodeIds: [node.id], edgeIds: [], verificationCommand: devlinkCommand(node) });
  }

  for (const edge of snapshot.edges.filter((candidate) => candidate.kind === "connected_to")) {
    const left = nodes.get(edge.source); const right = nodes.get(edge.target);
    const port = left?.kind === "network_port" ? left : right?.kind === "network_port" ? right : undefined;
    const netdev = left?.kind === "network_interface" ? left : right?.kind === "network_interface" ? right : undefined;
    const portState = stringFact(port, "state") ?? stringFact(port, "physical_state");
    const netdevState = stringFact(netdev, "operstate");
    if (port && netdev && portState && netdevState && /^(up|unknown)$/i.test(netdevState) && !/(active|up)/i.test(portState)) findings.push({ id: `rdma-netdev-state:${port.id}:${netdev.id}`, severity: "attention", title: "RDMA and netdev states disagree", summary: `${netdev.label} is ${netdevState}, while ${port.label} is ${portState}.`, evidence: [`${netdev.label}.operstate=${netdevState}`, `${port.label}.state=${portState}`, "An explicit connected_to relationship correlates the objects."], uncertainty: "Administrative and physical RDMA states can transition independently; verify the live port state.", nodeIds: [port.id, netdev.id], edgeIds: [edge.id], verificationCommand: "rdma -d -j link show" });
  }

  const localitySources = new Set(snapshot.edges.filter((edge) => edge.kind === "local_to").map((edge) => edge.source));
  const withoutLocality = snapshot.nodes.filter((node) => deviceKinds.has(node.kind) && !localitySources.has(node.id));
  if (withoutLocality.length) findings.push({ id: "device-locality-unknown", severity: "info", title: "NUMA locality was not observed", summary: `${withoutLocality.length} device objects have no explicit locality relationship.`, evidence: ["No canonical local_to relationship was produced for these objects."], uncertainty: "Unknown does not mean remote or non-NUMA; the available sources did not establish locality.", nodeIds: withoutLocality.map((node) => node.id).sort(), edgeIds: [], verificationCommand: "numactl --hardware" });

  for (const bridge of snapshot.nodes.filter((node) => node.kind === "pci_bridge")) {
    const children = snapshot.nodes.filter((node) => node.parentId === bridge.id && deviceKinds.has(node.kind));
    if (children.length > 1) findings.push({ id: `shared-bridge:${bridge.id}`, severity: "info", title: "Devices share an immediate PCIe bridge", summary: `${children.length} device objects share ${bridge.label}.`, evidence: children.map((node) => node.label), uncertainty: "Shared containment identifies a possible contention domain, not simultaneous traffic or congestion.", nodeIds: [bridge.id, ...children.map((node) => node.id)], edgeIds: [], verificationCommand: "lspci -D -t" });
  }

  const incomplete = snapshot.collectors.filter((collector) => collector.status !== "success");
  if (incomplete.length) findings.push({ id: "collection-incomplete", severity: "info", title: "Collection coverage is incomplete", summary: incomplete.map((collector) => `${shortCollector(collector.collector)}=${collector.status}`).join(", "), evidence: incomplete.map((collector) => collector.message ? `${collector.collector}: ${compactMessage(collector.message)}` : `${collector.collector}: ${collector.status}`), uncertainty: "Unavailable evidence is unknown, not a healthy or absent result. Full collector messages remain in the exported snapshot.", nodeIds: [], edgeIds: [], verificationCommand: "contour doctor" });
  return sortFindings(findings);
}

export function traceTopologyPath(a: string, b: string, nodes: ReadonlyMap<string, TopologyNode>): string[] {
  const left = ancestorChain(a, nodes); const right = ancestorChain(b, nodes); const common = left.find((id) => right.includes(id));
  return common ? [...left.slice(0, left.indexOf(common) + 1), ...right.slice(0, right.indexOf(common)).reverse()] : [a, b];
}
export function pathContainsEdge(path: readonly string[], source: string, target: string): boolean { return path.some((id, index) => index < path.length - 1 && ((id === source && path[index + 1] === target) || (id === target && path[index + 1] === source))); }
export function assessLinkEvidence(edge: TopologyEdge): LinkAssessment {
  const currentWidth = numericBySuffix(edge.facts, ".current_width"); const maxWidth = numericBySuffix(edge.facts, ".max_width");
  const currentSpeed = numericBySuffix(edge.facts, ".current_speed_gt_s", ".current_generation"); const maxSpeed = numericBySuffix(edge.facts, ".max_speed_gt_s", ".max_generation");
  const below = (currentWidth !== undefined && maxWidth !== undefined && currentWidth < maxWidth) || (currentSpeed !== undefined && maxSpeed !== undefined && currentSpeed < maxSpeed);
  if (below) return { state: "below_capability", label: "Below reported capability", note: "Current PCIe speed can reduce while a device is idle; confirm under load before treating this as degradation." };
  if ((currentWidth !== undefined && maxWidth !== undefined) || (currentSpeed !== undefined && maxSpeed !== undefined)) return { state: "within_capability", label: "At reported capability", note: "Capability and negotiated values are observations from the available collectors." };
  return { state: "observed", label: "Physical evidence collected", note: "The source did not expose a complete current-versus-capable pair." };
}

function hop(snapshot: TopologySnapshot, node: TopologyNode): PathHop {
  const upstream = snapshot.edges.find((edge) => (edge.kind === "contains" || edge.kind === "attached_to") && edge.target === node.id);
  const numaIds = localityFor(snapshot, node.id);
  const nodes = new Map(snapshot.nodes.map((item) => [item.id, item]));
  return { nodeId: node.id, label: node.label, kind: node.kind, identifier: identifier(node), numaLabels: labelsForIds(nodes, numaIds), linkFacts: Object.entries(upstream?.facts ?? {}).map(([key, fact]) => ({ key, value: fact.value, state: fact.state })).sort((a, b) => a.key.localeCompare(b.key)) };
}
function localityFor(snapshot: TopologySnapshot, id: string): Set<string> { const related = relatedNodes(snapshot, id); return new Set(snapshot.edges.filter((edge) => edge.kind === "local_to" && related.has(edge.source)).map((edge) => edge.target)); }
function relatedNodes(snapshot: TopologySnapshot, id: string): Set<string> { const ids = new Set([id]); for (let depth = 0; depth < 3; depth += 1) { for (const edge of snapshot.edges) if (["backed_by", "connected_to", "exposes"].includes(edge.kind)) { if (ids.has(edge.source)) ids.add(edge.target); if (ids.has(edge.target)) ids.add(edge.source); } for (const node of snapshot.nodes) if (ids.has(node.id) && node.parentId) ids.add(node.parentId); } return ids; }
function ancestorChain(id: string, nodes: ReadonlyMap<string, TopologyNode>): string[] { const result: string[] = []; let current = nodes.get(id); while (current) { result.push(current.id); current = current.parentId ? nodes.get(current.parentId) : undefined; } return result; }
function pathHasEdge(path: string[], edge: TopologyEdge | undefined): boolean { return Boolean(edge && pathContainsEdge(path, edge.source, edge.target)); }
function numericBySuffix(facts: Record<string, TopologyFact>, ...suffixes: string[]): number | undefined { for (const [key, fact] of Object.entries(facts)) if (suffixes.some((suffix) => key.endsWith(suffix)) && typeof fact.value === "number") return fact.value; return undefined; }
function positiveConcernCounters(facts: Record<string, TopologyFact>): Array<[string, number]> { const counters: Array<[string, number]> = []; for (const [key, fact] of Object.entries(facts)) if (typeof fact.value === "number" && fact.value > 0 && /aer\.|(?:error|discard|drop|out_of_buffer|uncorrected|replay)/i.test(key)) counters.push([key, fact.value]); return counters.sort(([a], [b]) => a.localeCompare(b)); }
function factEvidence(facts: Record<string, TopologyFact>, matches: string[]): string[] { return Object.entries(facts).filter(([key]) => matches.some((match) => key.includes(match))).map(([key, fact]) => `${key}=${fact.value} (${fact.provenance[0]?.collector ?? "unknown source"})`).sort(); }
function counterSummary(counters: Array<[string, number]>): string { const shown = counters.slice(0, 4).map(([key, value]) => `${key}=${value}`); return `${shown.join(", ")}${counters.length > shown.length ? `, +${counters.length - shown.length} more` : ""}`; }
function stringFact(node: TopologyNode | undefined, key: string): string | undefined { const value = node?.facts[key]?.value; return typeof value === "string" ? value : undefined; }
function identifier(node: TopologyNode): string | undefined { return stringFact(node, "pci_bdf") ?? stringFact(node, "linux.ifname") ?? stringFact(node, "linux.rdma_name"); }
function pciCommand(node: TopologyNode | undefined): string { const bdf = node && stringFact(node, "pci_bdf"); return bdf ? `lspci -D -s '${bdf}' -vv` : "lspci -D -vv"; }
function counterCommand(node: TopologyNode): string { const ifname = stringFact(node, "linux.ifname"); if (ifname) return `ethtool -S '${ifname}'`; if (node.kind === "network_port" || node.kind === "rdma_device") return "rdma -j statistic show"; return pciCommand(node); }
function devlinkCommand(node: TopologyNode): string { const bdf = stringFact(node, "pci_bdf"); return bdf ? `devlink health show pci/'${bdf}'` : "devlink health show"; }
function labelsForIds(nodes: ReadonlyMap<string, TopologyNode>, ids: Set<string>): string[] { return [...ids].map((id) => nodes.get(id)?.label ?? id).sort(); }
function shortCollector(value: string): string { return value.split(".").slice(-1)[0]; }
function compactMessage(value: string): string { const compact = value.replace(/\s+/g, " ").trim(); return compact.length <= 220 ? compact : `${compact.slice(0, 219)}…`; }
function sortFindings(findings: TroubleshootingFinding[]): TroubleshootingFinding[] { return [...findings].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "attention" ? -1 : 1) || a.id.localeCompare(b.id)); }
