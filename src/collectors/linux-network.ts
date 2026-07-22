import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename } from "node:path";
import { readFile, readdir, realpath } from "node:fs/promises";
import { parseDevlinkPortJson, parseIpLinkJson, parseRdmaDeviceJson, parseRdmaLinkJson, type RawDevlinkPort, type RawNetworkInterface, type RawRdmaDevice, type RawRdmaLink } from "../adapters/iproute";
import type { CollectorResult } from "../model/types";
import type { ProcessRunner } from "./lstopo";

export interface InterfaceSysfsObservation { ifname: string; devicePath?: string; pciBdf?: string; numaNode?: number; }
export interface InfinibandSysfsObservation { device: string; devicePath?: string; pciBdf?: string; }
export interface LinuxNetworkObservations { interfaces: RawNetworkInterface[]; sysfs: InterfaceSysfsObservation[]; rdmaLinks: RawRdmaLink[]; rdmaDevices: RawRdmaDevice[]; infiniband: InfinibandSysfsObservation[]; devlinkPorts: RawDevlinkPort[]; collectors: CollectorResult[]; }
export interface LinuxNetworkCollectorOptions { runner?: ProcessRunner; inspectSysfs?: (ifname: string) => Promise<InterfaceSysfsObservation>; inspectInfiniband?: () => Promise<InfinibandSysfsObservation[]>; now?: () => Date; }

const execFileAsync = promisify(execFile);
const defaultRunner: ProcessRunner = async (file, args) => { const value = await execFileAsync(file, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 15_000 }); return { stdout: value.stdout, stderr: value.stderr }; };

export async function collectLinuxNetwork(options: LinuxNetworkCollectorOptions = {}): Promise<LinuxNetworkObservations> {
  const runner = options.runner ?? defaultRunner;
  const now = options.now ?? (() => new Date());
  const inspect = options.inspectSysfs ?? inspectInterfaceSysfs;
  const inspectIb = options.inspectInfiniband ?? inspectInfinibandSysfs;
  const collectors: CollectorResult[] = [];
  const ip = await optionalCommand("linux.ip_link", "ip", ["-details", "-json", "link", "show"], runner, now, collectors);
  const interfaces = ip ? parseIpLinkJson(ip.stdout) : [];
  const sysfs: InterfaceSysfsObservation[] = await Promise.all(interfaces.map(async (item): Promise<InterfaceSysfsObservation> => inspect(item.ifname).catch(() => ({ ifname: item.ifname }))));
  const hasDevicePaths = sysfs.some((item) => item.devicePath);
  collectors.push(result("linux.sysfs_net", interfaces.length > 0 && !hasDevicePaths ? "partial" : "success", now().toISOString(), "/sys/class/net", hasDevicePaths || interfaces.length === 0 ? undefined : "No interface device paths were available."));
  const rdma = await optionalCommand("linux.rdma_link", "rdma", ["-j", "link", "show"], runner, now, collectors);
  const rdmaDevice = await optionalCommand("linux.rdma_device", "rdma", ["-j", "dev", "show"], runner, now, collectors);
  const devlinkPort = await optionalCommand("linux.devlink_port", "devlink", ["-j", "port", "show"], runner, now, collectors);
  let infiniband: InfinibandSysfsObservation[] = [];
  const ibStarted = now().toISOString();
  try { infiniband = await inspectIb(); collectors.push(result("linux.infiniband_sysfs", "success", ibStarted, "/sys/class/infiniband", infiniband.length ? undefined : "No InfiniBand class devices were present.")); }
  catch (error) { collectors.push(result("linux.infiniband_sysfs", "failed", ibStarted, "/sys/class/infiniband", error instanceof Error ? error.message : String(error))); }
  return { interfaces, sysfs, rdmaLinks: rdma ? parseRdmaLinkJson(rdma.stdout) : [], rdmaDevices: rdmaDevice ? parseRdmaDeviceJson(rdmaDevice.stdout) : [], infiniband, devlinkPorts: devlinkPort ? parseDevlinkPortJson(devlinkPort.stdout) : [], collectors };
}

async function optionalCommand(collector: string, command: string, args: string[], runner: ProcessRunner, now: () => Date, results: CollectorResult[]) {
  const started = now().toISOString();
  try {
    const output = await runner(command, args);
    results.push({ collector, status: output.stderr.trim() ? "partial" : "success", startedAt: started, completedAt: now().toISOString(), source: `command:${command} ${args.join(" ")}`, ...(output.stderr.trim() ? { message: output.stderr.trim() } : {}) });
    return output;
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String((error as NodeJS.ErrnoException).code) : undefined;
    results.push({ collector, status: code === "ENOENT" ? "unavailable" : "failed", startedAt: started, completedAt: now().toISOString(), source: `command:${command} ${args.join(" ")}`, message: code === "ENOENT" ? `${command} is not installed.` : error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

async function inspectInterfaceSysfs(ifname: string): Promise<InterfaceSysfsObservation> {
  const devicePath = await realpath(`/sys/class/net/${ifname}/device`);
  const candidate = basename(devicePath).toLowerCase();
  const pciBdf = /^[0-9a-f]{4}:[0-9a-f]{2}:[0-9a-f]{2}\.[0-7]$/.test(candidate) ? candidate : undefined;
  let numaNode: number | undefined;
  try { const value = Number((await readFile(`/sys/class/net/${ifname}/device/numa_node`, "utf8")).trim()); if (Number.isInteger(value) && value >= 0) numaNode = value; } catch { /* Optional kernel attribute. */ }
  return { ifname, devicePath, ...(pciBdf ? { pciBdf } : {}), ...(numaNode !== undefined ? { numaNode } : {}) };
}

async function inspectInfinibandSysfs(): Promise<InfinibandSysfsObservation[]> {
  let devices: string[];
  try { devices = await readdir("/sys/class/infiniband"); } catch (error) { if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  return Promise.all(devices.sort().map(async (device) => {
    try { const devicePath = await realpath(`/sys/class/infiniband/${device}/device`); const candidate = basename(devicePath).toLowerCase(); const pciBdf = /^[0-9a-f]{4}:[0-9a-f]{2}:[0-9a-f]{2}\.[0-7]$/.test(candidate) ? candidate : undefined; return { device, devicePath, ...(pciBdf ? { pciBdf } : {}) }; }
    catch { return { device }; }
  }));
}

function result(collector: string, status: CollectorResult["status"], time: string, source: string, message?: string): CollectorResult { return { collector, status, startedAt: time, completedAt: time, source, ...(message ? { message } : {}) }; }
