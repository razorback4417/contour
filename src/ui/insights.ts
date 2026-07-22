import type { TopologySnapshot } from "../model/types";
import { topologyFindings } from "../analysis/troubleshooting";

export interface TopologyInsight {
  id: string;
  severity: "info" | "attention";
  title: string;
  finding: string;
  evidence: string;
  nodeIds: string[];
}

export function topologyInsights(snapshot: TopologySnapshot): TopologyInsight[] {
  return topologyFindings(snapshot).map((finding) => ({ id: finding.id, severity: finding.severity, title: finding.title, finding: finding.summary, evidence: [...finding.evidence, finding.uncertainty].join(" "), nodeIds: finding.nodeIds }));
}
