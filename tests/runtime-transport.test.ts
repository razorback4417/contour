import { describe, expect, it } from "vitest";
import { normalizeArgusJsonLines } from "../src/runtime/argus";
import { parseRuntimeCaptureJson } from "../src/runtime/capture-json";
import { runtimeBrowserCapture } from "../src/runtime/transport";

describe("runtime browser transport", () => {
  it("omits raw records without changing normalized evidence", () => {
    const capture = normalizeArgusJsonLines(JSON.stringify({
      message_id: "one",
      occurred_message_time_iso_8601_ns: "2026-07-27T18:00:00Z",
      workload_information: { unique_identifier: "host" },
      activity_data: {
        name: "process_created",
        process_details: {
          process_id: "42",
          process_name: "worker",
          process_creation_time_iso_8601_ns: "2026-07-27T18:00:00Z",
        },
      },
      future_field: "kept at ingestion",
    }), { synthetic: false });

    expect(capture.observations[0].source.rawRecord).toContain("future_field");
    const browser = runtimeBrowserCapture(capture);
    const serialized = JSON.stringify(browser);

    expect(serialized).not.toContain("future_field");
    expect(browser.observations[0].id).toBe(capture.observations[0].id);
    expect(parseRuntimeCaptureJson(serialized).observations[0].source.rawRecord).toBeUndefined();
  });
});
