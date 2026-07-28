import { normalizeArgusRecords, type ArgusNormalizeOptions } from "./argus";
import {
  readArgusBatchFromClickHouse,
  type ClickHouseArgusBatch,
  type ClickHouseArgusOptions,
  type ClickHouseArgusPosition,
} from "./clickhouse";
import type { RuntimeCapture } from "./types";

export type RuntimeBatchReader = (
  options: ClickHouseArgusOptions,
  position?: ClickHouseArgusPosition,
) => Promise<ClickHouseArgusBatch>;

export interface RuntimeCaptureBatch {
  capture: RuntimeCapture;
  earlierCursor?: string;
  hasEarlier: boolean;
}

export function createClickHouseRuntimeLoader(
  clickhouse: ClickHouseArgusOptions,
  normalize: ArgusNormalizeOptions,
  readBatch: RuntimeBatchReader = readArgusBatchFromClickHouse,
): (position?: ClickHouseArgusPosition) => Promise<RuntimeCaptureBatch> {
  return async (position) => {
    const batch = await readBatch(clickhouse, position);
    return {
      capture: normalizeArgusRecords(batch.records.map((record) => ({
        rawRecord: record.body,
        receivedAt: record.receivedAt,
      })), normalize),
      earlierCursor: batch.earlierCursor,
      hasEarlier: batch.hasEarlier,
    };
  };
}
