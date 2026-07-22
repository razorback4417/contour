export const SCHEMA_VERSION = "contour.topology/v2" as const;

export type NodeKind =
  | "host" | "numa_node" | "cpu_package" | "cpu_core" | "cache"
  | "memory_region" | "pci_domain" | "pci_bus" | "pci_bridge"
  | "pci_endpoint" | "gpu" | "nic" | "rdma_device" | "network_port"
  | "network_interface" | "storage_device";

export type EdgeKind =
  | "contains" | "attached_to" | "local_to" | "exposes" | "backed_by"
  | "connected_to" | "shares_bridge_with" | "derived_from";

export type FactValue = string | number | boolean | null;
export type FactState = "observed" | "derived" | "unknown";

export interface ProvenanceRecord {
  collector: string;
  source: string;
  sourceField: string;
  rawValue: FactValue;
  normalizedValue: FactValue;
  method: "observed" | "derived";
  derivationRule?: string;
}

export interface TopologyFact {
  value: FactValue;
  state: FactState;
  provenance: ProvenanceRecord[];
}

export interface TopologyNode {
  id: string;
  kind: NodeKind;
  label: string;
  parentId?: string;
  facts: Record<string, TopologyFact>;
}

export interface TopologyEdge {
  id: string;
  kind: EdgeKind;
  source: string;
  target: string;
  facts: Record<string, TopologyFact>;
  provenance: ProvenanceRecord[];
}

export type CollectorStatus = "success" | "partial" | "unavailable" | "failed";

export interface CollectorResult {
  collector: string;
  status: CollectorStatus;
  startedAt: string;
  completedAt: string;
  source: string;
  message?: string;
}

export interface Diagnostic {
  id: string;
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  nodeId?: string;
  source?: string;
}

export interface TopologySnapshot {
  schemaVersion: typeof SCHEMA_VERSION;
  snapshotId: string;
  hostId: string;
  collectedAt: string;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  collectors: CollectorResult[];
  diagnostics: Diagnostic[];
}
