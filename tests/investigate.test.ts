import { describe, expect, it } from "vitest";
import { investigationCommands } from "../src/ui/investigate";
import type { TopologyNode } from "../src/model/types";

describe("investigation command recipes", () => {
  it("uses observed PCI identity and shell-quotes source values", () => {
    const node: TopologyNode = { id: "nic:test", kind: "network_interface", label: "interface", facts: {
      pci_bdf: fact("0000:03:00.0"), "hwloc.name": fact("eth0'; touch /tmp/nope; '")
    } };
    const commands = investigationCommands(node).map((item) => item.command);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain("ethtool -i");
    expect(commands[0]).toContain("'\"'\"'");
  });
});

function fact(value: string) { return { value, state: "observed" as const, provenance: [] }; }
