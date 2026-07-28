import { describe, expect, it, vi } from "vitest";
import { createClickHouseRuntimeLoader } from "../src/runtime/live";

describe("live runtime capture loader", () => {
  it("re-reads raw records for every capture without interpreting storage fields", async () => {
    const readRecords = vi.fn()
      .mockResolvedValueOnce({
        records: record("first", "2026-07-27T18:00:00Z"),
        earlierCursor: "first-page",
        hasEarlier: true,
      })
      .mockResolvedValueOnce({
        records: record("second", "2026-07-27T18:00:01Z"),
        hasEarlier: false,
      });
    const load = createClickHouseRuntimeLoader({
      endpoint: "http://clickhouse.test",
      database: "otel",
      limit: 500,
    }, {
      synthetic: false,
      source: "clickhouse:otel.otel_logs",
    }, readRecords);

    const first = await load();
    const second = await load();

    expect(readRecords).toHaveBeenCalledTimes(2);
    expect(first.capture.observations[0].id).toBe("first");
    expect(first.earlierCursor).toBe("first-page");
    expect(second.capture.observations[0].id).toBe("second");
    expect(second.capture.observations[0].source.activityName).toBe("process_created");
  });
});

function record(id: string, observedAt: string): string {
  return JSON.stringify({
    message_id: id,
    occurred_message_time_iso_8601_ns: observedAt,
    workload_information: { unique_identifier: "host" },
    activity_data: {
      name: "process_created",
      process_details: {
        process_id: "42",
        process_name: "worker",
        process_creation_time_iso_8601_ns: observedAt,
      },
    },
  });
}
