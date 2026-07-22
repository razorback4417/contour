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
  if (value.schemaVersion !== SCHEMA_VERSION) throw new SnapshotParseError(`Unsupported schemaVersion: ${String(value.schemaVersion)}`);
  if (typeof value.snapshotId !== "string" || typeof value.hostId !== "string" || typeof value.collectedAt !== "string") throw new SnapshotParseError("Snapshot identity fields are missing.");
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges) || !Array.isArray(value.collectors) || !Array.isArray(value.diagnostics)) throw new SnapshotParseError("Snapshot graph fields are missing.");
  const snapshot = value as unknown as TopologySnapshot;
  const structural = validateSnapshot(snapshot);
  if (structural.some((item) => item.severity === "error")) throw new SnapshotParseError(structural.map((item) => item.message).join(" "));
  return snapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
