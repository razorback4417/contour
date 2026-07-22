import { readFile } from "node:fs/promises";
import { parseHwlocXml, HwlocParseError } from "./adapters/hwloc";
import { normalizeHwloc } from "./normalize/hwloc";
import { layoutTopology } from "./layout/hierarchy";
import { renderTopologySvg } from "./render/svg";
import { stableStringify } from "./model/stable";

async function main(): Promise<void> {
  const [command, input] = process.argv.slice(2);
  if (!command || !input || !["normalize", "svg"].includes(command)) {
    console.error("Usage: npm run contour -- <normalize|svg> <lstopo.xml>");
    process.exitCode = 2;
    return;
  }
  try {
    const xml = await readFile(input, "utf8");
    const snapshot = normalizeHwloc(parseHwlocXml(xml, input));
    if (command === "normalize") process.stdout.write(`${stableStringify(snapshot)}\n`);
    else process.stdout.write(renderTopologySvg(snapshot, layoutTopology(snapshot), { title: `Contour · ${snapshot.nodes.find((node) => node.id === snapshot.hostId)?.label ?? "host"}` }));
  } catch (error) {
    const prefix = error instanceof HwlocParseError ? "Invalid lstopo XML" : "Contour failed";
    console.error(`${prefix}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

await main();
