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

  for (const port of raw.devlinkPorts) {
    if (!port.netdev) continue;
    const node = interfaceByName.get(port.netdev);
    if (!node) continue;
    node.facts["devlink.port.name"] = fact(port.name, "linux.devlink_port", "port key");
    if (port.flavour) node.facts["devlink.port.flavour"] = fact(port.flavour, "linux.devlink_port", "flavour");
    if (port.port !== undefined) node.facts["devlink.port.index"] = fact(port.port, "linux.devlink_port", "port");
    if (port.type) node.facts["devlink.port.type"] = fact(port.type, "linux.devlink_port", "type");
    if (port.splittable !== undefined) node.facts["devlink.port.splittable"] = fact(port.splittable, "linux.devlink_port", "splittable");
    node.facts = sortRecord(node.facts);
  }

  const rdmaByName = new Map<string, TopologyNode>();
  const infinibandByName = new Map(raw.infiniband.map((item) => [item.device, item]));
  const rawDeviceByName = new Map(raw.rdmaDevices.map((item) => [item.device, item]));
  const ensureRdmaDevice = (name: string, networkInterface?: TopologyNode): TopologyNode => {
    const sysfs = infinibandByName.get(name);
    const sysfsBacking = sysfs?.pciBdf ? snapshot.nodes.find((node) => node.facts.pci_bdf?.value === sysfs.pciBdf) : undefined;
    const networkBackingEdge = networkInterface ? snapshot.edges.find((edge) => edge.kind === "backed_by" && edge.source === networkInterface.id) : undefined;
    const backing = sysfsBacking ?? (networkBackingEdge ? nodeById.get(networkBackingEdge.target) : undefined);
    const parentId = backing?.id ?? host.id;
    let device = rdmaByName.get(name) ?? snapshot.nodes.find((node) => node.kind === "rdma_device" && node.facts["linux.rdma_name"]?.value === name);
    if (!device) {
      device = { id: stableId("rdma_device", `${parentId}:${name}`), kind: "rdma_device", label: name, parentId, facts: {} };
      snapshot.nodes.push(device); nodeById.set(device.id, device); addEdge(snapshot, "contains", parentId, device.id, provenance("linux.rdma_device", "RDMA device", name));
    }
    rdmaByName.set(name, device);
    device.facts["linux.rdma_name"] = fact(name, "linux.rdma_device", "ifname");
    const rawDevice = rawDeviceByName.get(name);
    if (rawDevice?.ifindex !== undefined) device.facts["linux.rdma_ifindex"] = fact(rawDevice.ifindex, "linux.rdma_device", "ifindex");
    if (rawDevice?.nodeType) device.facts["rdma.node_type"] = fact(rawDevice.nodeType, "linux.rdma_device", "node_type");
    if (rawDevice?.firmware) device.facts["rdma.firmware"] = fact(rawDevice.firmware, "linux.rdma_device", "fw");
    if (sysfs?.devicePath) device.facts["sysfs_device_path"] = fact(sysfs.devicePath, "linux.infiniband_sysfs", `/sys/class/infiniband/${name}/device`);
    if (backing) addEdge(snapshot, "backed_by", device.id, backing.id, provenance(sysfsBacking ? "linux.infiniband_sysfs" : "linux.rdma_link", sysfsBacking ? "resolved device path" : "netdev correlation", sysfs?.devicePath ?? networkInterface?.label ?? name));
    device.facts = sortRecord(device.facts);
    return device;
  };
  for (const item of raw.rdmaDevices) { const link = raw.rdmaLinks.find((candidate) => candidate.device === item.device && candidate.netdev); ensureRdmaDevice(item.device, link?.netdev ? interfaceByName.get(link.netdev) : undefined); }
  for (const link of raw.rdmaLinks) {
    const networkInterface = link.netdev ? interfaceByName.get(link.netdev) : undefined;
    const device = ensureRdmaDevice(link.device, networkInterface);
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
function provenance(collector: string, field: string, value: FactValue): ProvenanceRecord[] { return [{ collector, source: collector.includes("sysfs") ? "/sys/class" : `command:${collector}`, sourceField: field, rawValue: value, normalizedValue: value, method: "observed" }]; }
function addEdge(snapshot: TopologySnapshot, kind: EdgeKind, source: string, target: string, records: ProvenanceRecord[]) { const id = stableId("edge", `${kind}:${source}:${target}`); if (!snapshot.edges.some((edge) => edge.id === id)) snapshot.edges.push({ id, kind, source, target, facts: {}, provenance: records } as TopologyEdge); }
function sortRecord<T>(record: Record<string, T>): Record<string, T> { return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b))); }
