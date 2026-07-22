import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { CollectorResult, FactValue } from "../model/types";

export interface EvidenceTarget {
  pciBdf?: string;
  ifname?: string;
  rdmaDevice?: string;
  port?: number;
}

export interface EvidenceFactInput {
  key: string;
  value: FactValue;
  rawValue?: FactValue;
  sourceField: string;
}

export interface EvidenceObservation {
  target: EvidenceTarget;
  placement: "node" | "upstream_edge";
  collector: string;
  source: string;
  facts: EvidenceFactInput[];
}

export interface PhysicalEvidence {
  observations: EvidenceObservation[];
  collectors: CollectorResult[];
}

export function parseEttoolText(text: string, ifname: string): EvidenceObservation {
  const mappings: Array<[RegExp, string, (value: string) => FactValue]> = [
    [/^\s*Speed:\s*(\d+)Mb\/s\s*$/im, "ethernet.speed_mbps", numberValue],
    [/^\s*Duplex:\s*(\S+)\s*$/im, "ethernet.duplex", stringValue],
    [/^\s*Auto-negotiation:\s*(\S+)\s*$/im, "ethernet.autonegotiation", booleanValue],
    [/^\s*Link detected:\s*(\S+)\s*$/im, "ethernet.link_detected", booleanValue],
    [/^\s*Lanes:\s*(\d+)\s*$/im, "ethernet.lanes", numberValue],
    [/^\s*(?:Active FEC encoding|FEC encodings):\s*(.+?)\s*$/im, "ethernet.fec", stringValue]
  ];
  const facts = mappings.flatMap(([pattern, key, normalize]) => {
    const match = text.match(pattern);
    return match ? [{ key, value: normalize(match[1]), rawValue: match[1], sourceField: match[0].split(":", 1)[0].trim() }] : [];
  });
  return { target: { ifname }, placement: "node", collector: "linux.ethtool", source: `command:ethtool ${ifname}`, facts };
}

export function parseEttoolDriverText(text: string, ifname: string): EvidenceObservation {
  const facts: EvidenceFactInput[] = [];
  for (const [field, key] of [["driver", "ethernet.driver"], ["version", "ethernet.driver_version"], ["firmware-version", "ethernet.firmware_version"], ["bus-info", "ethernet.bus_info"]] as const) {
    const match = text.match(new RegExp(`^\\s*${field}:\\s*(.+?)\\s*$`, "im"));
    if (match) facts.push({ key, value: match[1], sourceField: field });
  }
  return { target: { ifname }, placement: "node", collector: "linux.ethtool", source: `command:ethtool -i ${ifname}`, facts };
}

export function parseRdmaStatisticJson(json: string): EvidenceObservation[] {
  const value = parseJson(json, "rdma statistic");
  return records(value).flatMap((item) => {
    const device = text(item.ifname ?? item.device ?? item.dev);
    const port = integer(item.port ?? item.port_index);
    const counters = isRecord(item.counters) ? item.counters : Object.fromEntries(Object.entries(item).filter(([key, child]) => !["ifindex", "ifname", "device", "dev", "port", "port_index"].includes(key) && scalar(child)));
    if (!device || port === undefined || !counters) return [];
    const facts = Object.entries(counters).filter(([, child]) => scalar(child)).map(([key, child]) => ({ key: `rdma.counter.${slug(key)}`, value: child as FactValue, sourceField: `counters.${key}` }));
    return [{ target: { rdmaDevice: device, port }, placement: "node" as const, collector: "linux.rdma_statistics", source: "command:rdma -j statistic show", facts: sortFacts(facts) }];
  });
}

export function parseDevlinkInfoJson(json: string): EvidenceObservation[] {
  const value = parseJson(json, "devlink info");
  const info = isRecord(value) && isRecord(value.info) ? value.info : value;
  if (!isRecord(info)) return [];
  return Object.entries(info).flatMap(([device, child]) => {
    if (!isRecord(child)) return [];
    const bdf = bdfFromDevice(device);
    if (!bdf) return [];
    const facts: EvidenceFactInput[] = [];
    if (typeof child.driver === "string") facts.push({ key: "devlink.driver", value: child.driver, sourceField: "driver" });
    if (isRecord(child.versions)) flattenVersionFacts(child.versions, "versions", "devlink.version", facts);
    return [{ target: { pciBdf: bdf }, placement: "node" as const, collector: "linux.devlink_info", source: "command:devlink -j dev info", facts: sortFacts(facts) }];
  });
}

export function parseDevlinkHealthJson(json: string): EvidenceObservation[] {
  const value = parseJson(json, "devlink health");
  const health = isRecord(value) && isRecord(value.health) ? value.health : value;
  if (!isRecord(health)) return [];
  return Object.entries(health).flatMap(([device, child]) => {
    const bdf = bdfFromDevice(device);
    if (!bdf) return [];
    const facts: EvidenceFactInput[] = [];
    for (const reporter of array(child)) {
      if (!isRecord(reporter)) continue;
      const name = text(reporter.reporter) ?? "reporter";
      flattenHealthFacts(reporter, `health.${slug(name)}`, facts);
    }
    return [{ target: { pciBdf: bdf }, placement: "node" as const, collector: "linux.devlink_health", source: "command:devlink -j health show", facts: sortFacts(facts) }];
  });
}

const nvidiaXml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", parseTagValue: false, trimValues: true, isArray: (name) => name === "gpu" || name === "link" });

export function parseNvidiaSmiXml(xml: string): EvidenceObservation[] {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) throw new Error(`Malformed nvidia-smi XML: ${validation.err.msg}`);
  const document = nvidiaXml.parse(xml) as unknown;
  const root = isRecord(document) && isRecord(document.nvidia_smi_log) ? document.nvidia_smi_log : undefined;
  const gpus = root ? array(root.gpu) : [];
  return gpus.flatMap((gpu) => {
    if (!isRecord(gpu) || !isRecord(gpu.pci)) return [];
    const bdf = normalizeBdf(text(gpu.pci.pci_bus_id));
    if (!bdf) return [];
    const facts: EvidenceFactInput[] = [];
    const fields: Array<[string, string, (value: string) => FactValue]> = [
      ["current_link_gen", "nvidia.pcie.current_generation", numberFromText],
      ["max_link_gen", "nvidia.pcie.max_generation", numberFromText],
      ["current_link_width", "nvidia.pcie.current_width", numberFromText],
      ["max_link_width", "nvidia.pcie.max_width", numberFromText],
      ["replay_counter", "nvidia.pcie.replay_count", numberFromText],
      ["replay_rollover_counter", "nvidia.pcie.replay_rollover_count", numberFromText]
    ];
    for (const [sourceField, key, normalize] of fields) {
      const raw = deepFind(gpu.pci, sourceField);
      if (raw !== undefined) facts.push({ key, value: normalize(raw), rawValue: raw, sourceField: `pci.${sourceField}` });
    }
    const nodeFacts: EvidenceFactInput[] = [];
    const c2c = deepFind(gpu, "c2c_mode");
    if (c2c !== undefined) nodeFacts.push({ key: "nvidia.c2c_mode", value: c2c, sourceField: "c2c_mode" });
    const linkStates = deepFindAll(gpu, "link_state");
    if (linkStates.length) {
      nodeFacts.push({ key: "nvidia.nvlink.total_links", value: linkStates.length, sourceField: "nvlink.link.link_state" });
      nodeFacts.push({ key: "nvidia.nvlink.active_links", value: linkStates.filter((state) => /active|enabled|up/i.test(state)).length, sourceField: "nvlink.link.link_state" });
    }
    return [
      { target: { pciBdf: bdf }, placement: "upstream_edge" as const, collector: "nvidia.nvidia_smi_xml", source: "command:nvidia-smi -q -x", facts: sortFacts(facts) },
      ...(nodeFacts.length ? [{ target: { pciBdf: bdf }, placement: "node" as const, collector: "nvidia.nvidia_smi_xml", source: "command:nvidia-smi -q -x", facts: sortFacts(nodeFacts) }] : [])
    ];
  });
}

export function parseMlxlinkJson(json: string, pciBdf: string): EvidenceObservation[] {
  const value = parseJson(json, "mlxlink");
  const facts: EvidenceFactInput[] = [];
  flattenMlxlink(value, "", facts);
  return [{ target: { pciBdf: normalizeBdf(pciBdf) ?? pciBdf.toLowerCase() }, placement: "upstream_edge", collector: "nvidia.mlxlink", source: `command:mlxlink -d ${pciBdf} --json`, facts: sortFacts(facts) }];
}

function flattenVersionFacts(value: Record<string, unknown>, source: string, prefix: string, output: EvidenceFactInput[]): void {
  for (const [key, child] of Object.entries(value)) {
    if (isRecord(child)) flattenVersionFacts(child, `${source}.${key}`, `${prefix}.${slug(key)}`, output);
    else if (scalar(child)) output.push({ key: `${prefix}.${slug(key)}`, value: child as FactValue, sourceField: `${source}.${key}` });
  }
}

function flattenHealthFacts(value: Record<string, unknown>, source: string, output: EvidenceFactInput[]): void {
  for (const [key, child] of Object.entries(value)) {
    if (isRecord(child)) flattenHealthFacts(child, `${source}.${key}`, output);
    else if (scalar(child) && /state|error|recover|health|grace|dump/i.test(key)) output.push({ key: `devlink.${source.split(".").map(slug).join(".")}.${slug(key)}`, value: child as FactValue, sourceField: `${source}.${key}` });
  }
}

function flattenMlxlink(value: unknown, source: string, output: EvidenceFactInput[]): void {
  if (Array.isArray(value)) return value.forEach((child, index) => flattenMlxlink(child, `${source}[${index}]`, output));
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const path = source ? `${source}.${key}` : key;
    if (isRecord(child) || Array.isArray(child)) flattenMlxlink(child, path, output);
    else if (scalar(child) && /link.*(speed|width)|ber|error|crc|eye|physical grade|cable/i.test(key)) output.push({ key: `mlxlink.${slug(key)}`, value: child as FactValue, sourceField: path });
  }
}

function records(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(records);
  if (!isRecord(value)) return [];
  if ((typeof value.ifname === "string" || typeof value.device === "string") && integer(value.port ?? value.port_index) !== undefined) return [value];
  return Object.values(value).flatMap(records);
}

function deepFind(value: unknown, key: string): string | undefined {
  if (Array.isArray(value)) for (const child of value) { const found = deepFind(child, key); if (found !== undefined) return found; }
  if (!isRecord(value)) return undefined;
  if (scalar(value[key])) return String(value[key]);
  for (const child of Object.values(value)) { const found = deepFind(child, key); if (found !== undefined) return found; }
  return undefined;
}

function deepFindAll(value: unknown, key: string): string[] {
  if (Array.isArray(value)) return value.flatMap((child) => deepFindAll(child, key));
  if (!isRecord(value)) return [];
  return [...(scalar(value[key]) ? [String(value[key])] : []), ...Object.values(value).flatMap((child) => deepFindAll(child, key))];
}

function parseJson(json: string, source: string): unknown { try { return JSON.parse(json); } catch (error) { throw new Error(`Invalid ${source} JSON: ${error instanceof Error ? error.message : String(error)}`); } }
function normalizeBdf(value: string | undefined): string | undefined { if (!value) return undefined; const match = value.toLowerCase().match(/(?:[0-9a-f]{4})?([0-9a-f]{4}):([0-9a-f]{2}):([0-9a-f]{2}\.[0-7])/); return match ? `${match[1]}:${match[2]}:${match[3]}` : undefined; }
function bdfFromDevice(value: string): string | undefined { return normalizeBdf(value.replace(/^pci\//, "")); }
function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""); }
function sortFacts(facts: EvidenceFactInput[]): EvidenceFactInput[] { return facts.sort((a, b) => a.key.localeCompare(b.key)); }
function scalar(value: unknown): value is FactValue { return value === null || ["string", "number", "boolean"].includes(typeof value); }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function array(value: unknown): unknown[] { return value === undefined ? [] : Array.isArray(value) ? value : [value]; }
function text(value: unknown): string | undefined { return typeof value === "string" && value ? value : undefined; }
function integer(value: unknown): number | undefined { const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN; return Number.isInteger(parsed) ? parsed : undefined; }
function numberValue(value: string): number { return Number(value); }
function numberFromText(value: string): FactValue { const match = value.match(/\d+/); return match ? Number(match[0]) : value; }
function stringValue(value: string): string { return value; }
function booleanValue(value: string): FactValue { return /^(yes|on|true)$/i.test(value) ? true : /^(no|off|false)$/i.test(value) ? false : value; }
