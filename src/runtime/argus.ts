import { stableId } from "../model/stable";
import type {
  RuntimeCapture,
  RuntimeDiagnostic,
  RuntimeFileDescriptor,
  RuntimeObservation,
  RuntimeObservationKind,
  RuntimeProcess,
  RuntimeTcpConnection,
} from "./types";
import { RUNTIME_CAPTURE_SCHEMA_VERSION } from "./types";

export interface ArgusNormalizeOptions {
  synthetic: boolean;
  source?: string;
}

const activityKinds: Record<string, RuntimeObservationKind> = {
  "process created": "process_started",
  "process terminated": "process_stopped",
  "container started": "container_started",
  "container terminated": "container_stopped",
  "file descriptor open": "file_descriptor_opened",
  "file descriptor close": "file_descriptor_closed",
  "file descriptor file content change": "file_changed",
  "network connection created": "tcp_connection_created",
  "tcp network connection state change": "tcp_connection_state_changed",
  "tcp network connection status": "tcp_connection_state_changed",
  "network connection terminated": "tcp_connection_closed",
};

export function normalizeArgusJsonLines(
  input: string,
  options: ArgusNormalizeOptions,
): RuntimeCapture {
  const observations: RuntimeObservation[] = [];
  const diagnostics: RuntimeDiagnostic[] = [];
  let host: RuntimeCapture["host"] | undefined;

  input.split(/\r?\n/).forEach((rawRecord, index) => {
    if (!rawRecord.trim()) return;
    const source = options.source ?? `argus:record:${index + 1}`;
    let record: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawRecord);
      if (!isRecord(parsed)) throw new Error("record is not an object");
      record = unwrapHeader(parsed);
    } catch (error) {
      diagnostics.push(diagnostic(
        "argus.invalid_json",
        `Could not parse ${source}: ${error instanceof Error ? error.message : String(error)}`,
        rawRecord,
      ));
      return;
    }

    const workload = object(record.workload_information);
    const networkInterfaces = normalizeNetworkInterfaces(workload);
    host ??= {
      id: string(workload, "unique_identifier") ?? `argus-host:${stableId("unknown", options.source ?? "capture")}`,
      hostname: string(workload, "hostname"),
      bootId: string(workload, "boot_uuid"),
      osVersion: string(workload, "os_version"),
      networkInterfaces: networkInterfaces.length > 0 ? networkInterfaces : undefined,
    };

    const activity = object(record.activity_data);
    const activityName = string(activity, "name");
    const kind = activityName ? activityKinds[canonicalActivityName(activityName)] : undefined;
    const messageId = string(record, "message_id");
    if (!activityName || !kind) {
      diagnostics.push(diagnostic(
        "argus.unsupported_activity",
        `Unsupported Argus activity: ${activityName ?? "missing activity name"}`,
        rawRecord,
        messageId,
      ));
      return;
    }

    const observedAt = string(record, "occurred_message_time_iso_8601_ns");
    if (!observedAt) {
      diagnostics.push(diagnostic(
        "argus.missing_timestamp",
        `Argus activity ${activityName} has no observation timestamp.`,
        rawRecord,
        messageId,
      ));
      return;
    }
    if (observedAt.startsWith("1970-01-01")) {
      diagnostics.push(diagnostic(
        "argus.invalid_timestamp",
        `Argus activity ${activityName} uses the Unix epoch sentinel instead of an observation time.`,
        rawRecord,
        messageId,
      ));
      return;
    }

    const details = activityDetails(activity);
    const process = normalizeProcess(details);
    const fileDescriptor = normalizeFileDescriptor(details);
    const connection = normalizeConnection(details);
    const containerId = findString(details, "container_id") ?? process?.containerId;
    const sourceRecord = {
      collector: "argus",
      product: string(record, "product_name") ?? "DOCA_ARGUS",
      productVersion: string(record, "product_version"),
      schemaVersion: string(record, "schema_version"),
      messageId,
      activityName,
      synthetic: options.synthetic,
      rawRecord,
    };
    observations.push({
      id: messageId || stableId("observation", rawRecord),
      kind,
      observedAt,
      basis: "observed",
      process,
      container: containerId ? { containerId } : undefined,
      fileDescriptor,
      connection,
      source: sourceRecord,
    });
  });

  const times = observations.map((item) => item.observedAt).sort();
  const fallbackTime = "1970-01-01T00:00:00Z";
  return {
    schemaVersion: RUNTIME_CAPTURE_SCHEMA_VERSION,
    captureId: stableId("runtime-capture", input),
    host: host ?? { id: stableId("argus-host", options.source ?? input) },
    startedAt: times[0] ?? fallbackTime,
    endedAt: times.at(-1) ?? fallbackTime,
    observations,
    diagnostics,
  };
}

function unwrapHeader(record: Record<string, unknown>): Record<string, unknown> {
  const header = object(record.message_header);
  return Object.keys(header).length > 0 ? { ...record, ...header } : record;
}

function activityDetails(activity: Record<string, unknown>): Record<string, unknown> {
  const namedDetails = Object.entries(activity)
    .filter(([key, value]) => key !== "name" && key.endsWith("_details") && isRecord(value))
    .map(([, value]) => value as Record<string, unknown>);
  return namedDetails.length > 0 ? Object.assign({}, ...namedDetails) : activity;
}

function normalizeProcess(details: Record<string, unknown>): RuntimeProcess | undefined {
  const processId = findNumber(details, "process_id");
  const name = findString(details, "process_name");
  if (processId === undefined || !name) return undefined;
  return {
    processId,
    selfExecId: findNumber(details, "process_self_exec_id"),
    parentProcessId: findNumber(details, "process_parent_process_id"),
    name,
    executablePath: findString(details, "process_executable_path"),
    commandLine: findString(details, "process_command_line_arguments"),
    createdAt: findString(details, "process_creation_time_iso_8601_ns"),
    userId: findNumber(details, "process_real_user_id"),
    groupId: findNumber(details, "process_real_group_id"),
    containerId: findString(details, "process_container_id"),
    pidNamespace: findString(details, "process_pid_namespace"),
    mountNamespace: findString(details, "process_mount_points_namespace"),
    networkNamespace: findString(details, "process_network_namespace"),
  };
}

function normalizeFileDescriptor(details: Record<string, unknown>): RuntimeFileDescriptor | undefined {
  const descriptor = findStringOrNumber(details, "file_descriptor_id")
    ?? findStringOrNumber(details, "file_descriptor_index");
  if (descriptor === undefined) return undefined;
  return {
    descriptorId: String(descriptor),
    descriptorType: findString(details, "file_descriptor_file_type"),
    path: findString(details, "file_descriptor_name"),
    mode: findString(details, "file_descriptor_file_mode"),
    inode: optionalString(findStringOrNumber(details, "file_descriptor_inode_number")),
    device: optionalString(findStringOrNumber(details, "file_descriptor_inode_device_identifier")),
  };
}

function normalizeConnection(details: Record<string, unknown>): RuntimeTcpConnection | undefined {
  const sourceAddress = findString(details, "source_ip_address") ?? findString(details, "local_address");
  const destinationAddress = findString(details, "destination_ip_address") ?? findString(details, "peer_address");
  const sourcePort = findNumber(details, "source_port") ?? findNumber(details, "local_port");
  const destinationPort = findNumber(details, "destination_port") ?? findNumber(details, "peer_port");
  if (!sourceAddress || !destinationAddress || sourcePort === undefined || destinationPort === undefined) return undefined;
  return {
    descriptorId: optionalString(findStringOrNumber(details, "file_descriptor_id")),
    state: findString(details, "connection_state"),
    source: { address: sourceAddress, port: sourcePort },
    destination: { address: destinationAddress, port: destinationPort },
    interfaceName: findString(details, "workload_network_interface_name"),
    interfaceMac: findString(details, "workload_network_interface_mac_address"),
    bytesIn: findNumber(details, "tcp_bytes_in"),
    bytesOut: findNumber(details, "tcp_bytes_out"),
    firstObservedAt: findString(details, "tcp_connection_creation_time_iso_8601_ns"),
    closedAt: findString(details, "tcp_connection_termination_time_iso_8601_ns"),
  };
}

function normalizeNetworkInterfaces(
  workload: Record<string, unknown>,
): NonNullable<RuntimeCapture["host"]["networkInterfaces"]> {
  const value = workload.workload_networking_interfaces;
  const candidates = Array.isArray(value)
    ? value
    : isRecord(value)
      ? Object.values(value)
      : [];
  return candidates
    .filter(isRecord)
    .map((entry) => {
      const name = findString(entry, "workload_network_interface_name")
        ?? findString(entry, "network_interface_name");
      if (!name) return undefined;
      return {
        name,
        mac: findString(entry, "workload_network_interface_mac_address")
          ?? findString(entry, "network_interface_mac_address"),
        addresses: [
          ...stringValues(entry.workload_network_interface_ipv4_address
            ?? entry.network_interface_ipv4_address),
          ...stringValues(entry.workload_network_interface_ipv6_address
            ?? entry.network_interface_ipv6_address),
        ].sort(),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function canonicalActivityName(value: string): string {
  return value.toLowerCase().replace(/[_\s]+/g, " ").trim();
}

function stringValues(value: unknown): string[] {
  if (typeof value === "string") return value ? [value] : [];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function diagnostic(
  code: string,
  message: string,
  rawRecord: string,
  sourceMessageId?: string,
): RuntimeDiagnostic {
  return {
    id: stableId("runtime-diagnostic", `${code}\0${rawRecord}`),
    code,
    severity: "warning",
    message,
    sourceMessageId,
  };
}

function findString(record: Record<string, unknown>, field: string): string | undefined {
  return find(record, field, (value): value is string => typeof value === "string");
}

function findNumber(record: Record<string, unknown>, field: string): number | undefined {
  const value = find(record, field, (item): item is string | number =>
    typeof item === "string" || (typeof item === "number" && Number.isFinite(item)));
  if (value === undefined || (typeof value === "string" && value.trim() === "")) return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function findStringOrNumber(record: Record<string, unknown>, field: string): string | number | undefined {
  return find(record, field, (value): value is string | number =>
    typeof value === "string" || (typeof value === "number" && Number.isFinite(value)));
}

function find<T>(
  record: Record<string, unknown>,
  field: string,
  accepts: (value: unknown) => value is T,
): T | undefined {
  if (accepts(record[field])) return record[field];
  for (const value of Object.values(record)) {
    if (!isRecord(value)) continue;
    const nested = find(value, field, accepts);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function object(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function string(record: Record<string, unknown>, field: string): string | undefined {
  return typeof record[field] === "string" ? record[field] : undefined;
}

function optionalString(value: string | number | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
