export interface RawNetworkInterface {
  ifindex: number;
  ifname: string;
  linkType?: string;
  operstate?: string;
  mtu?: number;
  rxQueues?: number;
  txQueues?: number;
  physicalPortName?: string;
}

export interface RawRdmaLink {
  device: string;
  port: number;
  netdev?: string;
  state?: string;
  physicalState?: string;
}

export function parseIpLinkJson(json: string): RawNetworkInterface[] {
  const values = parseArray(json, "ip -json link");
  return values.map((value, index) => {
    if (!isRecord(value) || typeof value.ifindex !== "number" || typeof value.ifname !== "string") throw new Error(`ip link entry ${index} is missing ifindex or ifname`);
    return compact({ ifindex: value.ifindex, ifname: value.ifname, linkType: stringValue(value.link_type), operstate: stringValue(value.operstate), mtu: numberValue(value.mtu), rxQueues: numberValue(value.num_rx_queues), txQueues: numberValue(value.num_tx_queues), physicalPortName: stringValue(value.phys_port_name) });
  }).sort((a, b) => a.ifindex - b.ifindex || a.ifname.localeCompare(b.ifname));
}

export function parseRdmaLinkJson(json: string): RawRdmaLink[] {
  const values = parseArray(json, "rdma -json link");
  return values.map((value, index) => {
    if (!isRecord(value) || typeof value.ifname !== "string" || typeof value.port !== "number") throw new Error(`rdma link entry ${index} is missing ifname or port`);
    return compact({ device: value.ifname, port: value.port, netdev: stringValue(value.netdev), state: stringValue(value.state), physicalState: stringValue(value.physical_state) });
  }).sort((a, b) => a.device.localeCompare(b.device) || a.port - b.port);
}

function parseArray(json: string, source: string): unknown[] {
  let value: unknown;
  try { value = JSON.parse(json); } catch (error) { throw new Error(`${source} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  if (!Array.isArray(value)) throw new Error(`${source} did not return a JSON array`);
  return value;
}
function compact<T extends object>(value: T): T { return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined)) as T; }
function stringValue(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function numberValue(value: unknown): number | undefined { return typeof value === "number" ? value : undefined; }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
