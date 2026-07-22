#!/usr/bin/env node
import { createServer, type ServerResponse } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { parseHwlocXml, HwlocParseError } from "./adapters/hwloc";
import { parseSnapshotJson, SnapshotParseError } from "./adapters/snapshot-json";
import { CollectorUnavailableError } from "./collectors/lstopo";
import { collectLocalTopology } from "./collectors/local";
import { normalizeHwloc } from "./normalize/hwloc";
import { layoutTopology } from "./layout/hierarchy";
import { renderTopologySvg } from "./render/svg";
import { stableStringify } from "./model/stable";
import type { TopologySnapshot } from "./model/types";
import { resolveInvocation } from "./cli/invocation";
import { formatDoctorReport, inspectEnvironment } from "./cli/doctor";
import { detectSshSession, formatServerReady, formatSnapshotSummary, sshTarget } from "./cli/presentation";

interface ServeOptions { host: string; port: number; open: boolean; }

async function main(): Promise<void> {
  const { command, args } = resolveInvocation(process.argv.slice(2));
  try {
    switch (command) {
      case "collect": await collectCommand(args); break;
      case "serve": await serveCommand(args); break;
      case "explore": await exploreCommand(args); break;
      case "normalize": await transformCommand("normalize", args); break;
      case "svg": await transformCommand("svg", args); break;
      case "doctor": await doctorCommand(args); break;
      case "help": printHelp(); break;
      case "advanced": printAdvancedHelp(); break;
      case "version": console.log("contour 0.1.0"); break;
      default: throw new CliError(`Unknown command: ${command}\n\nRun contour help for usage.`, 2);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof HwlocParseError) console.error(`Invalid lstopo XML: ${message}`);
    else if (error instanceof SnapshotParseError) console.error(`Invalid snapshot: ${message}`);
    else if (error instanceof CollectorUnavailableError) console.error(`Collection unavailable: ${message}\nRun contour doctor for exact prerequisites.`);
    else console.error(message);
    process.exitCode = error instanceof CliError ? error.exitCode : 1;
  }
}

async function collectCommand(args: string[]): Promise<void> {
  const output = optionValue(args, "--output", "-o");
  rejectUnknown(args, new Set(["--output", "-o"]), true);
  const snapshot = await collectLocalTopology();
  const json = `${stableStringify(snapshot)}\n`;
  if (output) {
    await writeFile(output, json, "utf8");
    console.error(`Wrote canonical snapshot to ${output}`);
  } else process.stdout.write(json);
}

async function serveCommand(args: string[]): Promise<void> {
  const input = positional(args)[0];
  if (!input) throw new CliError("Usage: contour serve <snapshot.json|topology.xml> [--port 4177] [--host 127.0.0.1] [--no-open]", 2);
  const snapshot = await loadInput(input);
  await serveSnapshot(snapshot, parseServeOptions(args));
}

async function exploreCommand(args: string[]): Promise<void> {
  const input = positional(args)[0];
  if (!input) console.log("Inspecting this machine…");
  const snapshot = input ? await loadInput(input) : await collectLocalTopology();
  console.log(formatSnapshotSummary(snapshot));
  await serveSnapshot(snapshot, parseServeOptions(args));
}

async function doctorCommand(args: string[]): Promise<void> {
  rejectUnknown(args, new Set(), false);
  const report = await inspectEnvironment(staticRoot());
  console.log(formatDoctorReport(report));
  if (!report.offlineReady) process.exitCode = 1;
}

async function transformCommand(command: "normalize" | "svg", args: string[]): Promise<void> {
  const input = positional(args)[0];
  if (!input) throw new CliError(`Usage: contour ${command} <lstopo.xml>`, 2);
  const xml = await readFile(input, "utf8");
  const snapshot = normalizeHwloc(parseHwlocXml(xml, input));
  if (command === "normalize") process.stdout.write(`${stableStringify(snapshot)}\n`);
  else process.stdout.write(renderTopologySvg(snapshot, layoutTopology(snapshot), { title: `Contour · ${snapshot.nodes.find((node) => node.id === snapshot.hostId)?.label ?? "host"}` }));
}

async function loadInput(input: string): Promise<TopologySnapshot> {
  const content = await readFile(input, "utf8");
  return input.toLowerCase().endsWith(".json")
    ? parseSnapshotJson(content)
    : normalizeHwloc(parseHwlocXml(content, input));
}

async function serveSnapshot(snapshot: TopologySnapshot, options: ServeOptions): Promise<void> {
  const root = staticRoot();
  try { await readFile(resolve(root, "index.html")); }
  catch { throw new CliError("Contour UI assets are missing. Run npm run build before serve or explore.", 1); }
  const snapshotJson = `${stableStringify(snapshot)}\n`;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (url.pathname === "/api/snapshot") return send(response, 200, "application/json; charset=utf-8", snapshotJson);
      const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
      const file = resolve(root, relative);
      if (file !== root && !file.startsWith(`${root}${sep}`)) return send(response, 403, "text/plain; charset=utf-8", "Forbidden\n");
      const body = await readFile(file);
      send(response, 200, contentType(file), body);
    } catch (error) {
      const code = isNodeError(error) && error.code === "ENOENT" ? 404 : 500;
      send(response, code, "text/plain; charset=utf-8", code === 404 ? "Not found\n" : "Internal server error\n");
    }
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, resolveListen);
  });
  const url = `http://${displayHost(options.host)}:${options.port}/`;
  const sshSession = detectSshSession(process.env);
  const browserOpened = options.open && !sshSession ? openBrowser(url) : false;
  console.log(formatServerReady(url, { host: options.host, port: options.port, openRequested: options.open, browserOpened, sshSession, sshTarget: sshTarget(process.env, hostname()) }));
  const stop = () => server.close(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

function parseServeOptions(args: string[]): ServeOptions {
  rejectUnknown(args, new Set(["--host", "--port", "--no-open"]), true);
  const host = optionValue(args, "--host") ?? "127.0.0.1";
  const portRaw = optionValue(args, "--port") ?? "4177";
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new CliError(`Invalid port: ${portRaw}`, 2);
  return { host, port, open: !args.includes("--no-open") };
}

function optionValue(args: string[], ...names: string[]): string | undefined {
  for (const name of names) {
    const index = args.indexOf(name);
    if (index >= 0) {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) throw new CliError(`${name} requires a value.`, 2);
      return value;
    }
  }
  return undefined;
}

function positional(args: string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (["--host", "--port", "--output", "-o"].includes(arg)) { index += 1; continue; }
    if (!arg.startsWith("-")) values.push(arg);
  }
  return values;
}

function rejectUnknown(args: string[], allowed: Set<string>, allowPositional: boolean): void {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("-") && !allowed.has(arg)) throw new CliError(`Unknown option: ${arg}`, 2);
    if (["--host", "--port", "--output", "-o"].includes(arg)) index += 1;
    else if (!allowPositional && !arg.startsWith("-")) throw new CliError(`Unexpected argument: ${arg}`, 2);
  }
}

function openBrowser(url: string): boolean {
  const canOpen = process.platform === "darwin" || process.platform === "win32" || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
  if (!canOpen) return false;
  const [command, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try { spawn(command, args, { detached: true, stdio: "ignore" }).unref(); return true; } catch { return false; }
}

function send(response: ServerResponse, status: number, type: string, body: string | Buffer): void {
  response.writeHead(status, { "content-type": type, "cache-control": status === 200 ? "no-store" : "no-cache", "x-content-type-options": "nosniff" });
  response.end(body);
}

function contentType(file: string): string {
  const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json; charset=utf-8" };
  return types[extname(file)] ?? "application/octet-stream";
}

function displayHost(host: string): string { return host === "0.0.0.0" || host === "::" ? "localhost" : host; }
function staticRoot(): string { return resolve(dirname(fileURLToPath(import.meta.url)), "../dist"); }
function isNodeError(error: unknown): error is NodeJS.ErrnoException { return error instanceof Error && "code" in error; }

function printHelp(): void {
  console.log(`Contour — deterministic Linux system topology explorer

Usage:
  contour                    Explore this machine
  contour <snapshot>         Explore canonical JSON or lstopo XML offline
  contour doctor             Check prerequisites and supported modes

Options:
  --no-open                  Print the URL without opening a browser
  --port <port>              Override the local port (default: 4177)
  --host <address>           Override the bind address (default: 127.0.0.1)

Snapshots and SVG are exported from the UI. Run contour advanced for scripting and debugging commands.`);
}

function printAdvancedHelp(): void {
  console.log(`Advanced Contour commands

  contour collect [-o snapshot.json]       Collect canonical JSON without the UI
  contour serve <snapshot> [options]        Explicit offline server form
  contour normalize <topology.xml>          Canonical JSON on stdout
  contour svg <topology.xml>                Deterministic SVG on stdout

These commands are stable automation seams, not required for normal exploration.`);
}

class CliError extends Error {
  constructor(message: string, readonly exitCode: number) { super(message); }
}

await main();
