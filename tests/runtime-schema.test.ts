import { describe, expect, it } from "vitest";
import { parseRuntimeCaptureJson, RuntimeCaptureParseError } from "../src/runtime/capture-json";

function capture(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    schemaVersion: "contour.runtime/v1",
    captureId: "capture:synthetic",
    host: { id: "host:demo", hostname: "demo-host", bootId: "boot:one" },
    startedAt: "2026-07-27T18:00:00Z",
    endedAt: "2026-07-27T18:01:00Z",
    observations: [{
      id: "observation:one",
      kind: "process_started",
      observedAt: "2026-07-27T18:00:01Z",
      basis: "observed",
      process: {
        processId: 42,
        name: "python3",
        currentWorkingDirectory: "/srv/inference",
      },
      source: {
        collector: "argus",
        product: "NVIDIA DOCA Argus",
        productVersion: "3.4",
        activityName: "Process Created",
        synthetic: true,
        rawRecord: "{\"synthetic\":true}",
      },
    }],
    diagnostics: [],
    ...overrides,
  });
}

describe("runtime capture contract", () => {
  it("loads a normalized capture without treating it as physical topology", () => {
    const parsed = parseRuntimeCaptureJson(capture());
    expect(parsed.schemaVersion).toBe("contour.runtime/v1");
    expect(parsed.host.hostname).toBe("demo-host");
    expect(parsed.observations[0].process?.processId).toBe(42);
    expect(parsed.observations[0].process?.currentWorkingDirectory).toBe("/srv/inference");
    expect(parsed.observations[0].source.synthetic).toBe(true);
  });

  it("rejects a physical topology snapshot at the runtime boundary", () => {
    expect(() => parseRuntimeCaptureJson(capture({ schemaVersion: "contour.topology/v2" })))
      .toThrowError(new RuntimeCaptureParseError("Unsupported schemaVersion: contour.topology/v2"));
  });

  it("rejects unknown normalized observation kinds", () => {
    const value = JSON.parse(capture());
    value.observations[0].kind = "argus_future_activity";
    expect(() => parseRuntimeCaptureJson(JSON.stringify(value)))
      .toThrow("Runtime observation 0 has unsupported kind: argus_future_activity");
  });

  it("requires synthetic provenance to be explicit", () => {
    const value = JSON.parse(capture());
    delete value.observations[0].source.synthetic;
    expect(() => parseRuntimeCaptureJson(JSON.stringify(value)))
      .toThrow("Runtime observation 0 source synthetic flag must be boolean");
  });

  it("preserves explicit transport-time provenance", () => {
    const value = JSON.parse(capture());
    value.observations[0].observedAtSource = "transport_received";
    value.observations[0].source.receivedAt = "2026-07-27T18:00:01.100000000Z";

    const parsed = parseRuntimeCaptureJson(JSON.stringify(value));

    expect(parsed.observations[0].observedAtSource).toBe("transport_received");
    expect(parsed.observations[0].source.receivedAt)
      .toBe("2026-07-27T18:00:01.100000000Z");
  });
});
