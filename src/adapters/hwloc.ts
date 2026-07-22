import { XMLParser, XMLValidator } from "fast-xml-parser";

export interface RawHwlocInfo {
  name: string;
  value: string;
}

export interface RawHwlocObject {
  type: string;
  attributes: Record<string, string>;
  infos: RawHwlocInfo[];
  children: RawHwlocObject[];
}

export interface RawHwlocTopology {
  source: string;
  root: RawHwlocObject;
  topologyAttributes: Record<string, string>;
}

export class HwlocParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HwlocParseError";
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  trimValues: true,
  isArray: (_name, jpath) => String(jpath).endsWith(".object") || String(jpath).endsWith(".info")
});

export function parseHwlocXml(xml: string, source = "lstopo.xml"): RawHwlocTopology {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) throw new HwlocParseError(`Malformed XML: ${validation.err.msg} at line ${validation.err.line}`);
  let document: Record<string, unknown>;
  try {
    document = parser.parse(xml) as Record<string, unknown>;
  } catch (error) {
    throw new HwlocParseError(`Malformed XML: ${error instanceof Error ? error.message : String(error)}`);
  }
  const topology = document.topology;
  if (!isRecord(topology)) throw new HwlocParseError("Missing <topology> root element");
  const objects = toArray(topology.object).filter(isRecord);
  if (objects.length !== 1) throw new HwlocParseError("Expected exactly one root <object>");
  const topologyAttributes = scalarAttributes(topology, new Set(["object", "support"]));
  return { source, root: parseObject(objects[0], "topology.object"), topologyAttributes };
}

function parseObject(value: Record<string, unknown>, path: string): RawHwlocObject {
  if (typeof value.type !== "string" || !value.type) {
    throw new HwlocParseError(`Object at ${path} is missing a type`);
  }
  const infos = toArray(value.info).filter(isRecord).map((info) => ({
    name: String(info.name ?? "unknown"),
    value: String(info.value ?? "")
  })).sort((a, b) => `${a.name}\0${a.value}`.localeCompare(`${b.name}\0${b.value}`));
  const children = toArray(value.object).filter(isRecord).map((child, index) =>
    parseObject(child, `${path}.object[${index}]`)
  );
  return {
    type: value.type,
    attributes: scalarAttributes(value, new Set(["type", "object", "info", "page_type"])),
    infos,
    children
  };
}

function scalarAttributes(value: Record<string, unknown>, excluded: Set<string>): Record<string, string> {
  return Object.fromEntries(Object.entries(value)
    .filter(([key, child]) => !excluded.has(key) && ["string", "number", "boolean"].includes(typeof child))
    .map(([key, child]) => [key, String(child)])
    .sort(([a], [b]) => a.localeCompare(b)));
}

function toArray(value: unknown): unknown[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
