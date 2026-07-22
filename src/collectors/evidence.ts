import { execFile } from "node:child_process";
import { basename } from "node:path";
import { readFile, realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { parseDevlinkHealthJson, parseDevlinkInfoJson, parseEttoolDriverText, parseEttoolText, parseMlxlinkJson, parseNvidiaSmiXml, parseRdmaStatisticJson, type EvidenceFactInput, type EvidenceObservation, type PhysicalEvidence } from "../adapters/evidence";
import type { CollectorResult, FactValue, TopologySnapshot } from "../model/types";
import type { ProcessRunner } from "./lstopo";

export interface PhysicalEvidenceCollectorOptions {
  runner?: ProcessRunner;
  inspectPci?: (bdf: string) => Promise<EvidenceObservation[]>;
  now?: () => Date;
}

const execFileAsync = promisify(execFile);
const defaultRunner: ProcessRunner = async (file, args) => { const value = await execFileAsync(file, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 15_000 }); return { stdout: value.stdout, stderr: value.stderr }; };

export async function collectPhysicalEvidence(snapshot: TopologySnapshot, options: PhysicalEvidenceCollectorOptions = {}): Promise<PhysicalEvidence> {
  const runner = options.runner ?? defaultRunner;
  const inspectPci = options.inspectPci ?? inspectPciSysfs;
  const now = options.now ?? (() => new Date());
  const observations: EvidenceObservation[] = [];
  const collectors: CollectorResult[] = [];
  const bdfs = unique(snapshot.nodes.map((node) => node.facts.pci_bdf?.value).filter((value): value is string => typeof value === "string"));
  const interfaces = unique(snapshot.nodes.filter((node) => node.kind === "network_interface" && node.facts.link_type?.value !== "loopback").flatMap((node) => [node.facts["linux.ifname"]?.value, node.facts["hwloc.name"]?.value]).filter((value): value is string => typeof value === "string"));

  const pciStarted = now().toISOString();
  const pciResults = await Promise.allSettled(bdfs.map(inspectPci));
  for (const result of pciResults) if (result.status === "fulfilled") observations.push(...result.value);
  const pciFailures = pciResults.filter((result) => result.status === "rejected");
  collectors.push({ collector: "linux.pci_sysfs", status: pciFailures.length === 0 ? "success" : pciFailures.length === pciResults.length ? "unavailable" : "partial", startedAt: pciStarted, completedAt: now().toISOString(), source: "/sys/bus/pci/devices", ...(pciFailures.length ? { message: `${pciFailures.length}/${pciResults.length} PCI devices could not be inspected.` } : {}) });

  await collectEttool(interfaces, runner, now, observations, collectors);
  await collectSingle("linux.rdma_statistics", "rdma", ["-j", "statistic", "show"], parseRdmaStatisticJson, runner, now, observations, collectors);
  await collectSingle("linux.devlink_info", "devlink", ["-j", "dev", "info"], parseDevlinkInfoJson, runner, now, observations, collectors);
  await collectSingle("linux.devlink_health", "devlink", ["-j", "health", "show"], parseDevlinkHealthJson, runner, now, observations, collectors);
  await collectSingle("nvidia.nvidia_smi_xml", "nvidia-smi", ["-q", "-x"], parseNvidiaSmiXml, runner, now, observations, collectors);

  const mellanoxBdfs = observations.filter((item) => item.collector === "linux.pci_sysfs" && item.facts.some((fact) => fact.key === "pci.vendor_id" && String(fact.value).toLowerCase() === "0x15b3")).map((item) => item.target.pciBdf).filter((value): value is string => Boolean(value));
  await collectMlxlink(unique(mellanoxBdfs), runner, now, observations, collectors);
  observations.sort((a, b) => `${a.collector}\0${JSON.stringify(a.target)}\0${a.placement}`.localeCompare(`${b.collector}\0${JSON.stringify(b.target)}\0${b.placement}`));
  collectors.sort((a, b) => a.collector.localeCompare(b.collector));
  return { observations, collectors };
}

export async function inspectPciSysfs(bdf: string): Promise<EvidenceObservation[]> {
  const root = `/sys/bus/pci/devices/${bdf}`;
  const nodeFacts: EvidenceFactInput[] = [];
  const edgeFacts: EvidenceFactInput[] = [];
  const nodeFields: Array<[string, string, (value: string) => FactValue]> = [
    ["vendor", "pci.vendor_id", identity], ["device", "pci.device_id", identity], ["subsystem_vendor", "pci.subsystem_vendor_id", identity], ["subsystem_device", "pci.subsystem_device_id", identity], ["class", "pci.class_code", identity], ["numa_node", "pci.numa_node", integerOrText]
  ];
  const edgeFields: Array<[string, string, (value: string) => FactValue]> = [
    ["current_link_speed", "pcie.current_speed_gt_s", speedGt], ["max_link_speed", "pcie.max_speed_gt_s", speedGt], ["current_link_width", "pcie.current_width", integerOrText], ["max_link_width", "pcie.max_width", integerOrText],
    ["aer_dev_correctable", "pcie.aer.correctable", aerTotal], ["aer_dev_nonfatal", "pcie.aer.nonfatal", aerTotal], ["aer_dev_fatal", "pcie.aer.fatal", aerTotal]
  ];
  for (const [file, key, normalize] of nodeFields) await addFileFact(root, file, key, normalize, nodeFacts);
  for (const [file, key, normalize] of edgeFields) await addFileFact(root, file, key, normalize, edgeFacts);
  try { nodeFacts.push({ key: "pci.driver", value: basename(await realpath(`${root}/driver`)), sourceField: "driver" }); } catch { /* Optional for unbound devices. */ }
  try { nodeFacts.push({ key: "pci.iommu_group", value: basename(await realpath(`${root}/iommu_group`)), sourceField: "iommu_group" }); } catch { /* Optional when IOMMU is disabled. */ }
  const observations: EvidenceObservation[] = [];
  if (nodeFacts.length) observations.push({ target: { pciBdf: bdf }, placement: "node", collector: "linux.pci_sysfs", source: root, facts: sortFacts(nodeFacts) });
  if (edgeFacts.length) observations.push({ target: { pciBdf: bdf }, placement: "upstream_edge", collector: "linux.pci_sysfs", source: root, facts: sortFacts(edgeFacts) });
  return observations;
}

async function collectEttool(ifnames: string[], runner: ProcessRunner, now: () => Date, observations: EvidenceObservation[], collectors: CollectorResult[]): Promise<void> {
  const startedAt = now().toISOString();
  if (ifnames.length === 0) { collectors.push(result("linux.ethtool", "success", startedAt, now().toISOString(), "command:ethtool", "No network interfaces were applicable.")); return; }
  let succeeded = 0;
  let missing = false;
  const failures: string[] = [];
  for (const ifname of ifnames) {
    for (const args of [[ifname], ["-i", ifname], ["--show-fec", ifname]]) {
      try {
        const output = await runner("ethtool", args);
        const parsed = args[0] === "-i" ? parseEttoolDriverText(output.stdout, ifname) : parseEttoolText(output.stdout, ifname);
        if (parsed.facts.length) observations.push(parsed);
        succeeded += 1;
        if (output.stderr.trim()) failures.push(`${ifname}: ${output.stderr.trim()}`);
      } catch (error) {
        missing ||= errorCode(error) === "ENOENT";
        failures.push(`${ifname}: ${errorMessage(error)}`);
      }
    }
  }
  const status = missing && succeeded === 0 ? "unavailable" : failures.length ? succeeded ? "partial" : "failed" : "success";
  collectors.push(result("linux.ethtool", status, startedAt, now().toISOString(), "command:ethtool", failures.length ? failures.join("; ") : undefined));
}

async function collectSingle(name: string, command: string, args: string[], parse: (stdout: string) => EvidenceObservation[], runner: ProcessRunner, now: () => Date, observations: EvidenceObservation[], collectors: CollectorResult[]): Promise<void> {
  const startedAt = now().toISOString();
  try {
    const output = await runner(command, args);
    observations.push(...parse(output.stdout));
    collectors.push(result(name, output.stderr.trim() ? "partial" : "success", startedAt, now().toISOString(), `command:${command} ${args.join(" ")}`, output.stderr.trim() || undefined));
  } catch (error) {
    collectors.push(result(name, errorCode(error) === "ENOENT" ? "unavailable" : "failed", startedAt, now().toISOString(), `command:${command} ${args.join(" ")}`, errorMessage(error)));
  }
}

async function collectMlxlink(bdfs: string[], runner: ProcessRunner, now: () => Date, observations: EvidenceObservation[], collectors: CollectorResult[]): Promise<void> {
  const startedAt = now().toISOString();
  if (bdfs.length === 0) { collectors.push(result("nvidia.mlxlink", "success", startedAt, now().toISOString(), "command:mlxlink", "No NVIDIA Networking PCI devices were applicable.")); return; }
  let succeeded = 0;
  let missing = false;
  const failures: string[] = [];
  for (const bdf of bdfs) {
    try { const output = await runner("mlxlink", ["-d", bdf, "--json"]); observations.push(...parseMlxlinkJson(output.stdout, bdf)); succeeded += 1; if (output.stderr.trim()) failures.push(`${bdf}: ${output.stderr.trim()}`); }
    catch (error) { missing ||= errorCode(error) === "ENOENT"; failures.push(`${bdf}: ${errorMessage(error)}`); }
  }
  const status = missing && succeeded === 0 ? "unavailable" : failures.length ? succeeded ? "partial" : "failed" : "success";
  collectors.push(result("nvidia.mlxlink", status, startedAt, now().toISOString(), "command:mlxlink --json", failures.length ? failures.join("; ") : undefined));
}

async function addFileFact(root: string, file: string, key: string, normalize: (value: string) => FactValue, facts: EvidenceFactInput[]): Promise<void> {
  try { const raw = (await readFile(`${root}/${file}`, "utf8")).trim(); if (raw) facts.push({ key, value: normalize(raw), rawValue: raw, sourceField: file }); } catch { /* Optional kernel attribute. */ }
}

function result(collector: string, status: CollectorResult["status"], startedAt: string, completedAt: string, source: string, message?: string): CollectorResult { return { collector, status, startedAt, completedAt, source, ...(message ? { message } : {}) }; }
function speedGt(value: string): FactValue { const match = value.match(/[\d.]+/); return match ? Number(match[0]) : value; }
function integerOrText(value: string): FactValue { const parsed = Number(value); return Number.isInteger(parsed) ? parsed : value; }
function identity(value: string): string { return value.toLowerCase(); }
function aerTotal(value: string): FactValue {
  const total = value.split(/\r?\n/).map((line) => line.trim().match(/^total_err_\S+\s+(\d+)$/i)).find(Boolean);
  if (total) return Number(total[1]);
  return value.split(/\r?\n/).reduce((sum, line) => { const match = line.trim().match(/\s(\d+)$/); return sum + (match ? Number(match[1]) : 0); }, 0);
}
function errorCode(error: unknown): string | undefined { return error instanceof Error && "code" in error ? String((error as NodeJS.ErrnoException).code) : undefined; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function unique<T>(values: T[]): T[] { return [...new Set(values)].sort(); }
function sortFacts(facts: EvidenceFactInput[]): EvidenceFactInput[] { return facts.sort((a, b) => a.key.localeCompare(b.key)); }
