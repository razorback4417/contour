export const RUNTIME_CAPTURE_SCHEMA_VERSION = "contour.runtime/v1" as const;

export type RuntimeObservationKind =
  | "process_started"
  | "process_stopped"
  | "container_started"
  | "container_stopped"
  | "file_descriptor_opened"
  | "file_descriptor_closed"
  | "file_changed"
  | "tcp_connection_created"
  | "tcp_connection_state_changed"
  | "tcp_connection_closed";

export type RuntimeEvidenceBasis = "observed" | "inferred";

export interface RuntimeSource {
  collector: string;
  product: string;
  productVersion?: string;
  schemaVersion?: string;
  messageId?: string;
  activityName: string;
  synthetic: boolean;
  rawRecord: string;
}

export interface RuntimeProcess {
  processId: number;
  selfExecId?: number;
  parentProcessId?: number;
  name: string;
  executablePath?: string;
  commandLine?: string;
  createdAt?: string;
  userId?: number;
  groupId?: number;
  containerId?: string;
  pidNamespace?: string;
  mountNamespace?: string;
  networkNamespace?: string;
}

export interface RuntimeContainer {
  containerId: string;
}

export interface RuntimeFileDescriptor {
  descriptorId: string;
  descriptorType?: string;
  path?: string;
  mode?: string;
  inode?: string;
  device?: string;
}

export interface RuntimeEndpoint {
  address: string;
  port: number;
}

export interface RuntimeTcpConnection {
  descriptorId?: string;
  state?: string;
  source: RuntimeEndpoint;
  destination: RuntimeEndpoint;
  interfaceName?: string;
  interfaceMac?: string;
  bytesIn?: number;
  bytesOut?: number;
  firstObservedAt?: string;
  closedAt?: string;
}

export interface RuntimeObservation {
  id: string;
  kind: RuntimeObservationKind;
  observedAt: string;
  basis: RuntimeEvidenceBasis;
  process?: RuntimeProcess;
  container?: RuntimeContainer;
  fileDescriptor?: RuntimeFileDescriptor;
  connection?: RuntimeTcpConnection;
  source: RuntimeSource;
}

export interface RuntimeHost {
  id: string;
  hostname?: string;
  bootId?: string;
  osVersion?: string;
  networkInterfaces?: RuntimeNetworkInterface[];
}

export interface RuntimeNetworkInterface {
  name: string;
  mac?: string;
  addresses: string[];
}

export interface RuntimeDiagnostic {
  id: string;
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  sourceMessageId?: string;
}

export interface RuntimeCapture {
  schemaVersion: typeof RUNTIME_CAPTURE_SCHEMA_VERSION;
  captureId: string;
  host: RuntimeHost;
  startedAt: string;
  endedAt: string;
  observations: RuntimeObservation[];
  diagnostics: RuntimeDiagnostic[];
}

export type RuntimeNodeKind =
  | "host"
  | "container"
  | "process_execution"
  | "file"
  | "tcp_connection"
  | "tcp_endpoint"
  | "network_interface";

export type RuntimeEdgeKind =
  | "contains"
  | "parent_of"
  | "member_of"
  | "opened"
  | "owns_connection"
  | "source_endpoint"
  | "destination_endpoint"
  | "uses_interface";

export interface RuntimeGraphNode {
  id: string;
  kind: RuntimeNodeKind;
  label: string;
  lifecycle: "active" | "terminated" | "observed";
  firstSeenAt: string;
  lastSeenAt: string;
  facts: Record<string, string | number | boolean>;
  evidence: string[];
}

export interface RuntimeGraphEdge {
  id: string;
  kind: RuntimeEdgeKind;
  source: string;
  target: string;
  basis: RuntimeEvidenceBasis;
  firstSeenAt: string;
  lastSeenAt: string;
  evidence: string[];
}

export interface RuntimeGraph {
  captureId: string;
  hostId: string;
  nodes: RuntimeGraphNode[];
  edges: RuntimeGraphEdge[];
  diagnostics: RuntimeDiagnostic[];
}
