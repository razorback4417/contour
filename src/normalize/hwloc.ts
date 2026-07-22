import type { RawHwlocObject, RawHwlocTopology } from "../adapters/hwloc";
import { SCHEMA_VERSION, type Diagnostic, type EdgeKind, type NodeKind, type ProvenanceRecord, type TopologyEdge, type TopologyFact, type TopologyNode, type TopologySnapshot } from "../model/types";
import { stableHash, stableId, stableStringify } from "../model/stable";
import { validateSnapshot } from "../validate/snapshot";

export interface NormalizeOptions {
  collectedAt?: string;
  hostName?: string;
  collectorStatus?: "success" | "partial";
}

const KIND_RANK: Record<NodeKind, number> = {
  host: 0, numa_node: 1, cpu_package: 2, memory_region: 3, cache: 4, cpu_core: 5,
  pci_domain: 6, pci_bus: 7, pci_bridge: 8, pci_endpoint: 9, gpu: 10, nic: 11,
  rdma_device: 12, network_port: 13, network_interface: 14, storage_device: 15
};

export function normalizeHwloc(raw: RawHwlocTopology, options: NormalizeOptions = {}): TopologySnapshot {
  const collectedAt = options.collectedAt ?? "1970-01-01T00:00:00.000Z";
  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];
  const diagnostics: Diagnostic[] = [];
  const source = raw.source;

  function visit(object: RawHwlocObject, canonicalParent: TopologyNode | undefined, identityParent: string, numaAncestor?: TopologyNode): void {
    const classifiedKind = classify(object);
    const kind = isOsDevice(object) && canonicalParent?.kind === classifiedKind ? undefined : classifiedKind;
    const identityKey = rawIdentity(object);
    const identityPath = `${identityParent}/${object.type}:${identityKey}`;
    let node = canonicalParent;
    let nextNuma = numaAncestor;

    if (kind) {
      const id = stableId(kind, identityPath);
      node = {
        id,
        kind,
        label: labelFor(object, kind),
        ...(canonicalParent ? { parentId: canonicalParent.id } : {}),
        facts: factsFor(object, source)
      };
      if (kind === "host") {
        const name = options.hostName ?? infoValue(object, "HostName");
        node.label = name || "Linux host";
        node.facts.hostname = name
          ? observedFact(name, source, "info.HostName")
          : unknownFact(source, "info.HostName");
      }
      nodes.push(node);
      if (canonicalParent) edges.push(edge("contains", canonicalParent.id, node.id, observedProvenance(source, "object nesting", object.type)));
      if (kind === "numa_node") nextNuma = node;

      if (isOsDevice(object) && canonicalParent && ["pci_endpoint", "gpu", "nic", "storage_device"].includes(canonicalParent.kind)) {
        edges.push(edge("backed_by", node.id, canonicalParent.id, observedProvenance(source, "object nesting", object.type)));
      }
      if (nextNuma && isLocalityDevice(kind) && nextNuma.id !== node.id) {
        edges.push(edge("local_to", node.id, nextNuma.id, derivedProvenance(source, "numa-ancestor-v1", identityPath)));
      }

      if (kind === "numa_node" && object.attributes.local_memory) {
        const memoryId = stableId("memory_region", `${identityPath}/memory`);
        const memory: TopologyNode = {
          id: memoryId,
          kind: "memory_region",
          label: formatBytes(object.attributes.local_memory),
          parentId: node.id,
          facts: { capacity_bytes: observedNumberFact(object.attributes.local_memory, source, "local_memory") }
        };
        nodes.push(memory);
        edges.push(edge("contains", node.id, memoryId, derivedProvenance(source, "numa-memory-region-v1", object.attributes.local_memory)));
      }
    }

    const children = [...object.children].sort((a, b) => rawSortKey(a).localeCompare(rawSortKey(b)));
    for (const child of children) visit(child, node, identityPath, nextNuma);
  }

  visit(raw.root, undefined, "hwloc", undefined);
  if (!nodes.some((node) => node.kind === "host")) {
    const id = stableId("host", "hwloc/synthetic-host");
    const host: TopologyNode = { id, kind: "host", label: options.hostName ?? "Linux host", facts: { hostname: unknownFact(source, "info.HostName") } };
    nodes.unshift(host);
    diagnostics.push(diagnostic("HWLOC_ROOT_NOT_MACHINE", "warning", "The hwloc root was not a Machine; a host container was synthesized.", source));
    for (const root of nodes.filter((node) => !node.parentId && node.id !== id)) {
      root.parentId = id;
      edges.push(edge("contains", id, root.id, derivedProvenance(source, "synthetic-host-v1", root.id)));
    }
  }

  const host = nodes.find((node) => node.kind === "host")!;
  if (!nodes.some((node) => node.kind === "numa_node")) {
    diagnostics.push(diagnostic("NUMA_UNAVAILABLE", "warning", "No NUMA node was present in the lstopo input; locality is unknown.", source));
    host.facts.numa_topology = unknownFact(source, "object[type=NUMANode]");
  }

  nodes.sort((a, b) => (KIND_RANK[a.kind] - KIND_RANK[b.kind]) || a.id.localeCompare(b.id));
  edges.sort((a, b) => `${a.kind}\0${a.source}\0${a.target}`.localeCompare(`${b.kind}\0${b.source}\0${b.target}`));
  const collector = {
    collector: "hwloc.lstopo_xml",
    status: options.collectorStatus ?? "success" as const,
    startedAt: collectedAt,
    completedAt: collectedAt,
    source
  };
  const contentIdentity = stableStringify({ nodes, edges, collector: { ...collector, startedAt: undefined, completedAt: undefined } }, 0);
  const snapshot: TopologySnapshot = {
    schemaVersion: SCHEMA_VERSION,
    snapshotId: `snapshot:${stableHash(contentIdentity)}`,
    hostId: host.id,
    collectedAt,
    nodes,
    edges,
    collectors: [collector],
    diagnostics
  };
  snapshot.diagnostics.push(...validateSnapshot(snapshot));
  snapshot.diagnostics.sort((a, b) => a.id.localeCompare(b.id));
  return snapshot;
}

function classify(object: RawHwlocObject): NodeKind | undefined {
  switch (object.type) {
    case "Machine": return "host";
    case "Package": return "cpu_package";
    case "Core": return "cpu_core";
    case "NUMANode": return "numa_node";
    case "L1Cache": case "L2Cache": case "L3Cache": case "L4Cache": case "L5Cache": case "Cache": return "cache";
    case "PCIBridge": case "Bridge": return "pci_bridge";
    case "PCIDev": {
      const subtypes = object.children.filter(isOsDevice).map((child) => `${child.attributes.subtype ?? ""} ${child.attributes.name ?? ""}`.toLowerCase()).join(" ");
      if (/gpu|cuda|opencl|display/.test(subtypes)) return "gpu";
      if (/network|openfabrics/.test(subtypes)) return "nic";
      if (/block.*nvme|nvme/.test(subtypes)) return "storage_device";
      return "pci_endpoint";
    }
    case "OSDev": {
      const subtype = `${object.attributes.subtype ?? ""} ${object.attributes.name ?? ""}`.toLowerCase();
      if (subtype.includes("openfabrics")) return "rdma_device";
      if (subtype.includes("network")) return "network_interface";
      if (/gpu|cuda|opencl/.test(subtype)) return "gpu";
      if (/block|nvme/.test(subtype)) return "storage_device";
      return undefined;
    }
    default: return undefined;
  }
}

function factsFor(object: RawHwlocObject, source: string): Record<string, TopologyFact> {
  const facts: Record<string, TopologyFact> = {
    source_type: observedFact(object.type, source, "type")
  };
  for (const [key, value] of Object.entries(object.attributes)) {
    const factKey = canonicalFactKey(key);
    facts[factKey] = numericFields.has(key)
      ? observedNumberFact(value, source, key)
      : observedFact(normalizeAttribute(key, value), source, key, value);
  }
  for (const info of object.infos) {
    const key = `hwloc.info.${slug(info.name)}`;
    facts[key] = observedFact(info.value, source, `info.${info.name}`);
  }
  return Object.fromEntries(Object.entries(facts).sort(([a], [b]) => a.localeCompare(b)));
}

const numericFields = new Set(["os_index", "gp_index", "cache_size", "local_memory", "depth", "bridge_depth", "linkspeed", "pci_link_speed"]);

function canonicalFactKey(key: string): string {
  const keys: Record<string, string> = { os_index: "logical_index", busid: "pci_bdf", pci_busid: "pci_bdf", bridge_pci: "pci_bus_range", local_memory: "memory_bytes", cache_size: "capacity_bytes", depth: "cache_level", linkspeed: "link_speed_gt_s", pci_link_speed: "link_speed_gt_s" };
  return keys[key] ?? `hwloc.${key}`;
}

function normalizeAttribute(key: string, value: string): string {
  return key === "busid" || key === "pci_busid" ? value.toLowerCase() : value;
}

function rawIdentity(object: RawHwlocObject): string {
  const key = (object.type === "Machine" ? infoValue(object, "HostName") : undefined)
    ?? object.attributes.pci_busid ?? object.attributes.busid ?? object.attributes.bridge_pci
    ?? object.attributes.os_index ?? object.attributes.gp_index ?? object.attributes.name ?? object.attributes.depth;
  if (key !== undefined) return String(key).toLowerCase();
  const stableAttrs = Object.entries(object.attributes).map(([name, value]) => `${name}=${value}`).join(",");
  return stableAttrs || object.type;
}

function rawSortKey(object: RawHwlocObject): string {
  return `${object.type}\0${rawIdentity(object)}`;
}

function labelFor(object: RawHwlocObject, kind: NodeKind): string {
  const index = object.attributes.os_index;
  const name = object.attributes.name;
  const bdf = (object.attributes.pci_busid ?? object.attributes.busid)?.toLowerCase();
  const labels: Partial<Record<NodeKind, string>> = {
    cpu_package: `CPU package ${index ?? "?"}`,
    cpu_core: `Core ${index ?? "?"}`,
    numa_node: `NUMA ${index ?? "?"}`,
    cache: `${object.type.replace("Cache", " cache")}${object.attributes.cache_size ? ` · ${formatBytes(object.attributes.cache_size)}` : ""}`,
    pci_bridge: `PCI bridge${bdf ? ` · ${bdf}` : ""}`,
    pci_endpoint: `${name || infoValue(object, "PCIDevice") || "PCI endpoint"}${bdf ? ` · ${bdf}` : ""}`,
    gpu: `${name || "GPU"}${bdf ? ` · ${bdf}` : ""}`,
    nic: `${name || "NIC"}${bdf ? ` · ${bdf}` : ""}`,
    rdma_device: name || "RDMA device",
    network_interface: name || "Network interface",
    storage_device: `${name || "Storage"}${bdf ? ` · ${bdf}` : ""}`
  };
  return labels[kind] ?? kind.replaceAll("_", " ");
}

function observedFact(value: string | number | boolean, source: string, field: string, raw: string | number | boolean = value): TopologyFact {
  return { value, state: "observed", provenance: observedProvenance(source, field, raw, value) };
}

function observedNumberFact(raw: string, source: string, field: string): TopologyFact {
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? observedFact(numeric, source, field, raw) : observedFact(raw, source, field, raw);
}

function unknownFact(source: string, field: string): TopologyFact {
  return { value: null, state: "unknown", provenance: [{ collector: "hwloc.lstopo_xml", source, sourceField: field, rawValue: null, normalizedValue: null, method: "observed" }] };
}

function edge(kind: EdgeKind, source: string, target: string, provenance: ProvenanceRecord[]): TopologyEdge {
  return { id: stableId("edge", `${kind}:${source}:${target}`), kind, source, target, facts: {}, provenance };
}

function observedProvenance(source: string, field: string, raw: string | number | boolean, normalized: string | number | boolean = raw): ProvenanceRecord[] {
  return [{ collector: "hwloc.lstopo_xml", source, sourceField: field, rawValue: raw, normalizedValue: normalized, method: "observed" }];
}

function derivedProvenance(source: string, rule: string, raw: string): ProvenanceRecord[] {
  return [{ collector: "contour.normalizer", source, sourceField: "canonical relationship", rawValue: raw, normalizedValue: raw, method: "derived", derivationRule: rule }];
}

function diagnostic(code: string, severity: Diagnostic["severity"], message: string, source: string): Diagnostic {
  return { id: stableId("diagnostic", `${code}:${source}:${message}`), code, severity, message, source };
}

function isOsDevice(object: RawHwlocObject): boolean { return object.type === "OSDev"; }
function isLocalityDevice(kind: NodeKind): boolean { return ["pci_endpoint", "gpu", "nic", "rdma_device", "network_interface", "storage_device"].includes(kind); }
function infoValue(object: RawHwlocObject, name: string): string | undefined { return object.infos.find((info) => info.name === name)?.value; }
function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""); }
function formatBytes(value: string): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return value;
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let scaled = bytes;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) { scaled /= 1024; unit += 1; }
  return `${Number.isInteger(scaled) ? scaled : scaled.toFixed(1)} ${units[unit]}`;
}
