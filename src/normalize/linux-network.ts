import type { LinuxNetworkObservations } from "../collectors/linux-network";
import { stableHash, stableId, stableStringify } from "../model/stable";
import type { EdgeKind, FactValue, ProvenanceRecord, TopologyEdge, TopologyFact, TopologyNode, TopologySnapshot } from "../model/types";

export function enrichLinuxNetwork(input: TopologySnapshot, raw: LinuxNetworkObservations): TopologySnapshot {
  const snapshot = structuredClone(input);
  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const sysfsByName = new Map(raw.sysfs.map((item) => [item.ifname, item]));
  const interfaceByName = new Map<string, TopologyNode>();
  const host = nodeById.get(snapshot.hostId)!;

  for (const item of raw.interfaces) {
    const sysfs = sysfsByName.get(item.ifname);
    const backing = sysfs?.pciBdf ? snapshot.nodes.find((node) => node.facts.pci_bdf?.value === sysfs.pciBdf) : undefined;
    let node = snapshot.nodes.find((candidate) => candidate.kind === "network_interface" && (candidate.facts["linux.ifname"]?.value === item.ifname || candidate.facts["hwloc.name"]?.value === item.ifname));
    if (!node) {
      const material = backing ? `${backing.id}:${item.physicalPortName ?? item.ifname}` : `${snapshot.hostId}:${item.ifname}`;
      node = { id: stableId("network_interface", material), kind: "network_interface", label: item.ifname, parentId: backing?.id ?? host.id, facts: {} };
      snapshot.nodes.push(node); nodeById.set(node.id, node);
      addEdge(snapshot, "contains", node.parentId!, node.id, provenance("linux.ip_link", "ip link object", item.ifname));
    }
    node.facts["linux.ifname"] = fact(item.ifname, "linux.ip_link", "ifname");
    node.facts["linux.ifindex"] = fact(item.ifindex, "linux.ip_link", "ifindex");
    if (item.operstate) node.facts.operstate = fact(item.operstate, "linux.ip_link", "operstate");
    if (item.linkType) node.facts.link_type = fact(item.linkType, "linux.ip_link", "link_type");
    if (item.mtu !== undefined) node.facts.mtu_bytes = fact(item.mtu, "linux.ip_link", "mtu");
    if (item.rxQueues !== undefined) node.facts.rx_queues = fact(item.rxQueues, "linux.ip_link", "num_rx_queues");
    if (item.txQueues !== undefined) node.facts.tx_queues = fact(item.txQueues, "linux.ip_link", "num_tx_queues");
    if (sysfs?.devicePath) node.facts.sysfs_device_path = fact(sysfs.devicePath, "linux.sysfs_net", `/sys/class/net/${item.ifname}/device`);
    if (backing) addEdge(snapshot, "backed_by", node.id, backing.id, provenance("linux.sysfs_net", "resolved device path", sysfs!.devicePath ?? sysfs!.pciBdf!));
    if (sysfs?.numaNode !== undefined) {
      const numa = snapshot.nodes.find((candidate) => candidate.kind === "numa_node" && candidate.facts.logical_index?.value === sysfs.numaNode);
      if (numa) addEdge(snapshot, "local_to", node.id, numa.id, provenance("linux.sysfs_net", "device/numa_node", sysfs.numaNode));
    }
    node.facts = sortRecord(node.facts);
    interfaceByName.set(item.ifname, node);
  }

  const rdmaByName = new Map<string, TopologyNode>();
  for (const link of raw.rdmaLinks) {
    const networkInterface = link.netdev ? interfaceByName.get(link.netdev) : undefined;
    const backingEdge = networkInterface ? snapshot.edges.find((edge) => edge.kind === "backed_by" && edge.source === networkInterface.id) : undefined;
    const parentId = backingEdge?.target ?? host.id;
    let device = rdmaByName.get(link.device) ?? snapshot.nodes.find((node) => node.kind === "rdma_device" && node.facts["linux.rdma_name"]?.value === link.device);
    if (!device) {
      device = { id: stableId("rdma_device", `${parentId}:${link.device}`), kind: "rdma_device", label: link.device, parentId, facts: { "linux.rdma_name": fact(link.device, "linux.rdma_link", "ifname") } };
      snapshot.nodes.push(device); nodeById.set(device.id, device); rdmaByName.set(link.device, device);
      addEdge(snapshot, "contains", parentId, device.id, provenance("linux.rdma_link", "RDMA device", link.device));
      if (backingEdge) addEdge(snapshot, "backed_by", device.id, backingEdge.target, provenance("linux.rdma_link", "netdev correlation", link.netdev!));
    }
    const port: TopologyNode = { id: stableId("network_port", `${device.id}:${link.port}`), kind: "network_port", label: `${link.device} port ${link.port}`, parentId: device.id, facts: { port: fact(link.port, "linux.rdma_link", "port"), ...(link.state ? { state: fact(link.state, "linux.rdma_link", "state") } : {}), ...(link.physicalState ? { physical_state: fact(link.physicalState, "linux.rdma_link", "physical_state") } : {}) } };
    if (!nodeById.has(port.id)) { snapshot.nodes.push(port); nodeById.set(port.id, port); addEdge(snapshot, "exposes", device.id, port.id, provenance("linux.rdma_link", "RDMA port", link.port)); }
    if (networkInterface) addEdge(snapshot, "connected_to", port.id, networkInterface.id, provenance("linux.rdma_link", "netdev", link.netdev!));
  }

  snapshot.collectors.push(...raw.collectors);
  snapshot.collectors.sort((a, b) => a.collector.localeCompare(b.collector));
  snapshot.nodes.sort((a, b) => `${a.kind}\0${a.id}`.localeCompare(`${b.kind}\0${b.id}`));
  snapshot.edges.sort((a, b) => `${a.kind}\0${a.source}\0${a.target}`.localeCompare(`${b.kind}\0${b.source}\0${b.target}`));
  const identity = stableStringify({ nodes: snapshot.nodes, edges: snapshot.edges, collectors: snapshot.collectors.map(({ startedAt: _s, completedAt: _c, ...collector }) => collector) }, 0);
  snapshot.snapshotId = `snapshot:${stableHash(identity)}`;
  return snapshot;
}

function fact(value: FactValue, collector: string, field: string): TopologyFact { return { value, state: "observed", provenance: provenance(collector, field, value) }; }
function provenance(collector: string, field: string, value: FactValue): ProvenanceRecord[] { return [{ collector, source: collector.startsWith("linux.sysfs") ? "/sys/class" : `command:${collector}`, sourceField: field, rawValue: value, normalizedValue: value, method: "observed" }]; }
function addEdge(snapshot: TopologySnapshot, kind: EdgeKind, source: string, target: string, records: ProvenanceRecord[]) { const id = stableId("edge", `${kind}:${source}:${target}`); if (!snapshot.edges.some((edge) => edge.id === id)) snapshot.edges.push({ id, kind, source, target, provenance: records } as TopologyEdge); }
function sortRecord<T>(record: Record<string, T>): Record<string, T> { return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b))); }
