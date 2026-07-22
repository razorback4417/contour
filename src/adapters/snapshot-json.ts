import { SCHEMA_VERSION, type TopologySnapshot } from "../model/types";
import { validateSnapshot } from "../validate/snapshot";

export class SnapshotParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotParseError";
  }
}

export function parseSnapshotJson(json: string): TopologySnapshot {
  let value: unknown;
  try { value = JSON.parse(json); }
  catch (error) { throw new SnapshotParseError(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  if (!isRecord(value)) throw new SnapshotParseError("Snapshot must be a JSON object.");
  const record = value.schemaVersion === "contour.topology/v1" ? migrateV1(value) : value;
  if (record.schemaVersion !== SCHEMA_VERSION) throw new SnapshotParseError(`Unsupported schemaVersion: ${String(record.schemaVersion)}`);
  if (typeof record.snapshotId !== "string" || typeof record.hostId !== "string" || typeof record.collectedAt !== "string") throw new SnapshotParseError("Snapshot identity fields are missing.");
  if (!Array.isArray(record.nodes) || !Array.isArray(record.edges) || !Array.isArray(record.collectors) || !Array.isArray(record.diagnostics)) throw new SnapshotParseError("Snapshot graph fields are missing.");
  const snapshot = record as unknown as TopologySnapshot;
  const structural = validateSnapshot(snapshot);
  if (structural.some((item) => item.severity === "error")) throw new SnapshotParseError(structural.map((item) => item.message).join(" "));
  return snapshot;
}

function migrateV1(value: Record<string, unknown>): Record<string, unknown> {
  const edges = Array.isArray(value.edges) ? value.edges.map((edge) => isRecord(edge) ? { ...edge, facts: {} } : edge) : value.edges;
  return { ...value, schemaVersion: SCHEMA_VERSION, edges };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
