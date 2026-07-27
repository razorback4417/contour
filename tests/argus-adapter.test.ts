import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeArgusJsonLines } from "../src/runtime/argus";

const fixture = readFileSync(
  new URL("../fixtures/argus/process-network-sequence.jsonl", import.meta.url),
  "utf8",
);

describe("Argus runtime adapter", () => {
  it("normalizes the documented synthetic process, file, and TCP sequence", () => {
    const capture = normalizeArgusJsonLines(fixture, { synthetic: true, source: "fixture:sequence" });

    expect(capture.host).toEqual({
      id: "demo-host",
      hostname: "demo-host",
      bootId: "synthetic-boot-one",
      osVersion: "Linux Kernel 6.8",
    });
    expect(capture.observations.map((item) => item.kind)).toEqual([
      "container_started",
      "process_started",
      "file_descriptor_opened",
      "tcp_connection_created",
      "process_stopped",
    ]);
    expect(capture.observations[1].process).toMatchObject({
      processId: 2201,
      selfExecId: 1,
      parentProcessId: 1,
      containerId: "synthetic-container-a",
      networkNamespace: "net:[4026532503]",
    });
    expect(capture.observations[2].fileDescriptor).toMatchObject({
      descriptorId: "6",
      path: "/models/model.safetensors",
      inode: "4401",
      device: "259:0",
    });
    expect(capture.observations[3].connection).toMatchObject({
      descriptorId: "7",
      destination: { address: "198.51.100.20", port: 6379 },
      interfaceName: "eth0",
    });
    expect(capture.diagnostics).toEqual([]);
  });

  it("preserves unknown external fields only in the raw source record", () => {
    const capture = normalizeArgusJsonLines(fixture, { synthetic: true });
    const observation = capture.observations[0];

    expect(observation.source.rawRecord).toContain("future_container_field");
    expect(observation.container).toEqual({ containerId: "synthetic-container-a" });
    expect(observation).not.toHaveProperty("future_container_field");
  });

  it("takes the synthetic trust label from the adapter boundary, not input JSON", () => {
    const capture = normalizeArgusJsonLines(
      '{"synthetic":true,"message_id":"one","occurred_message_time_iso_8601_ns":"2026-07-27T18:00:00Z","activity_data":{"name":"Process Created","process_created_details":{"process_id":1,"process_name":"init"}}}',
      { synthetic: false },
    );

    expect(capture.observations[0].source.synthetic).toBe(false);
  });

  it("turns malformed and unsupported records into diagnostics", () => {
    const input = [
      "{not-json}",
      '{"message_id":"future","occurred_message_time_iso_8601_ns":"2026-07-27T18:00:00Z","activity_data":{"name":"Future Activity"}}',
    ].join("\n");
    const capture = normalizeArgusJsonLines(input, { synthetic: true });

    expect(capture.observations).toEqual([]);
    expect(capture.diagnostics.map((item) => item.code)).toEqual([
      "argus.invalid_json",
      "argus.unsupported_activity",
    ]);
  });
});
