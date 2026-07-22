import { collectLstopo, type LstopoCollectorOptions } from "./lstopo";
import { collectLinuxNetwork, type LinuxNetworkCollectorOptions } from "./linux-network";
import { enrichLinuxNetwork } from "../normalize/linux-network";
import type { TopologySnapshot } from "../model/types";

export interface LocalCollectorOptions { lstopo?: LstopoCollectorOptions; network?: LinuxNetworkCollectorOptions; }

export async function collectLocalTopology(options: LocalCollectorOptions = {}): Promise<TopologySnapshot> {
  const base = await collectLstopo(options.lstopo);
  const network = await collectLinuxNetwork(options.network);
  return enrichLinuxNetwork(base, network);
}
