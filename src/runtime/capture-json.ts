import {
  RUNTIME_CAPTURE_SCHEMA_VERSION,
  type RuntimeCapture,
  type RuntimeObservation,
  type RuntimeObservationKind,
} from "./types";

const observationKinds = new Set<RuntimeObservationKind>([
  "process_started",
  "process_stopped",
  "container_started",
  "container_stopped",
  "file_descriptor_opened",
  "file_descriptor_closed",
  "file_changed",
  "tcp_connection_created",
  "tcp_connection_state_changed",
  "tcp_connection_closed",
]);

export class RuntimeCaptureParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeCaptureParseError";
  }
}

export function parseRuntimeCaptureJson(json: string): RuntimeCapture {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new RuntimeCaptureParseError(
      `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(value)) throw new RuntimeCaptureParseError("Runtime capture must be a JSON object.");
  if (value.schemaVersion !== RUNTIME_CAPTURE_SCHEMA_VERSION) {
    throw new RuntimeCaptureParseError(`Unsupported schemaVersion: ${String(value.schemaVersion)}`);
  }
  requireString(value, "captureId", "Runtime capture");
  requireString(value, "startedAt", "Runtime capture");
  requireString(value, "endedAt", "Runtime capture");
  validateHost(value.host);
  if (!Array.isArray(value.observations)) {
    throw new RuntimeCaptureParseError("Runtime capture observations must be an array.");
  }
  value.observations.forEach(validateObservation);
  if (!Array.isArray(value.diagnostics)) {
    throw new RuntimeCaptureParseError("Runtime capture diagnostics must be an array.");
  }
  return value as unknown as RuntimeCapture;
}

function validateHost(value: unknown): void {
  if (!isRecord(value)) throw new RuntimeCaptureParseError("Runtime capture host is missing.");
  requireString(value, "id", "Runtime host");
  for (const field of ["hostname", "bootId", "osVersion"]) requireOptionalString(value, field, "Runtime host");
}

function validateObservation(value: unknown, index: number): asserts value is RuntimeObservation {
  const owner = `Runtime observation ${index}`;
  if (!isRecord(value)) throw new RuntimeCaptureParseError(`${owner} must be an object.`);
  requireString(value, "id", owner);
  requireString(value, "observedAt", owner);
  if (!observationKinds.has(value.kind as RuntimeObservationKind)) {
    throw new RuntimeCaptureParseError(`${owner} has unsupported kind: ${String(value.kind)}`);
  }
  if (value.basis !== "observed" && value.basis !== "inferred") {
    throw new RuntimeCaptureParseError(`${owner} has unsupported evidence basis: ${String(value.basis)}`);
  }
  if (!isRecord(value.source)) throw new RuntimeCaptureParseError(`${owner} source is missing.`);
  for (const field of ["collector", "product", "activityName"]) {
    requireString(value.source, field, `${owner} source`);
  }
  requireOptionalString(value.source, "rawRecord", `${owner} source`);
  if (typeof value.source.synthetic !== "boolean") {
    throw new RuntimeCaptureParseError(`${owner} source synthetic flag must be boolean.`);
  }
}

function requireString(value: Record<string, unknown>, field: string, owner: string): void {
  if (typeof value[field] !== "string" || value[field].length === 0) {
    throw new RuntimeCaptureParseError(`${owner} ${field} must be a non-empty string.`);
  }
}

function requireOptionalString(value: Record<string, unknown>, field: string, owner: string): void {
  if (value[field] !== undefined && typeof value[field] !== "string") {
    throw new RuntimeCaptureParseError(`${owner} ${field} must be a string when present.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
