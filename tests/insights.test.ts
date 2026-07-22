import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHwlocXml } from "../src/adapters/hwloc";
import { normalizeHwloc } from "../src/normalize/hwloc";
import { topologyInsights } from "../src/ui/insights";

describe("engineering insights", () => {
  it("separates observed shared structure from potential performance impact", () => {
    const xml = readFileSync(new URL("../fixtures/workstation.xml", import.meta.url), "utf8");
    const insights = topologyInsights(normalizeHwloc(parseHwlocXml(xml)));
    const shared = insights.find((item) => item.id.startsWith("shared-bridge:"));
    expect(shared?.title).toContain("share");
    expect(shared?.evidence).toContain("not simultaneous traffic or congestion");
    expect(insights).toEqual(topologyInsights(normalizeHwloc(parseHwlocXml(xml))));
  });
});
