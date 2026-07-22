import { collectLstopo, type LstopoCollectorOptions } from "./lstopo";
import { collectLinuxNetwork, type LinuxNetworkCollectorOptions } from "./linux-network";
import { enrichLinuxNetwork } from "../normalize/linux-network";
import { collectPhysicalEvidence, type PhysicalEvidenceCollectorOptions } from "./evidence";
import { enrichPhysicalEvidence } from "../normalize/evidence";
import type { TopologySnapshot } from "../model/types";

export interface LocalCollectorOptions { lstopo?: LstopoCollectorOptions; network?: LinuxNetworkCollectorOptions; evidence?: PhysicalEvidenceCollectorOptions; }

export async function collectLocalTopology(options: LocalCollectorOptions = {}): Promise<TopologySnapshot> {
  const base = await collectLstopo(options.lstopo);
  const network = await collectLinuxNetwork(options.network);
  const correlated = enrichLinuxNetwork(base, network);
  const evidence = await collectPhysicalEvidence(correlated, options.evidence);
  return enrichPhysicalEvidence(correlated, evidence);
}
