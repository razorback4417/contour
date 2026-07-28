import type { RuntimeCapture } from "./types";

export interface RuntimeSourceContract {
  product: string;
  productVersion?: string;
  schemaVersion?: string;
  observations: number;
}

export interface RuntimeDiagnosticCount {
  code: string;
  count: number;
}

export interface RuntimeCompatibilitySummary {
  normalizedObservations: number;
  contracts: RuntimeSourceContract[];
  diagnostics: RuntimeDiagnosticCount[];
}

export function summarizeRuntimeCompatibility(
  capture: RuntimeCapture,
): RuntimeCompatibilitySummary {
  const contracts = new Map<string, RuntimeSourceContract>();
  for (const observation of capture.observations) {
    const { product, productVersion, schemaVersion } = observation.source;
    const key = [product, productVersion ?? "", schemaVersion ?? ""].join("\0");
    const existing = contracts.get(key);
    if (existing) {
      existing.observations += 1;
    } else {
      contracts.set(key, {
        product,
        productVersion,
        schemaVersion,
        observations: 1,
      });
    }
  }

  const diagnostics = new Map<string, number>();
  for (const diagnostic of capture.diagnostics) {
    diagnostics.set(diagnostic.code, (diagnostics.get(diagnostic.code) ?? 0) + 1);
  }

  return {
    normalizedObservations: capture.observations.length,
    contracts: [...contracts.values()].sort((left, right) =>
      left.product.localeCompare(right.product)
      || (left.productVersion ?? "").localeCompare(right.productVersion ?? "")
      || (left.schemaVersion ?? "").localeCompare(right.schemaVersion ?? "")),
    diagnostics: [...diagnostics.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((left, right) => left.code.localeCompare(right.code)),
  };
}
