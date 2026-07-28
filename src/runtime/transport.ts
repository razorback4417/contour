import type { RuntimeCapture } from "./types";

export interface RuntimeWindow {
  schemaVersion: "contour.runtime-window/v1";
  capture: RuntimeCapture;
  navigation: {
    earlierCursor?: string;
    hasEarlier: boolean;
    live: boolean;
  };
}

/**
 * The ingestion capture keeps each original Argus record for provenance.
 * The live browser only needs normalized observations and evidence IDs.
 */
export function runtimeBrowserCapture(capture: RuntimeCapture): RuntimeCapture {
  return {
    ...capture,
    observations: capture.observations.map((observation) => ({
      ...observation,
      source: {
        ...observation.source,
        rawRecord: undefined,
      },
    })),
  };
}

export function runtimeBrowserWindow(
  capture: RuntimeCapture,
  navigation: RuntimeWindow["navigation"],
): RuntimeWindow {
  return {
    schemaVersion: "contour.runtime-window/v1",
    capture: runtimeBrowserCapture(capture),
    navigation,
  };
}
