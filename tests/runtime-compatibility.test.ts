import { describe, expect, it } from "vitest";
import { summarizeRuntimeCompatibility } from "../src/runtime/compatibility";
import type { RuntimeCapture } from "../src/runtime/types";

describe("runtime compatibility summary", () => {
  it("reports observed product contracts and diagnostic counts without interpreting them", () => {
    const capture: RuntimeCapture = {
      schemaVersion: "contour.runtime/v1",
      captureId: "capture:test",
      host: { id: "host:test" },
      startedAt: "2026-07-27T18:00:00Z",
      endedAt: "2026-07-27T18:00:02Z",
      observations: [
        observation("one", "3.4", "1.0"),
        observation("two", "3.4", "1.0"),
        observation("three", "3.5", undefined),
      ],
      diagnostics: [
        diagnostic("argus.unsupported_activity"),
        diagnostic("argus.unsupported_activity"),
        diagnostic("argus.invalid_json"),
      ],
    };

    expect(summarizeRuntimeCompatibility(capture)).toEqual({
      normalizedObservations: 3,
      contracts: [
        {
          product: "DOCA_ARGUS",
          productVersion: "3.4",
          schemaVersion: "1.0",
          observations: 2,
        },
        {
          product: "DOCA_ARGUS",
          productVersion: "3.5",
          observations: 1,
        },
      ],
      diagnostics: [
        { code: "argus.invalid_json", count: 1 },
        { code: "argus.unsupported_activity", count: 2 },
      ],
    });
  });
});

function observation(id: string, productVersion: string, schemaVersion: string | undefined) {
  return {
    id,
    kind: "process_started" as const,
    observedAt: `2026-07-27T18:00:0${id === "one" ? "0" : id === "two" ? "1" : "2"}Z`,
    basis: "observed" as const,
    process: { processId: 42, name: "worker" },
    source: {
      collector: "argus",
      product: "DOCA_ARGUS",
      productVersion,
      schemaVersion,
      activityName: "process_created",
      synthetic: false,
    },
  };
}

function diagnostic(code: string) {
  return {
    id: `${code}:id`,
    code,
    severity: "warning" as const,
    message: code,
  };
}
